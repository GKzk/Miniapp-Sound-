import type { MusicProviderAdapter, TrackSource } from './types';

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
 */
export function normalizeSearchString(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
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

export function clearSoundCloudCaches(): void {
  soundcloudSearchCache.clear;
  soundcloudStreamCache.clear();
}

// Common version modifiers that indicate derivative or altered tracks
const DERIVATIVE_MODIFIERS = [
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
  'tribute',
  'karaoke',
  'mashup',
];

/**
 * Checks if a string contains derivative modifiers (e.g. remix, live, bootleg, etc.)
 */
export function extractDerivativeModifiers(text: string): string[] {
  const norm = normalizeSearchString(text);
  const words = norm.split(' ');
  const found: string[] = [];
  for (const mod of DERIVATIVE_MODIFIERS) {
    if (mod.includes(' ')) {
      if (norm.includes(mod)) found.push(mod);
    } else {
      if (words.includes(mod)) found.push(mod);
    }
  }
  return found;
}

/**
 * Token overlap / Jaccard similarity score between 0 and 1
 */
function tokenSimilarity(a: string, b: string): number {
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
 * 1. Checks artist similarity (exact, substring, or high token overlap)
 * 2. Checks title similarity
 * 3. Rejects remixes / edits / bootlegs / covers unless the target track itself is one
 * 4. Checks duration compatibility if both durations are available
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
  // The artist might be the uploader, or might be written as "Artist - Title" in the candidate title
  const uploaderSim = tokenSimilarity(normTargetArtist, normCandidateUploader);
  const titleContainsArtist = normCandidateTitle.includes(normTargetArtist);
  const isArtistMatch =
    uploaderSim >= 0.6 ||
    titleContainsArtist ||
    normCandidateUploader.includes(normTargetArtist) ||
    normTargetArtist.includes(normCandidateUploader);

  if (!isArtistMatch) {
    return {
      accepted: false,
      score: 0,
      reason: 'Artist mismatch',
    };
  }

  // 2. Title Matching
  const titleSim = tokenSimilarity(normTargetTitle, normCandidateTitle);
  const titleExactSubstring = normCandidateTitle.includes(normTargetTitle);

  if (!titleExactSubstring && titleSim < 0.4) {
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

  // 4. Calculate deterministic match score (0 - 100)
  let score = 50;

  // Exact title match bonus
  if (normCandidateTitle === normTargetTitle || normCandidateTitle === `${normTargetArtist} ${normTargetTitle}`) {
    score += 30;
  } else if (titleExactSubstring) {
    score += 20;
  } else {
    score += Math.round(titleSim * 20);
  }

  // Exact uploader match bonus
  if (normCandidateUploader === normTargetArtist) {
    score += 15;
  } else if (uploaderSim >= 0.8) {
    score += 10;
  }

  // Duration compatibility bonus / penalty (if available)
  if (targetDurationSeconds && candidate.duration) {
    const candidateSeconds = Math.round(candidate.duration / 1000);
    const diff = Math.abs(candidateSeconds - targetDurationSeconds);
    if (diff <= 5) {
      score += 10;
    } else if (diff <= 15) {
      score += 5;
    } else if (diff > 90) {
      // High duration discrepancy indicates extended mix, set, or radio snippet
      score -= 20;
    }
  }

  return {
    accepted: score >= 50,
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
 * Checks if candidate is officially playable and extracts the best transcoding URL.
 * According to modern SoundCloud API (2025/2026 specs):
 * Priority:
 * 1. HLS AAC 160 (`hls_aac_160_url` or preset containing 'aac_160')
 * 2. HLS AAC 96 (`hls_aac_96_url` or preset containing 'aac_96')
 * 3. HLS MP3 / Progressive MP3 / Any valid HLS audio
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

  const isFull = item.access !== 'preview' && item.policy !== 'SNIP';

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

  // 1. Priority: HLS AAC 160
  const hlsAac160 = transcodings.find(
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
  const hlsAac96 = transcodings.find(
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
  const anyHls = transcodings.find((t) => t.format?.protocol === 'hls' && Boolean(t.url));
  if (anyHls?.url) {
    return {
      isPlayable: true,
      isFull,
      transcodingUrl: anyHls.url,
      streamFormat: anyHls.preset || 'hls',
    };
  }

  // 4. Fallback: Progressive HTTP audio stream (e.g. mp3)
  const progressive = transcodings.find(
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

/**
 * Resolves the actual playable audio stream URL from a SoundCloud transcoding URL.
 * Handles rate limits, authentication, and short TTL caching.
 */
export async function resolveSoundCloudStreamUrl(
  transcodingUrl: string,
  clientId: string,
  timeoutMs: number = 3000
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Accept: 'application/json',
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

/**
 * SoundCloudProviderAdapter implementing MusicProviderAdapter
 */
export class SoundCloudProviderAdapter implements MusicProviderAdapter {
  readonly provider = 'soundcloud' as const;

  private clientId: string | undefined;
  private clientSecret: string | undefined;

  constructor(options?: { clientId?: string; clientSecret?: string }) {
    this.clientId = options?.clientId || process.env.SOUNDCLOUD_CLIENT_ID;
    this.clientSecret = options?.clientSecret || process.env.SOUNDCLOUD_CLIENT_SECRET;
  }

  public isConfigured(): boolean {
    return Boolean(this.clientId && this.clientId.trim().length > 0);
  }

  /**
   * Searches for a track on SoundCloud and returns a playable TrackSource.
   */
  async searchTrack(
    artist: string,
    title: string,
    targetDurationSeconds?: number
  ): Promise<TrackSource | null> {
    // Stage 4C Test 56: If no credentials configured, gracefully return null
    if (!this.isConfigured()) {
      return null;
    }

    const cacheKey = getSoundCloudCacheKey(artist, title);
    const cached = soundcloudSearchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    try {
      const query = `${artist} ${title}`;
      const searchEndpoint = `https://api.soundcloud.com/tracks?q=${encodeURIComponent(
        query
      )}&limit=6&client_id=${encodeURIComponent(this.clientId!)}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(searchEndpoint, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          Accept: 'application/json',
        },
      });
      clearTimeout(timeoutId);

      // Handle HTTP status codes: 401, 403, 429, 5xx
      if (res.status === 401 || res.status === 403) {
        // Bad credentials or forbidden
        return null;
      }
      if (res.status === 429) {
        // Rate limited — do not crash, return null
        return null;
      }
      if (!res.ok) {
        // 5xx or other server failure
        return null;
      }

      const rawItems = (await res.json()) as SoundCloudTrackItem[];
      if (!Array.isArray(rawItems) || rawItems.length === 0) {
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

        scoredCandidates.push({
          item,
          score: evalResult.score,
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

      // Sort by match score descending
      scoredCandidates.sort((a, b) => b.score - a.score);
      const best = scoredCandidates[0];

      // Resolve the actual stream URL
      const streamUrl = await resolveSoundCloudStreamUrl(
        best.transcodingUrl!,
        this.clientId!
      );

      if (!streamUrl) {
        // Stream resolution failure → graceful null fallback
        return null;
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

      soundcloudSearchCache.set(cacheKey, {
        data: source,
        expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
      });

      return source;
    } catch {
      // Timeout, network drop or invalid response
      return null;
    }
  }
}

export const soundCloudAdapter = new SoundCloudProviderAdapter();

