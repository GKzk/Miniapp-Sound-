import type { MusicProviderAdapter, TrackSource, TrackSearchQuery } from './types';
import type { Track } from '../../types';

// In-memory cache for search metadata (TTL 30 minutes)
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes for track search queries
const STREAM_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes for signed/temporary stream URLs

export const soundcloudSearchCache = new Map<string, CacheEntry<any>>();
export const soundcloudStreamCache = new Map<string, CacheEntry<string>>();

/**
 * Normalizes text for search and cache key generation:
 * - lowercase
 * - trim
 * - collapse whitespace
 * - remove harmless punctuation
 * - NFKD unicode normalization (decomposes fancy/stylized unicode fonts)
 */
export function normalizeSearchString(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[#.,/#!$%^&*;:{}=\-_`~()?"'’«»[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generates uniform search cache key: soundcloud:artist:title
 */
export function getSoundCloudCacheKey(artist: string, title: string): string {
  const normArtist = normalizeSearchString(artist);
  const normTitle = normalizeSearchString(title);
  return `soundcloud:${normArtist}:${normTitle}`;
}

/**
 * Truly clears both search and stream caches with parentheses.
 */
export function clearSoundCloudCaches(): void {
  soundcloudSearchCache.clear();
  soundcloudStreamCache.clear();
}

/**
 * Invalidates stream cache and search cache for a specific transcoding URL or signed URL if playback failed.
 */
export function invalidateSoundCloudStreamCache(transcodingUrlOrSignedUrl: string): void {
  if (!transcodingUrlOrSignedUrl) return;

  const deletedKeys: string[] = [];

  // 1. Invalidate stream cache
  if (soundcloudStreamCache.has(transcodingUrlOrSignedUrl)) {
    soundcloudStreamCache.delete(transcodingUrlOrSignedUrl);
    deletedKeys.push(transcodingUrlOrSignedUrl);
  } else {
    for (const [key, value] of soundcloudStreamCache.entries()) {
      if (value.data === transcodingUrlOrSignedUrl) {
        soundcloudStreamCache.delete(key);
        deletedKeys.push(key);
      }
    }
  }

  // 2. Invalidate search cache entries that reference either the key or the signed URL
  for (const [key, value] of soundcloudSearchCache.entries()) {
    if (value && value.data) {
      const source = value.data as TrackSource;
      if (
        source.url === transcodingUrlOrSignedUrl ||
        (source.url && deletedKeys.includes(source.url))
      ) {
        soundcloudSearchCache.delete(key);
      }
    }
  }
}

// Common version modifiers that indicate derivative or altered tracks
export const DERIVATIVE_MODIFIERS = [
  'remix',
  'edit',
  'live',
  'bootleg',
  'cover',
  'mix',
  'vip',
  'rework',
  'instrumental',
  'sped up',
  'slowed',
  'extended',
  'radio edit',
  'club mix',
  'dub mix',
  'acoustic',
  'tribute',
  'karaoke',
  'mashup',
  'clip',
  'snippet',
  'teaser',
];

// Legitimate version suffixes that do not invalidate original playback
export const ALLOWED_VERSION_SUFFIXES = [
  'official audio',
  'official video',
  'official music video',
  'official visualizer',
  'official',
  'original mix',
  'original track',
  'original version',
  'original',
];

export function stripAllowedSuffixes(text: string): string {
  let cleaned = text.toLowerCase();
  for (const suffix of ALLOWED_VERSION_SUFFIXES) {
    const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    cleaned = cleaned.replace(regex, ' ');
  }
  return cleaned;
}

/**
 * Checks if a string contains derivative modifiers using strict word-boundary matching.
 */
export function extractDerivativeModifiers(text: string): string[] {
  if (!text) return [];
  const textWithoutAllowed = stripAllowedSuffixes(text);
  const norm = normalizeSearchString(textWithoutAllowed);
  const found: string[] = [];

  for (const mod of DERIVATIVE_MODIFIERS) {
    const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(norm)) {
      found.push(mod);
    }
  }
  return found;
}

/**
 * Splits artist string into individual artist tokens (supporting collaborations: &, feat, ft, x, comma, and)
 */
export function extractArtistNames(artistStr: string): string[] {
  if (!artistStr) return [];
  const normalized = artistStr
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(feat\.?|ft\.?|featuring|vs\.?|and|x|\+)\b/gi, ',')
    .replace(/[&/]/g, ',');

  return normalized
    .split(',')
    .map((a) => normalizeSearchString(a))
    .filter((a) => a.length > 0);
}

/**
 * Token overlap / Jaccard similarity score between 0 and 1
 */
export function tokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeSearchString(a).split(' ').filter(Boolean));
  const tokensB = new Set(normalizeSearchString(b).split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

export interface CandidateMatchingResult {
  accepted: boolean;
  score: number;
  reason?: string;
}

/**
 * Deterministic matching algorithm for candidate SoundCloud track vs Target Track:
 * 1. Checks artist similarity (handling collaborations, uploader vs title prefix, preventing loose substring matches)
 * 2. Checks title similarity
 * 3. Rejects remixes / edits / bootlegs / covers unless the target track itself is one
 * 4. Checks duration compatibility if both durations are available (rejects 1hr mixes and snippets)
 */
export function evaluateSoundCloudMatch(
  targetArtist: string,
  targetTitle: string,
  targetDurationSeconds: number | undefined,
  candidate: {
    title: string;
    user?: { username?: string };
    duration?: number; // duration in ms in SoundCloud API
    monetization_model?: string;
  }
): CandidateMatchingResult {
  const normTargetArtist = normalizeSearchString(targetArtist);
  const normTargetTitle = normalizeSearchString(targetTitle);
  const candidateTitle = candidate.title || '';
  const normCandidateTitle = normalizeSearchString(candidateTitle);
  const candidateUploader = candidate.user?.username || '';
  const normCandidateUploader = normalizeSearchString(candidateUploader);

  // 1. Artist Matching
  const targetSubArtists = extractArtistNames(targetArtist);
  const uploaderSubArtists = extractArtistNames(candidateUploader);

  // Check if uploader exactly matches target artist or any collaborating artist
  const uploaderExactMatch =
    normCandidateUploader === normTargetArtist ||
    targetSubArtists.some((ta) => uploaderSubArtists.includes(ta));

  // Check if uploader has high token similarity (>= 0.7) without being an accidental single-token match
  const uploaderTokens = normCandidateUploader.split(' ').filter(Boolean);
  const targetTokens = normTargetArtist.split(' ').filter(Boolean);
  const uploaderSim = tokenSimilarity(normTargetArtist, normCandidateUploader);

  // Prevent "The" matching "The Chemical Brothers" or single short word matching long artist
  const isSafeTokenMatch =
    uploaderSim >= 0.7 &&
    Math.min(uploaderTokens.length, targetTokens.length) >= 2;

  // Check if candidate title includes the target artist name as a standalone phrase (e.g. "Artist - Title")
  const titleHasTargetArtist =
    normCandidateTitle.startsWith(`${normTargetArtist} `) ||
    normCandidateTitle.includes(` ${normTargetArtist} `) ||
    normCandidateTitle.includes(`${normTargetArtist} -`) ||
    normCandidateTitle.includes(`${normTargetArtist} –`) ||
    normCandidateTitle.includes(`${normTargetArtist} —`) ||
    targetSubArtists.some(
      (ta) =>
        ta.length > 2 &&
        (normCandidateTitle.startsWith(`${ta} `) ||
          normCandidateTitle.includes(` ${ta} `) ||
          normCandidateTitle.includes(`${ta} -`))
    );

  const isArtistMatch = uploaderExactMatch || isSafeTokenMatch || titleHasTargetArtist;

  if (!isArtistMatch) {
    return {
      accepted: false,
      score: 0,
      reason: 'Artist mismatch',
    };
  }

  // 2. Title Matching
  const titleSim = tokenSimilarity(normTargetTitle, normCandidateTitle);
  const titleTokens = normTargetTitle.split(' ').filter(Boolean);
  
  // Title must either be an exact match, contained as complete phrase, or have >= 0.5 token similarity
  const titleExactMatch =
    normCandidateTitle === normTargetTitle ||
    normCandidateTitle === `${normTargetArtist} ${normTargetTitle}`;
  const titlePhraseMatch =
    normCandidateTitle.includes(normTargetTitle) &&
    (normTargetTitle.length > 3 || titleTokens.length > 1);

  if (!titleExactMatch && !titlePhraseMatch && titleSim < 0.5) {
    return {
      accepted: false,
      score: 0,
      reason: 'Title mismatch',
    };
  }

  // 3. Version Compatibility: Rejection of unwanted remixes, edits, bootlegs, etc.
  const targetModifiers = extractDerivativeModifiers(`${targetArtist} ${targetTitle}`);
  const candidateModifiers = extractDerivativeModifiers(`${candidateUploader} ${candidateTitle}`);

  for (const cMod of candidateModifiers) {
    // If candidate has a modifier that target track does NOT have, reject it
    if (!targetModifiers.includes(cMod)) {
      return {
        accepted: false,
        score: 0,
        reason: `Unwanted version modifier: ${cMod}`,
      };
    }
  }

  // 4. Duration compatibility check: reject snippets (<45s) and DJ sets/long mixes (>120s diff)
  if (targetDurationSeconds && candidate.duration) {
    const candidateSeconds = Math.round(candidate.duration / 1000);
    const diff = Math.abs(candidateSeconds - targetDurationSeconds);

    if (diff > 120 || (targetDurationSeconds > 90 && candidateSeconds < 45)) {
      return {
        accepted: false,
        score: 0,
        reason: `Duration mismatch: expected ~${targetDurationSeconds}s, candidate is ${candidateSeconds}s`,
      };
    }
  }

  // 5. Calculate deterministic match score (0 - 100)
  let score = 50;

  if (titleExactMatch) {
    score += 30;
  } else if (titlePhraseMatch) {
    score += 20;
  } else {
    score += Math.round(titleSim * 20);
  }

  if (uploaderExactMatch) {
    score += 15;
  } else if (isSafeTokenMatch) {
    score += 10;
  }

  if (targetDurationSeconds && candidate.duration) {
    const candidateSeconds = Math.round(candidate.duration / 1000);
    const diff = Math.abs(candidateSeconds - targetDurationSeconds);
    if (diff <= 5) {
      score += 10;
    } else if (diff <= 15) {
      score += 5;
    } else if (diff > 45) {
      score -= 10;
    }
  }

  return {
    accepted: score >= 65,
    score: Math.max(0, Math.min(100, score)),
  };
}

export interface SoundCloudTranscoding {
  url: string;
  preset: string;
  duration?: number;
  format: {
    protocol: string; // e.g. 'hls' or 'progressive'
    mime_type: string; // e.g. 'audio/ogg; codecs="opus"' or 'audio/mpeg'
  };
  quality: string; // e.g. 'sq'
}

export interface SoundCloudTrackItem {
  id: number | string;
  title: string;
  user?: { username?: string; permalink_url?: string };
  permalink_url?: string;
  artwork_url?: string;
  duration?: number;
  policy?: string; // 'ALLOW' | 'BLOCK' | 'MONETIZE'
  monetization_model?: string;
  streamable?: boolean;
  playable?: boolean;
  access?: string; // 'playable' | 'preview' | 'blocked'
  media?: {
    transcodings?: SoundCloudTranscoding[];
  };
  stream_url?: string;
}

/**
 * Checks if a transcoding format is encrypted or requires DRM decryption.
 */
export function isEncryptedTranscoding(t: SoundCloudTranscoding): boolean {
  if (!t) return false;
  const protocol = (t.format?.protocol || '').toLowerCase();
  const preset = (t.preset || '').toLowerCase();
  return (
    protocol.includes('encrypted') ||
    protocol.includes('cbc') ||
    protocol.includes('ctr') ||
    preset.includes('encrypted') ||
    preset.includes('cbc') ||
    preset.includes('ctr')
  );
}

/**
 * Checks if candidate is officially playable and extracts the best transcoding URL.
 * Priority:
 * 1. HLS AAC 160 (`hls_aac_160_url` or preset containing 'aac_160')
 * 2. HLS AAC 96 (`hls_aac_96_url` or preset containing 'aac_96')
 * 3. HLS MP3 / Progressive MP3 / Any valid audio stream
 */
export function extractPlayableTranscoding(item: SoundCloudTrackItem): {
  isPlayable: boolean;
  isFull: boolean;
  transcodingUrl?: string;
  streamFormat?: string;
} {
  // Check blocked status
  if (item.policy === 'BLOCK' || item.access === 'blocked') {
    return { isPlayable: false, isFull: false };
  }

  // Check playability flags
  const isPlayable = item.playable !== false && item.streamable !== false;
  if (!isPlayable) {
    return { isPlayable: false, isFull: false };
  }

  // Strict full playback check
  const isPreview = item.access === 'preview' || item.policy === 'SNIP';
  const isFull = !isPreview;

  const transcodings = item.media?.transcodings;
  if (!Array.isArray(transcodings) || transcodings.length === 0) {
    // If direct stream_url is present
    if (item.stream_url) {
      return {
        isPlayable: true,
        isFull,
        transcodingUrl: item.stream_url,
        streamFormat: 'direct',
      };
    }
    return { isPlayable: false, isFull: false };
  }

  // Filter out any encrypted/DRM transcodings
  const compatibleTranscodings = transcodings.filter((t) => !isEncryptedTranscoding(t));
  if (compatibleTranscodings.length === 0) {
    return { isPlayable: false, isFull: false };
  }

  // 1. Priority: HLS AAC 160
  const hlsAac160 = compatibleTranscodings.find(
    (t) =>
      t.format?.protocol === 'hls' &&
      (t.preset?.includes('aac_160') || t.preset?.includes('160'))
  );
  if (hlsAac160?.url) {
    return {
      isPlayable: true,
      isFull,
      transcodingUrl: hlsAac160.url,
      streamFormat: 'hls_aac_160',
    };
  }

  // 2. Priority: HLS AAC 96
  const hlsAac96 = compatibleTranscodings.find(
    (t) =>
      t.format?.protocol === 'hls' &&
      (t.preset?.includes('aac_96') || t.preset?.includes('96'))
  );
  if (hlsAac96?.url) {
    return {
      isPlayable: true,
      isFull,
      transcodingUrl: hlsAac96.url,
      streamFormat: 'hls_aac_96',
    };
  }

  // 3. Fallback: Any HLS audio stream
  const anyHls = compatibleTranscodings.find((t) => t.format?.protocol === 'hls' && Boolean(t.url));
  if (anyHls?.url) {
    return {
      isPlayable: true,
      isFull,
      transcodingUrl: anyHls.url,
      streamFormat: anyHls.preset || 'hls',
    };
  }

  // 4. Fallback: Progressive HTTP audio stream (e.g. mp3)
  const progressive = compatibleTranscodings.find(
    (t) => t.format?.protocol === 'progressive' && Boolean(t.url)
  );
  if (progressive?.url) {
    return {
      isPlayable: true,
      isFull,
      transcodingUrl: progressive.url,
      streamFormat: progressive.preset || 'progressive_mp3',
    };
  }

  return { isPlayable: false, isFull: false };
}

export interface SoundCloudResolutionMetrics {
  soundcloudResolutionAttempts: number;
  soundcloudSearchSuccess: number;
  soundcloudMatchSuccess: number;
  soundcloudStreamSuccess: number;
  soundcloudFullSourceProduced: number;
  itunesFallbackCount: number;
}

export const soundCloudMetrics: SoundCloudResolutionMetrics = {
  soundcloudResolutionAttempts: 0,
  soundcloudSearchSuccess: 0,
  soundcloudMatchSuccess: 0,
  soundcloudStreamSuccess: 0,
  soundcloudFullSourceProduced: 0,
  itunesFallbackCount: 0,
};

export function resetSoundCloudMetrics(): void {
  soundCloudMetrics.soundcloudResolutionAttempts = 0;
  soundCloudMetrics.soundcloudSearchSuccess = 0;
  soundCloudMetrics.soundcloudMatchSuccess = 0;
  soundCloudMetrics.soundcloudStreamSuccess = 0;
  soundCloudMetrics.soundcloudFullSourceProduced = 0;
  soundCloudMetrics.itunesFallbackCount = 0;
}

export function getSoundCloudMetrics(): SoundCloudResolutionMetrics {
  return { ...soundCloudMetrics };
}

let cachedDynamicClientId: string | null = null;
let dynamicClientExpiresAt: number = 0;

/**
 * Resolves active SoundCloud client ID:
 * 1. Checks preferred/configured ID (caches for 6 hours if successful).
 * 2. If missing or returning 401/403, dynamically discovers active client ID from soundcloud.com web app assets (caches for 12 hours if successful).
 * 
 * Architectural risk:
 * SoundCloud client ID discovery depends on the current SoundCloud web application
 * bundle structure and may break after frontend changes. It is a fallback mechanism,
 * not a guaranteed stable official API-contract.
 */
export async function resolveActiveSoundCloudClientId(preferredId?: string): Promise<string | null> {
  const envId = preferredId || process.env.SOUNDCLOUD_CLIENT_ID;

  // 1. If we have a validated dynamic cached client ID with TTL, return it
  if (cachedDynamicClientId && Date.now() < dynamicClientExpiresAt) {
    return cachedDynamicClientId;
  }

  // 2. Test the preferred / env ID if available
  if (envId && envId.trim().length > 0) {
    try {
      const probeRes = await fetch(
        `https://api-v2.soundcloud.com/search/tracks?q=Burial&limit=1&client_id=${encodeURIComponent(envId)}`,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Referer: 'https://soundcloud.com/',
          },
        }
      );
      if (probeRes.ok) {
        cachedDynamicClientId = envId;
        dynamicClientExpiresAt = Date.now() + 6 * 60 * 60 * 1000;
        return envId;
      }
    } catch {
      // Continue to dynamic discovery
    }
  }

  // 3. Dynamic Discovery from soundcloud.com web client assets
  try {
    const homeRes = await fetch('https://soundcloud.com', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    const html = await homeRes.text();
    const scriptUrls = [...html.matchAll(/<script[^>]+src="([^">]+\.js)"/g)].map((m) => m[1]);
    for (const scriptUrl of scriptUrls.reverse()) {
      const scriptRes = await fetch(scriptUrl);
      const text = await scriptRes.text();
      const match = text.match(/client_id[:=]"([a-zA-Z0-9]{32})"/);
      if (match && match[1]) {
        cachedDynamicClientId = match[1];
        dynamicClientExpiresAt = Date.now() + 12 * 60 * 60 * 1000; // 12 hours
        return cachedDynamicClientId;
      }
    }
  } catch (err) {
    // Discovery failed
  }

  return envId || null;
}

/**
 * Resolves the actual playable audio stream URL from a SoundCloud transcoding URL.
 * Handles rate limits, authentication, and short TTL caching.
 */
export async function resolveSoundCloudStreamUrl(
  transcodingUrl: string,
  clientId: string,
  timeoutMs: number = 3500
): Promise<string | null> {
  if (!transcodingUrl || !clientId) return null;

  // Check stream cache
  const cached = soundcloudStreamCache.get(transcodingUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const delimiter = transcodingUrl.includes('?') ? '&' : '?';
    const requestUrl = `${transcodingUrl}${delimiter}client_id=${encodeURIComponent(clientId)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(requestUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
        Referer: 'https://soundcloud.com/',
      },
    });
    clearTimeout(timer);

    if (res.status === 401 || res.status === 403 || res.status === 429) {
      return null;
    }

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as { url?: string };
    if (data.url && typeof data.url === 'string') {
      // Stream URLs are signed/temporary; cache with short TTL (10 minutes)
      soundcloudStreamCache.set(transcodingUrl, {
        data: data.url,
        expiresAt: Date.now() + STREAM_CACHE_TTL_MS,
      });
      return data.url;
    }
  } catch {
    // Timeout or network error
  }

  return null;
}

export type DiagnosticStageStatus = 'PASS' | 'FAIL' | 'UNKNOWN' | 'MANUAL_REQUIRED';

export interface PlaybackDiagnosticResult {
  search: DiagnosticStageStatus;
  match: DiagnosticStageStatus;
  access: DiagnosticStageStatus;
  transcoding: DiagnosticStageStatus;
  streamResolution: DiagnosticStageStatus;
  audioElement: DiagnosticStageStatus;
  canPlay: DiagnosticStageStatus;
  play: DiagnosticStageStatus;
  playback30s: DiagnosticStageStatus;
  overallStatus: 'PASS' | 'FAIL' | 'MANUAL_REQUIRED';
  details: {
    matchedTrackId?: string | number;
    matchedTitle?: string;
    uploader?: string;
    matchScore?: number;
    transcodingPreset?: string;
    streamUrlResolved?: boolean;
    failureReason?: string;
  };
}

/**
 * Executes a step-by-step diagnostic of the SoundCloud playback pipeline.
 * Explicitly marks browser-only / physical audio stages as MANUAL_REQUIRED in server/headless environments.
 */
export async function runSoundCloudPlaybackDiagnostic(
  artist: string,
  title: string,
  durationSeconds?: number,
  overrideClientId?: string
): Promise<PlaybackDiagnosticResult> {
  const clientId = overrideClientId || process.env.SOUNDCLOUD_CLIENT_ID;

  const result: PlaybackDiagnosticResult = {
    search: 'FAIL',
    match: 'FAIL',
    access: 'FAIL',
    transcoding: 'FAIL',
    streamResolution: 'FAIL',
    audioElement: 'UNKNOWN',
    canPlay: 'UNKNOWN',
    play: 'UNKNOWN',
    playback30s: 'UNKNOWN',
    overallStatus: 'FAIL',
    details: {},
  };

  if (!clientId) {
    result.details.failureReason = 'SoundCloud Client ID not configured';
    return result;
  }

  try {
    const query = `${artist} ${title}`;
    const searchEndpoint = `https://api.soundcloud.com/tracks?q=${encodeURIComponent(
      query
    )}&limit=6&client_id=${encodeURIComponent(clientId)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(searchEndpoint, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Accept: 'application/json',
      },
    });
    clearTimeout(timer);

    if (!res.ok) {
      result.search = 'FAIL';
      result.details.failureReason = `Search HTTP ${res.status}`;
      return result;
    }

    const items = (await res.json()) as SoundCloudTrackItem[];
    if (!Array.isArray(items) || items.length === 0) {
      result.search = 'FAIL';
      result.details.failureReason = 'No search results from SoundCloud API';
      return result;
    }
    result.search = 'PASS';

    // 2. Match
    const candidates = items
      .map((item) => {
        const evalRes = evaluateSoundCloudMatch(artist, title, durationSeconds, item);
        return { item, evalRes };
      })
      .filter((c) => c.evalRes.accepted)
      .sort((a, b) => b.evalRes.score - a.evalRes.score);

    if (candidates.length === 0) {
      result.match = 'FAIL';
      result.details.failureReason = 'No candidate met strict matching criteria';
      return result;
    }

    const best = candidates[0];
    result.match = 'PASS';
    result.details.matchedTrackId = best.item.id;
    result.details.matchedTitle = best.item.title;
    result.details.uploader = best.item.user?.username;
    result.details.matchScore = best.evalRes.score;

    // 3. Access
    const playableInfo = extractPlayableTranscoding(best.item);
    if (!playableInfo.isPlayable) {
      result.access = 'FAIL';
      result.details.failureReason = 'Track is blocked or not streamable';
      return result;
    }
    result.access = 'PASS';

    // 4. Transcoding
    if (!playableInfo.transcodingUrl) {
      result.transcoding = 'FAIL';
      result.details.failureReason = 'No playable transcoding URL available';
      return result;
    }
    result.transcoding = 'PASS';
    result.details.transcodingPreset = playableInfo.streamFormat;

    // 5. Stream resolution
    const streamUrl = await resolveSoundCloudStreamUrl(
      playableInfo.transcodingUrl,
      clientId
    );
    if (!streamUrl) {
      result.streamResolution = 'FAIL';
      result.details.failureReason = 'Failed to resolve stream URL from transcoding endpoint';
      return result;
    }
    result.streamResolution = 'PASS';
    result.details.streamUrlResolved = true;

    // 6. Audio element & runtime checks
    if (typeof Audio === 'undefined') {
      // In server or test environment without Audio hardware
      result.audioElement = 'MANUAL_REQUIRED';
      result.canPlay = 'MANUAL_REQUIRED';
      result.play = 'MANUAL_REQUIRED';
      result.playback30s = 'MANUAL_REQUIRED';
      result.overallStatus = 'MANUAL_REQUIRED';
    } else {
      // In browser environment, caller can execute audio element validation
      result.audioElement = 'UNKNOWN';
      result.canPlay = 'UNKNOWN';
      result.play = 'UNKNOWN';
      result.playback30s = 'UNKNOWN';
      result.overallStatus = 'MANUAL_REQUIRED';
    }

    return result;
  } catch (err: any) {
    result.details.failureReason = err?.message || 'Unexpected diagnostic exception';
    return result;
  }
}

/**
 * SoundCloudProviderAdapter implementing MusicProviderAdapter
 */
export class SoundCloudProviderAdapter implements MusicProviderAdapter {
  readonly provider = 'soundcloud' as const;

  private clientId: string | undefined;
  private explicitUndefined: boolean = false;

  constructor(options?: { clientId?: string }) {
    if (options && 'clientId' in options && options.clientId === undefined) {
      this.explicitUndefined = true;
    }
    this.clientId = options?.clientId || process.env.SOUNDCLOUD_CLIENT_ID;
  }

  public isConfigured(): boolean {
    if (this.explicitUndefined) return false;
    return Boolean(
      (this.clientId && this.clientId.trim().length > 0) ||
        process.env.SOUNDCLOUD_CLIENT_ID ||
        cachedDynamicClientId
    );
  }

  public async getActiveClientId(): Promise<string | null> {
    if (this.explicitUndefined) return null;
    return resolveActiveSoundCloudClientId(this.clientId);
  }

  /**
   * Searches for a track on SoundCloud and returns a playable TrackSource.
   */
  async searchTrack(
    queryOrArtist: TrackSearchQuery | Track | string,
    maybeTitle?: string
  ): Promise<TrackSource | null> {
    if (!this.isConfigured()) {
      return null;
    }

    soundCloudMetrics.soundcloudResolutionAttempts++;

    let artist = '';
    let title = '';
    let targetDurationSeconds: number | undefined;

    if (typeof queryOrArtist === 'string') {
      artist = queryOrArtist;
      title = maybeTitle || '';
    } else {
      artist = queryOrArtist.artist;
      title = queryOrArtist.title;
      targetDurationSeconds = queryOrArtist.durationSeconds;
    }

    if (!artist || !title) return null;

    const cacheKey = getSoundCloudCacheKey(artist, title);
    const cached = soundcloudSearchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.data?.playback === 'full') {
        soundCloudMetrics.soundcloudFullSourceProduced++;
      }
      return cached.data;
    }

    const activeId = await this.getActiveClientId();
    if (!activeId) return null;

    try {
      // Multi-step query fallback strategy:
      // 1. "Artist Title"
      // 2. "Artist - Title"
      // 3. "Title" (strictly validated against artist metadata)
      const queryCandidates = [
        `${artist} ${title}`,
        `${artist} - ${title}`,
        title,
      ];

      let rawItems: SoundCloudTrackItem[] = [];
      let searchOk = false;

      for (const query of queryCandidates) {
        const searchEndpoint = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(
          query
        )}&limit=10&client_id=${encodeURIComponent(activeId)}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        try {
          const res = await fetch(searchEndpoint, {
            signal: controller.signal,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Accept: 'application/json',
              Referer: 'https://soundcloud.com/',
              Origin: 'https://soundcloud.com',
            },
          });
          clearTimeout(timeoutId);

          if (res.ok) {
            searchOk = true;
            const resJson = await res.json();
            const items = Array.isArray(resJson) ? resJson : (resJson?.collection || []);
            if (items.length > 0) {
              rawItems = items;
              break;
            }
          }
        } catch {
          clearTimeout(timeoutId);
        }
      }

      if (searchOk) {
        soundCloudMetrics.soundcloudSearchSuccess++;
      }

      if (rawItems.length === 0) {
        soundcloudSearchCache.set(cacheKey, {
          data: null,
          expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
        });
        return null;
      }

      // Filter and score candidates
      const scoredCandidates: Array<{
        item: SoundCloudTrackItem;
        score: number;
        transcodingUrl?: string;
        streamFormat?: string;
        isFull: boolean;
      }> = [];

      for (const item of rawItems) {
        const evalResult = evaluateSoundCloudMatch(
          artist,
          title,
          targetDurationSeconds,
          item
        );
        if (!evalResult.accepted) continue;

        const playableInfo = extractPlayableTranscoding(item);
        if (!playableInfo.isPlayable || !playableInfo.transcodingUrl) continue;

        let adjustedScore = evalResult.score;
        if (playableInfo.isFull) {
          adjustedScore += 10;
        }
        if (item.duration && item.duration < 60000) {
          adjustedScore -= 20; // penalize snippets
        }

        scoredCandidates.push({
          item,
          score: adjustedScore,
          transcodingUrl: playableInfo.transcodingUrl,
          streamFormat: playableInfo.streamFormat,
          isFull: playableInfo.isFull,
        });
      }

      if (scoredCandidates.length === 0) {
        soundcloudSearchCache.set(cacheKey, {
          data: null,
          expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
        });
        return null;
      }

      soundCloudMetrics.soundcloudMatchSuccess++;

      // Sort by match score descending
      scoredCandidates.sort((a, b) => b.score - a.score);
      const best = scoredCandidates[0];

      // Resolve the actual stream URL
      const streamUrl = await resolveSoundCloudStreamUrl(
        best.transcodingUrl!,
        activeId
      );

      if (!streamUrl) {
        return null;
      }

      soundCloudMetrics.soundcloudStreamSuccess++;
      if (best.isFull) {
        soundCloudMetrics.soundcloudFullSourceProduced++;
      }

      const source: TrackSource = {
        provider: 'soundcloud',
        playback: best.isFull ? 'full' : 'preview',
        providerTrackId: String(best.item.id),
        url: streamUrl,
        available: true,
        authorName: best.item.user?.username,
        authorUrl: best.item.user?.permalink_url,
        permalinkUrl: best.item.permalink_url,
        artworkUrl: best.item.artwork_url,
        durationMs: best.item.duration,
        streamFormat: best.streamFormat,
      };

      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[Speed of Sound] SoundCloud stream resolved: "${artist} - ${title}" (ID: ${best.item.id}, format: ${best.streamFormat}, playback: ${source.playback})`
        );
      }

      soundcloudSearchCache.set(cacheKey, {
        data: source,
        expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
      });

      return source;
    } catch {
      return null;
    }
  }
}

export const soundCloudAdapter = new SoundCloudProviderAdapter();
