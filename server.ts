import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import { SPEED_SOUND_TRACKS } from './src/data/tracks';
import { enrichWithLastFm } from './src/services/lastfm';
import type { Track, VibeAnalysis, MusicProfile, GenreScore, ScoreBreakdown, RankedCandidate, TrackSource } from './src/types';
import { resolveITunesAudio } from './src/services/musicProviders/itunes';
import { soundCloudAdapter, getSoundCloudMetrics } from './src/services/musicProviders/soundcloud';
import {
  resolveTrackSources,
  getPlayableSource,
  enrichTrackWithSources,
  defaultMusicProviders,
} from './src/services/musicProviders';
import { storage } from './server/storage';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Generous payload size for base64 photos
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Lazy Gemini client helper
let aiClient: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI | null {
  if (!aiClient && process.env.GEMINI_API_KEY) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Status extractor that sanitizes Gemini API notices without dumping raw error JSON
export function parseGeminiNoticeStatus(err: any): string {
  if (!err) return 'service busy';
  if (err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('abort')) {
    return 'timeout';
  }
  const raw = typeof err === 'string' ? err : (err.message || String(err));
  try {
    const parsed = JSON.parse(raw);
    if (parsed.error?.code === 503 || parsed.error?.status === 'UNAVAILABLE') {
      return '503 (high demand)';
    }
    if (parsed.error?.code === 429 || parsed.error?.status === 'RESOURCE_EXHAUSTED') {
      return '429 (quota limit)';
    }
    if (parsed.error?.status) {
      return `${parsed.error.code || ''} ${parsed.error.status}`.trim();
    }
  } catch {
    // not JSON
  }
  if (raw.includes('503') || raw.includes('high demand') || raw.includes('UNAVAILABLE')) {
    return '503 (high demand)';
  }
  if (raw.includes('429') || raw.includes('quota') || raw.includes('RESOURCE_EXHAUSTED')) {
    return '429 (quota limit)';
  }
  if (raw.includes('404') || raw.includes('NOT_FOUND')) {
    return '404 (not found)';
  }
  return 'temporarily unavailable';
}

// Circuit Breaker for Gemini API to gracefully switch to fast deterministic algorithms during demand spikes
export class GeminiCircuitBreaker {
  private static cooldownUntil = 0;
  private static consecutiveFailures = 0;
  private static readonly COOLDOWN_DURATION_MS = 60_000;

  public static isAvailable(): boolean {
    return Date.now() >= this.cooldownUntil;
  }

  public static recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.cooldownUntil = 0;
  }

  public static recordFailure(status?: string): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= 2 || status?.includes('503') || status?.includes('429')) {
      this.cooldownUntil = Date.now() + this.COOLDOWN_DURATION_MS;
      console.info(`[Speed of Sound] Gemini API cooldown activated (${status || 'high demand'}). Fast deterministic fallback active.`);
    }
  }

  public static reset(): void {
    this.cooldownUntil = 0;
    this.consecutiveFailures = 0;
  }
}

// In-memory cache for Stage 3A Semantic Reranking results
export const semanticRerankCache = new Map<string, Track[]>();
export function getRerankCacheKey(profile: MusicProfile, candidates: RankedCandidate[], limit: number): string {
  const cIds = candidates.slice(0, 15).map(c => c.track.id).join(',');
  const energy = profile.music_profile?.energy ?? 0;
  const targetBpm = profile.tempo?.target ?? 0;
  const verdict = profile.vibe_verdict || profile.strategy_concept || '';
  return `${verdict}_${energy}_${targetBpm}_${cIds}_${limit}`;
}

export function clearSemanticRerankCache(): void {
  semanticRerankCache.clear();
}

// Subscription checker helper (supports real Telegram Bot API if TELEGRAM_BOT_TOKEN is set)
async function verifyTelegramChannelSubscription(userId: string | number): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !userId) {
    return false;
  }
  try {
    const channelId = '@speed_sound';
    const url = `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(channelId)}&user_id=${encodeURIComponent(userId)}`;
    const res = await fetch(url);
    const data = await res.json() as { ok: boolean; result?: { status: string } };
    if (data && data.ok && data.result) {
      const status = data.result.status;
      return ['member', 'administrator', 'creator'].includes(status);
    }
  } catch (err) {
    console.error('Telegram subscription check error:', err);
  }
  return false;
}

// In-memory cache for audio streams & artwork
const audioCache = new Map<string, { audioUrl: string; artworkUrl?: string; durationSeconds?: number }>();

// In-memory cache for vibe analysis results to save quota and speed up responses
const vibeAnalysisCache = new Map<string, { vibe: VibeAnalysis; profile?: MusicProfile }>();

// Real studio audio resolver via Apple iTunes / CDN Search API (Stage 4B: delegates to iTunes adapter)
export async function resolveRealAudio(artist: string, title: string): Promise<{
  audioUrl?: string;
  artworkUrl?: string;
  durationSeconds?: number;
  providerTrackId?: string;
  source?: TrackSource;
}> {
  return resolveITunesAudio(artist, title);
}

// Re-export provider abstraction functions for convenience
export { resolveTrackSources, getPlayableSource, enrichTrackWithSources };

// Enrich an array of tracks via the unified provider pipeline (SoundCloud full stream priority -> iTunes preview fallback)
export async function enrichTracksWithRealAudio(tracks: Track[]): Promise<Track[]> {
  // Use controlled concurrency (3-5 items per batch) to respect external API rate limits
  const concurrency = 4;
  const results: Track[] = [];

  for (let i = 0; i < tracks.length; i += concurrency) {
    const chunk = tracks.slice(i, i + concurrency);
    const chunkEnriched = await Promise.all(
      chunk.map((t) => enrichTrackWithSources(t, defaultMusicProviders))
    );
    results.push(...chunkEnriched);
  }

  // Development/Production Diagnostic Observability Trace (Requirements 3 & 4)
  if (process.env.NODE_ENV !== 'test') {
    console.log('\n======================================================');
    console.log('[Speed of Sound] PRODUCTION AUDIO ENRICHMENT TRACE');
    console.log('======================================================');
    results.forEach((t, idx) => {
      const playable = getPlayableSource(t);
      const sc = t.sources?.find((s) => s.provider === 'soundcloud');
      const itunes = t.sources?.find((s) => s.provider === 'itunes');

      console.log(`\nTRACK ${idx + 1}`);
      console.log(`Artist: ${t.artist}`);
      console.log(`Title:  ${t.title}`);
      console.log('PROVIDER RESOLUTION:');
      console.log(`SoundCloud search: ${sc ? 'RESULT (candidates found)' : 'NO_MATCH'}`);
      console.log(`SoundCloud match:  ${sc ? 'ACCEPTED' : 'REJECTED'}`);
      console.log(`SoundCloud access: ${sc ? 'PASS' : 'SKIPPED'}`);
      console.log(`SoundCloud transcoding: ${sc?.streamFormat || 'NONE'}`);
      console.log(`SoundCloud stream: ${sc?.url ? 'RESOLVED' : 'NONE'}`);
      console.log(`SoundCloud source: ${sc ? `PRODUCED (${sc.playback})` : 'NONE'}`);
      console.log('iTunes:');
      console.log(`search:  ${itunes ? 'FOUND' : 'SKIPPED'}`);
      console.log(`preview: ${itunes ? 'AVAILABLE' : 'NONE'}`);
      console.log('FINAL SOURCE:');
      console.log(`provider: ${playable?.provider || 'dsp_procedural'}`);
      console.log(`playback: ${playable?.playback || 'synthesizer'}`);
      if (playable?.url) {
        try {
          const host = new URL(playable.url).hostname;
          console.log(`url host: ${host}`);
        } catch {
          console.log('url: [valid]');
        }
      }
    });

    const metrics = getSoundCloudMetrics();
    console.log('\n------------------------------------------------------');
    console.log('[Speed of Sound] SOUNDCLOUD RESOLUTION COUNTERS:');
    console.log(`SoundCloud attempts:       ${metrics.soundcloudResolutionAttempts}`);
    console.log(`SoundCloud search success: ${metrics.soundcloudSearchSuccess}`);
    console.log(`SoundCloud match success:  ${metrics.soundcloudMatchSuccess}`);
    console.log(`SoundCloud stream success: ${metrics.soundcloudStreamSuccess}`);
    console.log(`SoundCloud full sources:   ${metrics.soundcloudFullSourceProduced}`);
    console.log(`iTunes fallback:           ${metrics.itunesFallbackCount}`);
    console.log('======================================================\n');
  }

  return results;
}

// ==========================================
// STAGE 2: CANDIDATE RETRIEVAL & DETERMINISTIC RANKING ENGINE
// ==========================================

export function normalizeText(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[#.,/#!$%^&*;:{}=\-_`~()?"'’«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isHardAvoidMatch(track: Track, avoidList: string[]): boolean {
  if (!Array.isArray(avoidList) || avoidList.length === 0) return false;

  const normArtist = normalizeText(track.artist);
  const normTitle = normalizeText(track.title);
  const trackGenres = (track.genres || []).map(normalizeText);

  for (const rawAvoid of avoidList) {
    if (!rawAvoid || typeof rawAvoid !== 'string') continue;
    const normAvoid = normalizeText(rawAvoid);
    if (!normAvoid) continue;

    // 1. Exact artist match
    if (normArtist === normAvoid) return true;

    // 2. Exact title match
    if (normTitle === normAvoid) return true;

    // 3. Exact genre match (entire normalized genre string matches)
    for (const g of trackGenres) {
      if (g === normAvoid) return true;
    }
  }

  return false;
}

export function calculateAvoidPenalty(track: Track, avoidList: string[]): number {
  if (!Array.isArray(avoidList) || avoidList.length === 0) return 0;

  const trackGenres = (track.genres || []).map(normalizeText);
  const trackGenreWordSets = trackGenres.map((g) => new Set(g.split(' ').filter(Boolean)));

  const normTitle = normalizeText(track.title);
  const titleWords = new Set(normTitle.split(' ').filter(Boolean));

  const trackTagsAndMoods = [
    ...(track.vibeTags || []).map(normalizeText),
    ...(track.moods || []).map(normalizeText),
  ];
  const tagWords = new Set(
    trackTagsAndMoods.flatMap((t) => t.split(' ').filter(Boolean))
  );

  let penalty = 0;

  for (const rawAvoid of avoidList) {
    if (!rawAvoid || typeof rawAvoid !== 'string') continue;
    const normAvoid = normalizeText(rawAvoid);
    if (!normAvoid || normAvoid.length < 2) continue;

    const avoidTokens = normAvoid.split(' ').filter(Boolean);
    if (avoidTokens.length === 0) continue;

    let matched = false;

    // 1. Partial/token genre match: e.g. avoid "house" in genre "ambient house"
    for (let i = 0; i < trackGenres.length; i++) {
      const g = trackGenres[i];
      const gWords = trackGenreWordSets[i];
      if (avoidTokens.length === 1 && gWords.has(avoidTokens[0])) {
        matched = true;
        break;
      }
      if (avoidTokens.length > 1 && g.includes(normAvoid)) {
        matched = true;
        break;
      }
    }

    // 2. Title token or phrase match
    if (!matched) {
      if (avoidTokens.length === 1 && titleWords.has(avoidTokens[0])) {
        matched = true;
      } else if (avoidTokens.length > 1 && normTitle.includes(normAvoid)) {
        matched = true;
      }
    }

    // 3. VibeTags / Moods word match
    if (!matched) {
      if (avoidTokens.every((w) => tagWords.has(w))) {
        matched = true;
      }
    }

    if (matched) {
      penalty -= 5;
      if (penalty <= -10) break;
    }
  }

  return Math.max(-10, penalty);
}

/**
 * Stage 4C.5 — Final Invariant Deduplication Helper
 * Guarantees track uniqueness by ID and normalized identity (artist + title).
 * If deduplication reduces count below target limit (default 10), fills from fallbackCandidates.
 * Respects artist capping and hard avoidances without collapsing distinct remix/version titles.
 */
export function dedupeTracksById(
  tracks: Track[],
  fallbackCandidates: Track[] = [],
  limit = 10,
  maxPerArtist = 3,
  avoidList: string[] = []
): Track[] {
  if (!Array.isArray(tracks)) tracks = [];
  if (!Array.isArray(fallbackCandidates)) fallbackCandidates = [];

  const result: Track[] = [];
  const seenIds = new Set<string>();
  const seenIdentities = new Set<string>();
  const artistCounts = new Map<string, number>();

  const getIdentity = (t: Track): string => {
    return `${normalizeText(t.artist)}::${normalizeText(t.title)}`;
  };

  const processTrack = (t: Track): boolean => {
    if (!t || !t.id) return false;
    if (seenIds.has(t.id)) return false;

    const identity = getIdentity(t);
    if (seenIdentities.has(identity)) return false;

    const normArtist = normalizeText(t.artist);
    const count = artistCounts.get(normArtist) || 0;
    if (count >= maxPerArtist) return false;

    if (avoidList.length > 0 && isHardAvoidMatch(t, avoidList)) return false;

    result.push(t);
    seenIds.add(t.id);
    seenIdentities.add(identity);
    artistCounts.set(normArtist, count + 1);
    return true;
  };

  // Pass 1: Dedupe input tracks
  for (const t of tracks) {
    if (result.length >= limit) break;
    processTrack(t);
  }

  // Pass 2: Backfill from fallbackCandidates if result.length < limit
  if (result.length < limit && fallbackCandidates.length > 0) {
    for (const fc of fallbackCandidates) {
      if (result.length >= limit) break;
      processTrack(fc);
    }
  }

  // Diagnostic logging if unique candidates are genuinely insufficient
  if (result.length < limit) {
    console.info(`[Speed of Sound] Diagnostic: insufficient unique candidates (${result.length}/${limit}). Returning available unique tracks without artificial duplicates.`);
  }

  return result;
}

function calculateRelevanceIndex(track: Track, profile: MusicProfile): number {
  // 1. Genre affinity (0..40)
  let genreScore = 0;
  const trackGenres = (track.genres || []).map(normalizeText);
  const trackTags = (track.vibeTags || []).map(normalizeText);
  const allTrackGenreTokens = new Set([...trackGenres, ...trackTags].flatMap((s) => s.split(' ').filter(Boolean)));

  const profileGenres = [
    ...(profile.genres || []).map((g) => normalizeText(g.name)),
    ...(profile.subgenres || []).map((g) => normalizeText(g.name)),
  ];

  for (const pg of profileGenres) {
    if (!pg) continue;
    if (trackGenres.includes(pg)) {
      genreScore = Math.max(genreScore, 40);
      break;
    }
    const pgTokens = pg.split(' ').filter(Boolean);
    if (pgTokens.some((t) => allTrackGenreTokens.has(t))) {
      genreScore = Math.max(genreScore, 25);
    }
  }

  // 2. Energy affinity (0..30)
  const targetEnergy = Math.max(1, Math.min(10, profile.music_profile.energy / 10));
  const energyDiff = Math.abs(track.energy - targetEnergy);
  const energyScore = Math.max(0, 30 - energyDiff * 5);

  // 3. Mood affinity (0..20)
  const profileMoodTokens = new Set(
    [
      ...(profile.desired_state.mood || []),
      ...(profile.current_state.mood || []),
    ].flatMap((m) => normalizeText(m).split(' ').filter(Boolean))
  );

  const trackMoodTokens = new Set(
    [
      ...(track.moods || []),
      ...(track.vibeTags || []),
    ].flatMap((m) => normalizeText(m).split(' ').filter(Boolean))
  );

  let matchedMoodCount = 0;
  for (const token of profileMoodTokens) {
    if (trackMoodTokens.has(token)) matchedMoodCount++;
  }
  const moodScore = Math.min(20, matchedMoodCount * 7);

  // 4. BPM affinity (0..10)
  const targetBpm = profile.tempo.target || 120;
  const bpmDiff = Math.abs(track.bpm - targetBpm);
  const bpmScore = Math.max(0, 10 - bpmDiff * 0.25);

  return genreScore + energyScore + moodScore + bpmScore;
}

// Synthesizes a valid MusicProfile from a legacy VibeAnalysis for backward compatibility
export function synthesizeProfileFromVibe(vibe: VibeAnalysis): MusicProfile {
  const bpm = vibe.target_bpm || 128;
  const energy10 = Math.max(1, Math.min(10, vibe.energy_level || 5));
  const energy100 = energy10 * 10;

  const genres: GenreScore[] = (vibe.genres || []).map((name, idx) => ({
    name,
    weight: Math.max(10, 100 - idx * 25),
  }));
  if (genres.length === 0) {
    genres.push({ name: 'Electronic', weight: 100 });
  }

  return {
    current_state: {
      mood: (vibe.mood_tags || []).map((t) => t.replace(/^#/, '')),
      energy: energy100,
      emotional_intensity: energy100,
    },
    desired_state: {
      mood: (vibe.mood_tags || []).map((t) => t.replace(/^#/, '')),
      energy: energy100,
      emotional_intensity: energy100,
    },
    visual_context: {
      scene: [vibe.location_setting || 'Atmospheric Space'],
      time_of_day: vibe.time_of_day || 'Сейчас',
      atmosphere: vibe.visual_atmosphere ? [vibe.visual_atmosphere] : [],
      dominant_colors: vibe.dominant_colors || [],
      cinematic: 70,
      darkness: 50,
      warmth: 50,
      visual_energy: energy100,
    },
    music_profile: {
      energy: energy100,
      danceability: 60,
      darkness: vibe.timbre_profile?.brightness === 'dark' ? 80 : 50,
      warmth: vibe.timbre_profile?.brightness === 'warm' ? 80 : 50,
      melodicness: 60,
      atmospheric: 60,
      aggression: energy10 > 7 ? 70 : 30,
      experimental: 30,
      rhythm_density: 60,
    },
    tempo: {
      min: Math.max(60, bpm - 15),
      max: Math.min(200, bpm + 15),
      target: bpm,
    },
    genres,
    subgenres: [],
    artist_styles: [],
    avoid: [],
    discovery: 0,
    strategy_concept: vibe.vibe_verdict || 'Vibe match',
    strategy_emotional_arc: ['Intro', 'Buildup', 'Peak', 'Outro'],
    vibe_verdict: vibe.vibe_verdict || 'Vibe match',
  };
}

// 1. Candidate Retrieval: Filter and retrieve a 20-30 candidate pool without mutating objects
export function retrieveCandidates(
  profile: MusicProfile,
  catalog: Track[],
  options?: { minCandidates?: number; maxCandidates?: number }
): Track[] {
  if (!Array.isArray(catalog) || catalog.length === 0) return [];
  const minCandidates = options?.minCandidates ?? 20;
  const maxCandidates = options?.maxCandidates ?? 30;

  // Tier 1 - Hard Exclusions (Avoid)
  const nonAvoided = catalog.filter((t) => !isHardAvoidMatch(t, profile.avoid));
  if (nonAvoided.length === 0) return [];

  // Scored candidate pool by multi-tier relevance index
  const scored = nonAvoided.map((t) => ({
    track: t,
    relevance: calculateRelevanceIndex(t, profile),
  }));

  const minBpm = profile.tempo?.min || 60;
  const maxBpm = profile.tempo?.max || 200;

  const tier1 = scored
    .filter((item) => item.track.bpm >= minBpm && item.track.bpm <= maxBpm)
    .map((item) => ({ ...item, track: { ...item.track, _retrievalTier: 1 } }));

  const pool = [...tier1];

  if (pool.length < minCandidates) {
    const tier2 = scored
      .filter((item) => (item.track.bpm >= minBpm - 10 && item.track.bpm < minBpm) || (item.track.bpm > maxBpm && item.track.bpm <= maxBpm + 10))
      .map((item) => ({ ...item, track: { ...item.track, _retrievalTier: 2 } }));
    pool.push(...tier2);
  }

  if (pool.length < minCandidates) {
    const tier3 = scored
      .filter((item) => item.track.bpm < minBpm - 10 || item.track.bpm > maxBpm + 10)
      .map((item) => ({ ...item, track: { ...item.track, _retrievalTier: 3 } }));
    pool.push(...tier3);
  }

  // Deterministic tie-breaker:
  // _retrievalTier ASC -> relevance DESC -> BPM distance ASC -> artist ASC -> title ASC -> id ASC
  pool.sort((a, b) => {
    const tierA = (a.track as any)._retrievalTier || 1;
    const tierB = (b.track as any)._retrievalTier || 1;
    if (tierA !== tierB) return tierA - tierB;
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    const targetBpm = profile.tempo?.target || 120;
    const distA = Math.abs(a.track.bpm - targetBpm);
    const distB = Math.abs(b.track.bpm - targetBpm);
    if (distA !== distB) return distA - distB;
    const artistCmp = a.track.artist.localeCompare(b.track.artist);
    if (artistCmp !== 0) return artistCmp;
    const titleCmp = a.track.title.localeCompare(b.track.title);
    if (titleCmp !== 0) return titleCmp;
    return a.track.id.localeCompare(b.track.id);
  });

  const capped = pool.slice(0, maxCandidates);
  return capped.map((item) => item.track);
}

// 2. Deterministic Ranking: Calculate explainable score (0..100) and breakdown
export function rankCandidates(
  profile: MusicProfile,
  candidates: Track[]
): RankedCandidate[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const totalGenreWeight = Math.max(
    1,
    (profile.genres || []).reduce((acc, g) => acc + Math.max(0, g.weight), 0)
  );

  const totalSubWeight = Math.max(
    1,
    (profile.subgenres || []).reduce((acc, g) => acc + Math.max(0, g.weight), 0)
  );

  const targetBpm = profile.tempo?.target || 120;
  const minBpm = Math.min(profile.tempo?.min || targetBpm - 15, targetBpm);
  const maxBpm = Math.max(profile.tempo?.max || targetBpm + 15, targetBpm);
  const profileEnergy = Math.max(1, Math.min(10, (profile.music_profile?.energy || 50) / 10));

  const desiredMoodTokens = new Set(
    (profile.desired_state?.mood || []).flatMap((m) => normalizeText(m).split(' ').filter(Boolean))
  );
  const currentMoodTokens = new Set(
    (profile.current_state?.mood || []).flatMap((m) => normalizeText(m).split(' ').filter(Boolean))
  );

  let targetBrightness: 'dark' | 'mellow' | 'warm' | 'balanced' | 'bright' | 'crystalline' = 'balanced';
  const mpDarkness = profile.music_profile?.darkness ?? 50;
  const mpWarmth = profile.music_profile?.warmth ?? 50;
  const mpMelodicness = profile.music_profile?.melodicness ?? 50;
  const mpEnergy = profile.music_profile?.energy ?? 50;
  const mpAtmospheric = profile.music_profile?.atmospheric ?? 50;
  const mpRhythmDensity = profile.music_profile?.rhythm_density ?? 50;

  if (mpDarkness > 65) targetBrightness = 'dark';
  else if (mpWarmth > 60) targetBrightness = 'warm';
  else if (mpMelodicness > 70 && mpEnergy < 40) targetBrightness = 'mellow';
  else if (mpEnergy > 75) targetBrightness = 'bright';

  const brightnessScale: Array<'dark' | 'mellow' | 'warm' | 'balanced' | 'bright' | 'crystalline'> = [
    'dark',
    'mellow',
    'warm',
    'balanced',
    'bright',
    'crystalline',
  ];
  const targetBrightnessIdx = brightnessScale.indexOf(targetBrightness);

  let targetDensity: 'sparse_minimal' | 'focused_monophonic' | 'rich_polyphonic' | 'dense_multilayered' = 'rich_polyphonic';
  if (mpAtmospheric > 70 && mpRhythmDensity < 40) {
    targetDensity = 'sparse_minimal';
  } else if (mpRhythmDensity > 75) {
    targetDensity = 'dense_multilayered';
  }

  const ranked: RankedCandidate[] = candidates.map((track) => {
    // 1. Genre Score (0..30)
    let genreSum = 0;
    const trackGenres = (track.genres || []).map(normalizeText);
    const trackTokens = new Set(trackGenres.flatMap((g) => g.split(' ').filter(Boolean)));

    for (const pg of profile.genres || []) {
      const normPg = normalizeText(pg.name);
      if (!normPg) continue;
      const weightFraction = Math.max(0, pg.weight) / totalGenreWeight;

      if (trackGenres.includes(normPg)) {
        genreSum += 30 * weightFraction;
      } else {
        const pgTokens = normPg.split(' ').filter(Boolean);
        if (pgTokens.some((t) => trackTokens.has(t))) {
          genreSum += 20 * weightFraction;
        }
      }
    }
    const genreScore = Math.min(30, Math.round(genreSum * 10) / 10);

    // 2. Subgenre Score (0..10)
    let subSum = 0;
    const trackTags = (track.vibeTags || []).map(normalizeText);
    const allTrackGenreTokens = new Set([...trackGenres, ...trackTags].flatMap((s) => s.split(' ').filter(Boolean)));

    for (const sg of profile.subgenres || []) {
      const normSg = normalizeText(sg.name);
      if (!normSg) continue;
      const weightFraction = Math.max(0, sg.weight) / totalSubWeight;

      if (trackGenres.includes(normSg) || trackTags.includes(normSg)) {
        subSum += 10 * weightFraction;
      } else {
        const sgTokens = normSg.split(' ').filter(Boolean);
        if (sgTokens.some((t) => allTrackGenreTokens.has(t))) {
          subSum += 6 * weightFraction;
        }
      }
    }
    const subgenreScore = Math.min(10, Math.round(subSum * 10) / 10);

    // 3. BPM Score (0..20)
    // Target BPM receives 20.0 pts. Range [minBpm, maxBpm] boundaries drop to 10.0 pts.
    // Beyond boundaries, decays smoothly towards 0.
    const lowerSpan = Math.max(1, targetBpm - minBpm);
    const upperSpan = Math.max(1, maxBpm - targetBpm);
    let bpmScore = 0;
    if (track.bpm >= minBpm && track.bpm <= maxBpm) {
      const ratio = track.bpm <= targetBpm
        ? (targetBpm - track.bpm) / lowerSpan
        : (track.bpm - targetBpm) / upperSpan;
      bpmScore = 20 - ratio * 10;
    } else {
      const distFromEdge = track.bpm < minBpm ? minBpm - track.bpm : track.bpm - maxBpm;
      bpmScore = Math.max(0, 10 - distFromEdge * 0.75);
    }
    bpmScore = Math.min(20, Math.round(bpmScore * 10) / 10);

    // 4. Energy Score (0..15)
    const energyDiff = Math.abs(track.energy - profileEnergy);
    const energyScore = Math.min(15, Math.round(Math.max(0, 15 - energyDiff * 2.5) * 10) / 10);

    // 5. Mood Score (0..10)
    const trackMoodTokens = new Set(
      [...(track.moods || []), ...(track.vibeTags || [])].flatMap((m) => normalizeText(m).split(' ').filter(Boolean))
    );
    let desiredMatches = 0;
    for (const token of desiredMoodTokens) {
      if (trackMoodTokens.has(token)) desiredMatches++;
    }
    let currentMatches = 0;
    for (const token of currentMoodTokens) {
      if (trackMoodTokens.has(token)) currentMatches++;
    }
    const moodScore = Math.min(10, Math.round((desiredMatches * 3.5 * 0.7 + currentMatches * 3.5 * 0.3) * 10) / 10);

    // 6. Timbre Score (0..10)
    let timbreScore = 5.0; // neutral baseline when track has no timbreProfile
    if (track.timbreProfile) {
      let brightnessPts = 0;
      const trackBrightnessIdx = brightnessScale.indexOf(track.timbreProfile.brightness);
      if (trackBrightnessIdx !== -1 && targetBrightnessIdx !== -1) {
        if (trackBrightnessIdx === targetBrightnessIdx) {
          brightnessPts = 6;
        } else if (Math.abs(trackBrightnessIdx - targetBrightnessIdx) === 1) {
          brightnessPts = 3;
        }
      }

      let densityPts = 2;
      if (track.timbreProfile.harmonic_density === targetDensity) {
        densityPts = 4;
      }
      timbreScore = Math.min(10, brightnessPts + densityPts);
    }

    // 7. Discovery (0: no objective popularity/play count exists in current metadata)
    const discoveryScore = 0;

    // 8. Avoid Penalty (0 or negative)
    const avoidPenalty = calculateAvoidPenalty(track, profile.avoid);

    const baseScore = genreScore + subgenreScore + bpmScore + energyScore + moodScore + timbreScore;
    const rawScore = baseScore + discoveryScore + avoidPenalty;
    const finalScore = Math.max(0, Math.min(100, Math.round(rawScore * 10) / 10));

    const breakdown: ScoreBreakdown = {
      genre: genreScore,
      subgenre: subgenreScore,
      bpm: bpmScore,
      energy: energyScore,
      mood: moodScore,
      timbre: timbreScore,
      discovery: discoveryScore,
      avoidPenalty,
    };

    return {
      track,
      score: finalScore,
      breakdown,
    };
  });

  // Deterministic sorting:
  // score DESC -> tier ASC -> genre DESC -> mood DESC -> bpm distance ASC -> artist ASC -> title ASC -> id ASC
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const tierA = (a.track as any)._retrievalTier || 1;
    const tierB = (b.track as any)._retrievalTier || 1;
    if (tierA !== tierB) return tierA - tierB;
    if (b.breakdown.genre !== a.breakdown.genre) return b.breakdown.genre - a.breakdown.genre;
    if (b.breakdown.mood !== a.breakdown.mood) return b.breakdown.mood - a.breakdown.mood;
    const distA = Math.abs(a.track.bpm - targetBpm);
    const distB = Math.abs(b.track.bpm - targetBpm);
    if (distA !== distB) return distA - distB;
    const artistCmp = a.track.artist.localeCompare(b.track.artist);
    if (artistCmp !== 0) return artistCmp;
    const titleCmp = a.track.title.localeCompare(b.track.title);
    if (titleCmp !== 0) return titleCmp;
    return a.track.id.localeCompare(b.track.id);
  });

  return ranked;
}

// 3. Selection & Artist Diversity: Select top tracks with controlled artist capping
export function selectTopCandidates(
  ranked: RankedCandidate[],
  limit = 10,
  maxPerArtist = 2
): Track[] {
  return selectTopCandidatesRanked(ranked, limit, maxPerArtist).map(c => c.track);
}

export function selectTopCandidatesRanked(
  ranked: RankedCandidate[],
  limit = 10,
  maxPerArtist = 2
): RankedCandidate[] {
  if (!Array.isArray(ranked) || ranked.length === 0) return [];
  const targetLimit = Math.min(limit, ranked.length);

  const selected: RankedCandidate[] = [];
  const selectedIds = new Set<string>();
  const artistCounts = new Map<string, number>();

  // Pass 1: standard maxPerArtist (default 2)
  for (const item of ranked) {
    if (selected.length >= targetLimit) break;
    const normArtist = normalizeText(item.track.artist);
    const count = artistCounts.get(normArtist) || 0;
    if (count < maxPerArtist && !selectedIds.has(item.track.id)) {
      selected.push(item);
      selectedIds.add(item.track.id);
      artistCounts.set(normArtist, count + 1);
    }
  }

  // Pass 2: controlled relaxation up to 3 per artist if needed to reach targetLimit
  if (selected.length < targetLimit) {
    for (const item of ranked) {
      if (selected.length >= targetLimit) break;
      const normArtist = normalizeText(item.track.artist);
      const count = artistCounts.get(normArtist) || 0;
      if (count < 3 && !selectedIds.has(item.track.id)) {
        selected.push(item);
        selectedIds.add(item.track.id);
        artistCounts.set(normArtist, count + 1);
      }
    }
  }

  return selected;
}

export function validateSemanticRerankResponse(
  parsed: any,
  candidates: RankedCandidate[],
  limit: number
): Track[] | null {
  if (!parsed || !parsed.selected_tracks || !Array.isArray(parsed.selected_tracks)) {
    return null;
  }

  const validTracks: Track[] = [];
  const seenIds = new Set<string>();
  const artistCounts = new Map<string, number>();

  for (const item of parsed.selected_tracks) {
    if (validTracks.length >= limit) break;

    const candidate = candidates.find(c => c.track.id === item.id);
    if (!candidate) continue; // discard invalid ID

    if (seenIds.has(item.id)) continue; // remove duplicate IDs

    const normArtist = normalizeText(candidate.track.artist);
    const count = artistCounts.get(normArtist) || 0;
    if (count >= 3) continue; // enforce max 3 per artist constraint

    validTracks.push({
      ...candidate.track,
      curatorReason: item.curator_reason,
      overallScore: candidate.score + ((item.semantic_score || 0) * 0.1)
    });
    seenIds.add(item.id);
    artistCounts.set(normArtist, count + 1);
  }

  // Fill remaining slots with Stage 2 fallback if Gemini didn't return enough valid tracks
  if (validTracks.length > 0) {
    if (validTracks.length < limit) {
      const fallbackCandidates = candidates.map(c => c.track);
      return dedupeTracksById(validTracks, fallbackCandidates, limit, 3);
    }
    return dedupeTracksById(validTracks, [], limit, 3);
  }

  return null;
}

// Stage 3B: Playlist Optimization

export function calculateTransitionScore(from: Track, to: Track, profile: MusicProfile): number {
  let score = 0;

  // BPM Continuity (0-25)
  const bpmDiff = Math.abs(from.bpm - to.bpm);
  score += Math.max(0, 25 - bpmDiff * 1.5);

  // Energy Continuity (0-25)
  const energyDiff = Math.abs(from.energy - to.energy);
  score += Math.max(0, 25 - energyDiff * 5);

  // Mood Compatibility (0-20)
  const fromMoods = from.moods || [];
  const toMoods = to.moods || [];
  const sharedMoods = fromMoods.filter(m => toMoods.includes(m)).length;
  const sharedVibes = from.vibeTags?.filter(v => to.vibeTags?.includes(v)).length || 0;
  score += Math.min(20, sharedMoods * 10 + sharedVibes * 5);

  // Genre/Subgenre Compatibility (0-15)
  const fromGenres = from.genres || [];
  const toGenres = to.genres || [];
  const sharedGenres = fromGenres.filter(g => toGenres.includes(g)).length;
  score += Math.min(15, sharedGenres * 10);

  // Timbre/Acoustic Compatibility (0-10)
  let timbreScore = 5; // Default fallback
  if (from.timbreProfile && to.timbreProfile) {
    timbreScore = 0;
    if (from.timbreProfile.brightness === to.timbreProfile.brightness) timbreScore += 5;
    if (from.acousticLandscape?.stereo_dimension === to.acousticLandscape?.stereo_dimension) timbreScore += 5;
  }
  score += timbreScore;

  // Artist Spacing (0-5)
  if (from.artist !== to.artist) {
    score += 5;
  }

  return Math.min(100, Math.max(0, score));
}

function getTargetEnergyCurve(profile: MusicProfile, length: number): number[] {
  const currentE = Math.round(profile.current_state.energy / 10) || 5;
  const desiredE = Math.round(profile.desired_state.energy / 10) || 5;
  const arc = (profile.strategy_emotional_arc || []).join(' ').toLowerCase();

  const curve = new Array(length).fill(5);

  if (arc.includes('build') || arc.includes('rise') || arc.includes('escalation')) {
    for (let i = 0; i < length; i++) {
      curve[i] = currentE + ((desiredE - currentE) * (i / Math.max(1, length - 1)));
    }
  } else if (arc.includes('peak') || arc.includes('release')) {
    const peakIdx = Math.floor(length * 0.7);
    const peakE = Math.max(currentE, desiredE, 8);
    for (let i = 0; i < length; i++) {
      if (i <= peakIdx) {
        curve[i] = currentE + ((peakE - currentE) * (i / Math.max(1, peakIdx)));
      } else {
        curve[i] = peakE - ((peakE - desiredE) * ((i - peakIdx) / Math.max(1, length - 1 - peakIdx)));
      }
    }
  } else if (arc.includes('steady') || arc.includes('hypnotic')) {
    const avgE = (currentE + desiredE) / 2;
    for (let i = 0; i < length; i++) {
      curve[i] = avgE;
    }
  } else {
    for (let i = 0; i < length; i++) {
      curve[i] = currentE + ((desiredE - currentE) * (i / Math.max(1, length - 1)));
    }
  }
  return curve;
}

export function optimizePlaylistOrder(tracks: Track[], profile: MusicProfile): Track[] {
  if (!tracks || tracks.length <= 2) return tracks;
  
  const N = tracks.length;
  const targetCurve = getTargetEnergyCurve(profile, N);

  const openingScore = (t: Track) => {
    let score = 0;
    const targetE = Math.round((profile.current_state?.energy || 50) / 10) || 5;
    score += Math.max(0, 50 - Math.abs((t.energy || 5) - targetE) * 10);
    const tMoods = t.moods || [];
    const curMoods = profile.current_state?.mood || [];
    const moodMatch = tMoods.filter(m => curMoods.includes(m)).length;
    score += Math.min(50, moodMatch * 25);
    return score;
  };

  const closingScore = (t: Track) => {
    let score = 0;
    const targetE = Math.round((profile.desired_state?.energy || 50) / 10) || 5;
    score += Math.max(0, 50 - Math.abs((t.energy || 5) - targetE) * 10);
    const tMoods = t.moods || [];
    const desMoods = profile.desired_state?.mood || [];
    const moodMatch = tMoods.filter(m => desMoods.includes(m)).length;
    score += Math.min(50, moodMatch * 25);
    return score;
  };

  const transitionMatrix: number[][] = Array(N).fill(0).map(() => Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (i !== j) {
        transitionMatrix[i][j] = calculateTransitionScore(tracks[i], tracks[j], profile);
      }
    }
  }

  const BEAM_WIDTH = 100;
  let beam = [];
  
  for (let i = 0; i < N; i++) {
    const oScore = openingScore(tracks[i]);
    const energyBonus = Math.max(0, 100 - Math.abs(tracks[i].energy - targetCurve[0]) * 10);
    beam.push({
      seq: [i],
      mask: 1 << i,
      score: oScore + energyBonus
    });
  }

  for (let step = 1; step < N; step++) {
    let nextBeam = [];
    
    for (const state of beam) {
      const lastIdx = state.seq[state.seq.length - 1];
      
      for (let nextIdx = 0; nextIdx < N; nextIdx++) {
        if ((state.mask & (1 << nextIdx)) === 0) {
          const tScore = transitionMatrix[lastIdx][nextIdx];
          const energyBonus = Math.max(0, 100 - Math.abs(tracks[nextIdx].energy - targetCurve[step]) * 10);
          
          let totalAdded = tScore + energyBonus;
          if (step === N - 1) {
             totalAdded += closingScore(tracks[nextIdx]);
          }

          nextBeam.push({
            seq: [...state.seq, nextIdx],
            mask: state.mask | (1 << nextIdx),
            score: state.score + totalAdded
          });
        }
      }
    }
    
    // Deterministic sort: score desc, then by id sequence to resolve ties
    nextBeam.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      for (let i = 0; i < a.seq.length; i++) {
        const idA = tracks[a.seq[i]].id;
        const idB = tracks[b.seq[i]].id;
        if (idA !== idB) return idA.localeCompare(idB);
      }
      return 0;
    });
    beam = nextBeam.slice(0, BEAM_WIDTH);
  }

  const bestSeq = beam[0].seq;
  return bestSeq.map(idx => tracks[idx]);
}

// 4. Semantic Reranking (Stage 3A)
export async function performSemanticReranking(
  profile: MusicProfile,
  candidates: RankedCandidate[],
  limit = 10
): Promise<Track[]> {
  if (candidates.length === 0) {
    return [];
  }

  const cacheKey = getRerankCacheKey(profile, candidates, limit);
  if (semanticRerankCache.has(cacheKey)) {
    return semanticRerankCache.get(cacheKey)!;
  }

  const ai = getGemini();
  // If no AI or circuit breaker is cooling down, immediately use Stage 2 deterministic ranking
  if (!ai || !GeminiCircuitBreaker.isAvailable()) {
    const fallback = selectTopCandidates(candidates, Math.min(limit, candidates.length));
    semanticRerankCache.set(cacheKey, fallback);
    return fallback;
  }

  const systemInstruction = `You are a Semantic Reranking engine for a music curation platform.
Your task is to select exactly ${limit} tracks from the provided candidate list that best match the MusicProfile context.

RULES:
1. DO NOT HALLUCINATE. You must ONLY select tracks from the provided JSON candidate list. Use the exact 'id' from the candidate list.
2. DO NOT INVENT new artists, titles, or tracks.
3. Return exactly ${limit} tracks if possible.
4. "semantic_score" (0-100) reflects how well the track matches the emotional arc, scene, mood, and timbre of the MusicProfile.
5. "curator_reason" must be 1 short sentence in Russian explaining why this track fits the vibe, citing its specific characteristics (e.g. genre, tempo, timbre). Do not use generic phrases. Be concrete.
6. The candidates have already been filtered for BPM and hard avoidances. Focus purely on semantic, aesthetic, and mood compatibility.
`;

  const candidatesJson = candidates.map(c => ({
    id: c.track.id,
    artist: c.track.artist,
    title: c.track.title,
    bpm: c.track.bpm,
    energy: c.track.energy,
    genres: c.track.genres,
    moods: c.track.moods,
    vibeTags: c.track.vibeTags,
    timbreProfile: c.track.timbreProfile,
    energyCurve: c.track.energyCurve,
    acousticLandscape: c.track.acousticLandscape
  }));

  // Trim down to most relevant profile fields to save tokens
  const profileTrimmed = {
    current_state: profile.current_state,
    desired_state: profile.desired_state,
    visual_context: profile.visual_context,
    music_profile: profile.music_profile,
    tempo: profile.tempo,
    genres: profile.genres,
    subgenres: profile.subgenres,
    artist_styles: profile.artist_styles,
    avoid: profile.avoid,
    discovery: profile.discovery,
    strategy_concept: profile.strategy_concept,
    strategy_emotional_arc: profile.strategy_emotional_arc,
    vibe_verdict: profile.vibe_verdict
  };

  const parts = [
    { text: `MusicProfile:
${JSON.stringify(profileTrimmed, null, 2)}

Candidates:
${JSON.stringify(candidatesJson, null, 2)}` }
  ];

  const fullSchema = {
    type: Type.OBJECT,
    properties: {
      selected_tracks: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            semantic_score: { type: Type.INTEGER },
            curator_reason: { type: Type.STRING },
          },
          required: ['id', 'semantic_score', 'curator_reason'],
        },
      },
    },
    required: ['selected_tracks'],
  };

  const candidateModels = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
  let lastFailureStatus = '';

  for (const model of candidateModels) {
    if (!GeminiCircuitBreaker.isAvailable()) break;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5 sec timeout

    try {
      const response = await ai.models.generateContent({
        model,
        contents: { parts },
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: fullSchema as any,
          abortSignal: controller.signal,
        },
      });

      const rawText = response.text?.trim();
      if (rawText) {
        const parsed = JSON.parse(rawText);
        const validTracks = validateSemanticRerankResponse(parsed, candidates, limit);
        if (validTracks && validTracks.length > 0) {
          GeminiCircuitBreaker.recordSuccess();
          semanticRerankCache.set(cacheKey, validTracks);
          return validTracks;
        }
      }
    } catch (err: any) {
      const status = parseGeminiNoticeStatus(err);
      lastFailureStatus = status;
      console.info(`[Speed of Sound] Semantic Rerank ${model} unavailable (${status}). Using Stage 2 ranking.`);
      if (status.includes('503') || status.includes('429')) {
        GeminiCircuitBreaker.recordFailure(status);
        break;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  GeminiCircuitBreaker.recordFailure(lastFailureStatus);
  // Fallback entirely to Stage 2 ranking
  const fallback = selectTopCandidates(candidates, limit);
  semanticRerankCache.set(cacheKey, fallback);
  return fallback;
}

// Backward-compatible facade wrapping the Stage 2 pipeline
function matchTracksToVibe(vibe: VibeAnalysis, targetCount: number = 10): Track[] {
  const synthesizedProfile = synthesizeProfileFromVibe(vibe);
  const candidates = retrieveCandidates(synthesizedProfile, SPEED_SOUND_TRACKS);
  const ranked = rankCandidates(synthesizedProfile, candidates);
  return selectTopCandidates(ranked, targetCount);
}

// Fallback heuristic vibe analyzer if Gemini key is not provided or rate limited
function generateHeuristicVibe(moodText?: string): VibeAnalysis {
  const text = (moodText || '').toLowerCase();
  
  if (text.includes('зал') || text.includes('желез') || text.includes('тяж') || text.includes('дрифт') || text.includes('агресс')) {
    return {
      mood_tags: ['#GymPhonk', '#PurePower', '#Heavy808', '#Adrenaline', '#RageMode', '#IndustrialPressure'],
      genres: ['Drift Phonk', 'Dark Trap', 'Electronic', 'Industrial'],
      target_bpm: 155,
      energy_level: 9,
      vibe_verdict: 'Твое настроение звучит как запредельный адреналин и раскаленный гриф штанги. Подобрали тяжелый фонк, резкий ковбелл и сокрушительный 808-й бас.',
      dominant_colors: ['глубокий кармин', 'стальной графит', 'обсидиановый черный'],
      location_setting: 'тренажерный зал, зона свободных весов',
      time_of_day: 'вечерний силовой пик',
      visual_atmosphere: 'Контрастный верхний свет, холодные тени от спортивных снарядов, металлическая текстура стали и магнезии.',
      emotional_depth: 'Максимальная концентрация воли, агрессивный выплеск внутренней энергии и преодоление физического предела.',
      acoustic_profile: {
        sub_bass: 'Разрывающий 808-й саб-бас 35-48 Гц с тяжелой аналоговой сатурацией и компрессией',
        percussion: 'Плотный дисторшн-снейр, перегруженный ковбелл и скоростные 32-е хэты',
        space: 'Сухая, плотная моно-компрессия без лишней реверберации для максимального панча',
      },
      cinematic_scene: 'Тяжелый подход под пульсирующие басы в полутемном брутальном зале.',
      timbre_profile: {
        texture: 'Перегруженный дисторшн-808, металлический лязг ковбелла и раскаленный цифровой клиппинг',
        brightness: 'bright',
        grain_and_saturation: 'Агрессивный аналоговый фузз, жесткий лимитер и перегруз предусилителя',
        harmonic_density: 'dense_multilayered',
        spectral_weight: 'Тяжелый инфра-низ 32-50 Гц в связке с режущими верхними металлическими гармониками',
      },
      energy_curve: {
        curve_type: 'explosive_burst',
        tempo_feel: 'Бескомпромиссный штурмовой напор 155 BPM без провисаний',
        dynamic_tension: 'Предельное мышечное напряжение с выплеском в припевах',
        peak_profile: 'continuous_pulse',
      },
      acoustic_landscape: {
        space_type: 'Брутальный индустриальный ангар с бетонными стенами и сухим эхом',
        reverb_decay_time: '1.2s tight concrete punch',
        stereo_dimension: 'wide_panoramic_stereo',
        environmental_cues: ['лязг блинов штанги', 'глухой стук магнезии о помост', 'тяжелое дыхание'],
      },
      synesthetic_transduction: 'Резкие металлические блики и глубокие контрастные тени кадра преобразуются в агрессивные гармоники перегруженного 808-баса.',
    };
  }

  if (text.includes('дожд') || text.includes('такси') || text.includes('тоск') || text.includes('сигарет') || text.includes('ночь')) {
    return {
      mood_tags: ['#NightTaxi', '#RainCity', '#Melancholy', '#BurialVibe', '#SubBass', '#BrokenRhythm'],
      genres: ['UK Garage', 'Future Garage', 'Darkwave', 'Ambient Dub'],
      target_bpm: 134,
      energy_level: 6,
      vibe_verdict: 'Твой кадр звучит как ночной дождливый мегаполис из окна такси. Мы подобрали сырой UK Garage, ломаный синкопированный ритм и призрачные соул-сэмплы.',
      dominant_colors: ['мокрый асфальт', 'неоновый сапфир', 'холодный индиго'],
      location_setting: 'ночной дождливый город, заднее сиденье такси',
      time_of_day: '02:45 глубокой ночи',
      visual_atmosphere: 'Размытые полосы неоновых фонарей сквозь струи дождя на лобовом стекле, глубокие синие тени и мокрый зеркальный асфальт.',
      emotional_depth: 'Глубокая ночная интроспекция, легкая кинематографичная меланхолия и чувство тихого одиночества среди огромного мегаполиса.',
      acoustic_profile: {
        sub_bass: 'Теплый, обволакивающий аналоговый суб-бас 40-55 Гц в стиле Burial',
        percussion: 'Сырой шаффл-брейкбит с характерным виниловым шорохом и мягким римшотом на вторую долю',
        space: 'Широкая стереопанорама с темным плейт-ревербератором и глубоким стерео-дилеем',
      },
      cinematic_scene: 'Одинокая поездка сквозь спящий город под приглушенные огни витрин.',
      timbre_profile: {
        texture: 'Шуршащий виниловый кракелюр, затуманенный Rhodes и призрачные питченные вокальные форманты',
        brightness: 'mellow',
        grain_and_saturation: 'Теплая пленочная компрессия с легким flutter и винтажным треском иглы',
        harmonic_density: 'rich_polyphonic',
        spectral_weight: 'Глубокий суб-бас 38-52 Гц, мягкий спад на верхах и бархатная нижняя середина',
      },
      energy_curve: {
        curve_type: 'nocturnal_drift',
        tempo_feel: 'Ломаный синкопированный свинг 134 BPM с эффектом невесомости',
        dynamic_tension: 'Кинематографичная меланхолия и неспешное погружение в глубину ночи',
        peak_profile: 'subdued_valley',
      },
      acoustic_landscape: {
        space_type: 'Замкнутый салон авто с дождевой панорамой и мокрым отражением витрин',
        reverb_decay_time: '4.2s diffuse wet plate',
        stereo_dimension: 'binaural_3d_surround',
        environmental_cues: ['струи дождя по лобовому стеклу', 'шелест шин по мокрому асфальту', 'далекий неоновый гул'],
      },
      synesthetic_transduction: 'Капли дождя на стекле переводятся в синкопированный щелкающий ритм брейкбита, а огни фар — в обволакивающий темный суб-бас.',
    };
  }

  if (text.includes('неон') || text.includes('бар') || text.includes('друг') || text.includes('клуб') || text.includes('рейв')) {
    return {
      mood_tags: ['#NeonBar', '#Cyberpunk', '#LateNight', '#EmotionalClub', '#130BPM', '#UltraViolet'],
      genres: ['Electronic', 'House', 'UK Garage', 'Deconstructed Club'],
      target_bpm: 130,
      energy_level: 8,
      vibe_verdict: 'Атмосфера залитого неоном ночного бара и гипнотического клубного грува. В подборке плотный пульсирующий бас и текстурный future garage.',
      dominant_colors: ['электрический ультрафиолет', 'неоновый циан', 'глубокий кобальт'],
      location_setting: 'неоновый андеграундный бар, полумрак',
      time_of_day: '03:15 ночи',
      visual_atmosphere: 'Плотный неоновый свет ультрафиолетовых ламп, запотевшие бокалы с бликами льда, мягкий клубящийся дым и зеркальные рефлексы.',
      emotional_depth: 'Гипнотическое единение с ритмом, эйфорический подъем и растворение во временном потоке ночи.',
      acoustic_profile: {
        sub_bass: 'Пульсирующий 4-на-4 бас с фильтрованной автоматизацией cut-off',
        percussion: 'Четкий кликающий хэт, плотный клубный бочонок и микросэмплы голосовых чопов',
        space: 'Камерный клубный объем с компрессированным room-ревербератором',
      },
      cinematic_scene: 'Вспышки лазеров и гул басов в скрытом от посторонних глаз подвальном баре.',
      timbre_profile: {
        texture: 'Аналоговые пэды Prophet-6, пульсирующий Moog-бас и сверкающие перкуссионные глитчи',
        brightness: 'warm',
        grain_and_saturation: 'Ламповый преамп с приятным округлым насыщением второй гармоники',
        harmonic_density: 'rich_polyphonic',
        spectral_weight: 'Плотный клубный кик 55-90 Гц с упругой поддержкой средней полосы',
      },
      energy_curve: {
        curve_type: 'slow_crescendo_to_drop',
        tempo_feel: 'Упругий клубный 4/4 грув 130 BPM, вовлекающий тело в непрерывное движение',
        dynamic_tension: 'Постепенное раскрытие low-pass фильтра вплоть до эйфорического дропа',
        peak_profile: 'mid_drop',
      },
      acoustic_landscape: {
        space_type: 'Андеграундный кирпичный свод с клубной акустической обработкой',
        reverb_decay_time: '2.4s club chamber',
        stereo_dimension: 'wide_panoramic_stereo',
        environmental_cues: ['приглушенный звон бокалов', 'вибрация деревянного танцпола', 'гул голосов у бара'],
      },
      synesthetic_transduction: 'Ультрафиолетовый свет и переливы неоновых отражений транслируются в модуляцию резонансного фильтра синтезатора.',
    };
  }

  if (text.includes('солн') || text.includes('парк') || text.includes('тепл') || text.includes('утр')) {
    return {
      mood_tags: ['#GoldenHour', '#Chillwave', '#Warmth', '#Downtempo', '#AnalogPads', '#SunGlitch'],
      genres: ['Chillwave', 'Ambient', 'Downtempo', 'Organic House'],
      target_bpm: 105,
      energy_level: 4,
      vibe_verdict: 'Теплые солнечные блики и медленный глубокий вдох. Подобрали аналоговый чиллвейв, парящие синтезаторные пэды и органический даунтемпо.',
      dominant_colors: ['янтарное золото', 'пастельный лазурный', 'мягкий песочный'],
      location_setting: 'солнечный парк, набережная у воды',
      time_of_day: 'закатный golden hour',
      visual_atmosphere: 'Мягкий контровой свет заходящего солнца, золотистая пыльца в воздухе, игра длинных теплых теней на траве.',
      emotional_depth: 'Абсолютное умиротворение, замедление внутреннего диалога и ощущение гармонии с моментом.',
      acoustic_profile: {
        sub_bass: 'Мягкий синусоидальный саб-бас без агрессии, дающий теплоту в нижнем регистре',
        percussion: 'Шуршащий органический шейкер, приглушенный бас-барабан и теплые тарелки',
        space: 'Воздушный, бесконечный шиммер-ревербератор с эффектом парения в воздухе',
      },
      cinematic_scene: 'Замедленный кадр золотого заката над гладью реки.',
      timbre_profile: {
        texture: 'Шелковистые аналоговые пэды, мерцающие гитарные флажолеты и органические колокольчики',
        brightness: 'crystalline',
        grain_and_saturation: 'Чистый прозрачный тракт с легким ленточным теплом и сияющим воздухом',
        harmonic_density: 'rich_polyphonic',
        spectral_weight: 'Мягкий естественный бас и открытый сияющий высокочастотный спектр выше 10 кГц',
      },
      energy_curve: {
        curve_type: 'undulating_waves',
        tempo_feel: 'Неторопливый размеренный даунтемпо 105 BPM с глубоким естественным дыханием',
        dynamic_tension: 'Плавные волнообразные приливы без резких контрастов',
        peak_profile: 'extended_crescendo',
      },
      acoustic_landscape: {
        space_type: 'Открытое природное пространство с широкой панорамой горизонта',
        reverb_decay_time: '5.5s infinite shimmer reverb',
        stereo_dimension: 'wide_panoramic_stereo',
        environmental_cues: ['теплый шелест листвы', 'далекое щебетание птиц', 'тихий плеск воды у берега'],
      },
      synesthetic_transduction: 'Золотистый контровой свет заката преобразуется в воздушный шиммер-ревербератор и парящие обертоны аналоговых пэдов.',
    };
  }

  if (text.includes('осен') || text.includes('трасс') || text.includes('туман') || text.includes('дорог') || text.includes('думер')) {
    return {
      mood_tags: ['#Highway', '#Fog', '#DoomerWave', '#ColdWind', '#Atmospheric', '#128BPM'],
      genres: ['Darkwave', 'Post-Punk', 'Atmospheric', 'Breakbeat'],
      target_bpm: 128,
      energy_level: 6,
      vibe_verdict: 'Пустая осенняя трасса, скрывающаяся в тумане, и холодный встречный воздух. Подобрали меланхоличный пост-панк, холодный реверб и кинематографичный ломаный ритм.',
      dominant_colors: ['туманный пепел', 'холодный базальт', 'приглушенный охранный янтарь'],
      location_setting: 'пустая загородная трасса в сосновом тумане',
      time_of_day: 'сумеречный час',
      visual_atmosphere: 'Молочно-белый туман, стелющийся над мокрым шоссе, свет фар, исчезающий вдали, и золотисто-ржавые кроны деревьев.',
      emotional_depth: 'Экзистенциальная свобода дороги, кинематографичная светлая печаль и отрешенность от суеты городов.',
      acoustic_profile: {
        sub_bass: 'Аналоговый пульсирующий бас 42-56 Гц с легким эффектом хоруса',
        percussion: 'Холодная драм-машина 80-х с объемным гейтированным рабочим барабаном',
        space: 'Бескрайний стереоревербератор с эффектом туманного рассеивания',
      },
      cinematic_scene: 'Машина мчит в бесконечную туманную даль навстречу холодному северному закату.',
      timbre_profile: {
        texture: 'Холодный скрежещущий бас с эффектом хоруса, драм-машина LinnDrum и гитарный реверб',
        brightness: 'dark',
        grain_and_saturation: 'Лоуфайная кассетная компрессия с легким аналоговым тремоло',
        harmonic_density: 'focused_monophonic',
        spectral_weight: 'Плотный пронзительный мид-бас и глуховатый винтажный кик',
      },
      energy_curve: {
        curve_type: 'hypnotic_linear',
        tempo_feel: 'Неумолимый гипнотический локомотив 128 BPM, разрезающий туман',
        dynamic_tension: 'Кинематографичный саспенс бесконечной ночной дороги',
        peak_profile: 'continuous_pulse',
      },
      acoustic_landscape: {
        space_type: 'Бескрайнее туманное шоссе посреди холодного соснового массива',
        reverb_decay_time: '3.6s cold hall',
        stereo_dimension: 'wide_panoramic_stereo',
        environmental_cues: ['шум набегающего холодного ветра', 'гул мотора на высоких оборотах', 'вибрация подвески'],
      },
      synesthetic_transduction: 'Молочный туман и удаляющиеся огни фар превращаются в холодный пост-панковый дилей и пульсирующий моно-бас.',
    };
  }

  if (text.includes('монитор') || text.includes('комнат') || text.includes('код') || text.includes('лоуфай') || text.includes('уют') || text.includes('ночн')) {
    return {
      mood_tags: ['#LoFiRoom', '#Cozy', '#LateCoding', '#AnalogPads', '#SynthStudio', '#TapeHiss'],
      genres: ['Lo-Fi Electronic', 'IDM', 'Downtempo', 'Ambient'],
      target_bpm: 92,
      energy_level: 4,
      vibe_verdict: 'Полумрак ночной комнаты, мягкое свечение экрана и медитативный поток мыслей. Подобрали аналоговый IDM, теплый виниловый шум и обволакивающие синтезаторные текстуры.',
      dominant_colors: ['мягкий индиго', 'неоновый янтарь', 'глубокий обсидиан'],
      location_setting: 'уютная спальня, домашняя студия за рабочим столом',
      time_of_day: 'глубокая ночь (03:30)',
      visual_atmosphere: 'Приглушенный локальный свет монитора и теплой лампы, тени на стенах, мерцание индикаторов аудиокарты.',
      emotional_depth: 'Глубокая концентрация, состояние потока, умиротворенное ночное уединение.',
      acoustic_profile: {
        sub_bass: 'Теплый винтажный Moog-бас с мягким срезом высоких частот',
        percussion: 'Неторопливый бит с виниловым шорохом и естественным свинг-грувом',
        space: 'Камерное аналоговое пространство с мягким ленточным дилеем',
      },
      cinematic_scene: 'Человек в наушниках погружен в творчество в освещенной одним монитором комнате.',
      timbre_profile: {
        texture: 'Винтажный аналоговый Rhodes, мягкий скрип стула, щелчки ножниц и теплый суб-бас',
        brightness: 'warm',
        grain_and_saturation: 'Ленточный шум магнитофона Tascam с легким плаванием скорости (wow/flutter)',
        harmonic_density: 'rich_polyphonic',
        spectral_weight: 'Уютно согретая нижняя середина и мягкий срез резких высоких частот',
      },
      energy_curve: {
        curve_type: 'nocturnal_drift',
        tempo_feel: 'Ленивый лоуфай свинг 92 BPM с легким отставанием рабочего барабана',
        dynamic_tension: 'Медитативная ностальгия и творческий покой безмятежного уединения',
        peak_profile: 'subdued_valley',
      },
      acoustic_landscape: {
        space_type: 'Уютная полутемная комната с деревянной мебелью и коврами',
        reverb_decay_time: '0.8s intimate cozy room',
        stereo_dimension: 'tight_mono_intimate',
        environmental_cues: ['щелканье механической клавиатуры', 'тихий шелест кулера ноутбука', 'ночной покой за окном'],
      },
      synesthetic_transduction: 'Мягкий локальный свет экрана на фоне полумрака комнаты транслируется в теплые полифонические аккорды электропиано.',
    };
  }

  return {
    mood_tags: ['#SpeedOfSound', '#NightDrive', '#DeepElectronic', '#Breakbeat', '#Atmospheric', '#FutureGarage'],
    genres: ['UK Garage', 'Breakbeat', 'Deep Electronic', 'Minimal Techno'],
    target_bpm: 132,
    energy_level: 7,
    vibe_verdict: 'Твой момент звучит как холодный ночной Берлин. Мы подобрали кинематографичный электронный грув, ломаную бочку и плотный бас от кураторов @speed_sound.',
    dominant_colors: ['глубокий индиго', 'электрический циан', 'обсидиановый графит'],
    location_setting: 'ночные проспекты мегаполиса',
    time_of_day: 'глубокая ночь',
    visual_atmosphere: 'Ритмичные огни фонарей, отражающиеся на капоте автомобиля, холодная световая палитра 4500K с чистыми контрастами.',
    emotional_depth: 'Внутренняя сосредоточенность, эстетика ночной скорости и предвкушение неизведанного.',
    acoustic_profile: {
      sub_bass: 'Глубокий модулированный Reese-бас с богатым гармоническим спектром',
      percussion: 'Синкопированный брейкбит с текстурным шумом и акцентированным снейром',
      space: 'Глубокий стереохолл с панорамированными дилей-хвостами',
    },
    cinematic_scene: 'Стремительное движение по ночному шоссе в свете неоновых указателей.',
    timbre_profile: {
      texture: 'Модулированный Reese-бас, синкопированный брейкбит и текстурный аналоговый шум',
      brightness: 'mellow',
      grain_and_saturation: 'Ламповый сатуратор с легким гармоническим подгрузом',
      harmonic_density: 'rich_polyphonic',
      spectral_weight: 'Тяжелый суб-бас 38-52 Гц и прозрачный воздушный верхний спектр',
    },
    energy_curve: {
      curve_type: 'slow_crescendo_to_drop',
      tempo_feel: 'Качающий ночной грув 132 BPM с упругой синкопой',
      dynamic_tension: 'Кинематографичный ночной драйв и нарастающее предвкушение',
      peak_profile: 'mid_drop',
    },
    acoustic_landscape: {
      space_type: 'Ночной европейский город с эхом от стеклянных фасадов',
      reverb_decay_time: '3.0s modern plate',
      stereo_dimension: 'wide_panoramic_stereo',
      environmental_cues: ['эхо ночного мегаполиса', 'шум ветра на скорости', 'шелест колес'],
    },
    synesthetic_transduction: 'Огни ночного города считываются как вспышки стерео-перкуссии над плотной басовой линией.',
  };
}

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Speed of Sound Vibe Radar API',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    hasLastFmKey: Boolean(process.env.LASTFM_API_KEY),
    hasBotToken: Boolean(process.env.TELEGRAM_BOT_TOKEN),
  });
});

// 2. Catalog endpoint: Return catalog tracks, avoid hammering SoundCloud for all 50 tracks
app.get('/api/tracks', async (req, res) => {
  try {
    const shouldEnrich = req.query.enrich === 'true';
    const tracksToReturn = shouldEnrich
      ? await enrichTracksWithRealAudio(SPEED_SOUND_TRACKS)
      : SPEED_SOUND_TRACKS;

    res.json({
      channel: '@speed_sound',
      count: tracksToReturn.length,
      tracks: tracksToReturn,
    });
  } catch (err) {
    res.json({
      channel: '@speed_sound',
      count: SPEED_SOUND_TRACKS.length,
      tracks: SPEED_SOUND_TRACKS,
    });
  }
});

// 2.1 Dynamic track audio resolver
app.get('/api/track/resolve-audio', async (req, res) => {
  const artist = String(req.query.artist || '');
  const title = String(req.query.title || '');
  if (!artist || !title) {
    return res.status(400).json({ error: 'artist and title query parameters are required' });
  }
  const real = await resolveRealAudio(artist, title);
  res.json(real);
});

// 3. Subscription verification endpoint
app.post('/api/check-subscription', async (req, res) => {
  const { userId, isSimulated } = req.body || {};
  
  if (isSimulated) {
    return res.json({ subscribed: true, simulated: true });
  }

  if (userId) {
    const isSubscribed = await verifyTelegramChannelSubscription(userId);
    return res.json({ subscribed: isSubscribed });
  }

  res.json({ subscribed: false });
});

// 4. Recommendation Engine Step 1: Helpers, Validator and Adapter
function clamp0to100(val: any, defaultVal = 50): number {
  const num = Number(val);
  if (isNaN(num) || !isFinite(num)) return defaultVal;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function normalizeGenreWeights(genres: any[]): GenreScore[] {
  if (!Array.isArray(genres) || genres.length === 0) {
    return [{ name: 'Electronic', weight: 100 }];
  }
  const cleaned: Array<{ name: string; rawWeight: number }> = [];
  for (const g of genres) {
    if (!g) continue;
    const name = typeof g === 'string' ? g.trim() : (typeof g.name === 'string' ? g.name.trim() : '');
    if (!name) continue;
    const rawWeight = typeof g === 'object' && g.weight !== undefined ? clamp0to100(g.weight, 50) : 50;
    cleaned.push({ name, rawWeight });
  }
  if (cleaned.length === 0) {
    return [{ name: 'Electronic', weight: 100 }];
  }
  const total = cleaned.reduce((sum, item) => sum + item.rawWeight, 0);
  let results: GenreScore[];
  if (total <= 0) {
    const baseShare = Math.floor(100 / cleaned.length);
    results = cleaned.map((item) => ({ name: item.name, weight: baseShare }));
  } else {
    results = cleaned.map((item) => ({
      name: item.name,
      weight: Math.round((item.rawWeight / total) * 100),
    }));
  }

  // Guarantee that the sum of weights strictly equals 100
  const currentSum = results.reduce((sum, r) => sum + r.weight, 0);
  const diff = 100 - currentSum;
  if (diff !== 0 && results.length > 0) {
    let maxIdx = 0;
    for (let i = 1; i < results.length; i++) {
      if (results[i].weight > results[maxIdx].weight) {
        maxIdx = i;
      }
    }
    results[maxIdx].weight = Math.max(0, results[maxIdx].weight + diff);
  }

  return results;
}

function validateMusicProfile(raw: any): MusicProfile {
  const p = typeof raw === 'object' && raw !== null ? raw : {};

  // Current State
  const cs = p.current_state || {};
  const current_state = {
    mood: Array.isArray(cs.mood) ? cs.mood.filter((m: any) => typeof m === 'string' && m.trim()).map((m: string) => m.trim()) : ['neutral'],
    energy: clamp0to100(cs.energy, 50),
    emotional_intensity: clamp0to100(cs.emotional_intensity, 50),
  };
  if (current_state.mood.length === 0) current_state.mood = ['neutral'];

  // Desired State
  const ds = p.desired_state || {};
  const desired_state = {
    mood: Array.isArray(ds.mood) ? ds.mood.filter((m: any) => typeof m === 'string' && m.trim()).map((m: string) => m.trim()) : ['uplifted'],
    energy: clamp0to100(ds.energy, 60),
    emotional_intensity: clamp0to100(ds.emotional_intensity, 60),
  };
  if (desired_state.mood.length === 0) desired_state.mood = ['uplifted'];

  // Visual Context
  const vc = p.visual_context || {};
  const visual_context = {
    scene: Array.isArray(vc.scene) ? vc.scene.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim()) : ['Urban Scene'],
    time_of_day: typeof vc.time_of_day === 'string' && vc.time_of_day.trim() ? vc.time_of_day.trim() : 'Night',
    atmosphere: Array.isArray(vc.atmosphere) ? vc.atmosphere.filter((a: any) => typeof a === 'string' && a.trim()).map((a: string) => a.trim()) : ['Atmospheric'],
    dominant_colors: Array.isArray(vc.dominant_colors) ? vc.dominant_colors.filter((c: any) => typeof c === 'string' && c.trim()).map((c: string) => c.trim()) : [],
    cinematic: clamp0to100(vc.cinematic, 70),
    darkness: clamp0to100(vc.darkness, 50),
    warmth: clamp0to100(vc.warmth, 50),
    visual_energy: clamp0to100(vc.visual_energy, 50),
  };
  if (visual_context.scene.length === 0) visual_context.scene = ['Urban Scene'];
  if (visual_context.atmosphere.length === 0) visual_context.atmosphere = ['Atmospheric'];

  // Music Profile Features (0-100)
  const mp = p.music_profile || {};
  const music_profile = {
    energy: clamp0to100(mp.energy, desired_state.energy),
    danceability: clamp0to100(mp.danceability, 60),
    darkness: clamp0to100(mp.darkness, visual_context.darkness),
    warmth: clamp0to100(mp.warmth, visual_context.warmth),
    melodicness: clamp0to100(mp.melodicness, 60),
    atmospheric: clamp0to100(mp.atmospheric, 70),
    aggression: clamp0to100(mp.aggression, 30),
    experimental: clamp0to100(mp.experimental, 40),
    rhythm_density: clamp0to100(mp.rhythm_density, 60),
  };

  // Tempo Validation (min <= target <= max)
  const tp = p.tempo || {};
  let rawMin = Number(tp.min);
  let rawTarget = Number(tp.target);
  let rawMax = Number(tp.max);

  if (isNaN(rawTarget) || !isFinite(rawTarget) || rawTarget < 50 || rawTarget > 220) {
    rawTarget = Math.round(85 + (music_profile.energy / 100) * 60);
  }
  if (isNaN(rawMin) || !isFinite(rawMin) || rawMin < 40) {
    rawMin = Math.max(50, rawTarget - 15);
  }
  if (isNaN(rawMax) || !isFinite(rawMax) || rawMax > 240) {
    rawMax = Math.min(220, rawTarget + 15);
  }

  if (rawMin > rawTarget) {
    rawMin = Math.max(50, rawTarget - 10);
  }
  if (rawTarget > rawMax) {
    rawMax = Math.min(220, rawTarget + 10);
  }
  if (rawMin > rawMax) {
    rawMin = Math.max(50, rawMax - 20);
  }

  const tempo = {
    min: Math.round(rawMin),
    max: Math.round(rawMax),
    target: Math.round(rawTarget),
  };

  // Genres & Subgenres
  const genres = normalizeGenreWeights(p.genres);
  const subgenres = normalizeGenreWeights(p.subgenres);

  // Artist Styles & Avoid
  const artist_styles = Array.isArray(p.artist_styles)
    ? p.artist_styles.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim())
    : [];
  const avoid = Array.isArray(p.avoid)
    ? p.avoid.filter((a: any) => typeof a === 'string' && a.trim()).map((a: string) => a.trim())
    : [];

  // Discovery (0-100)
  const discovery = clamp0to100(p.discovery, 50);

  // Concepts & Strategy
  const strategy_concept = typeof p.strategy_concept === 'string' && p.strategy_concept.trim()
    ? p.strategy_concept.trim()
    : 'Эмоциональный переход к желаемому звуковому пространству.';

  const strategy_emotional_arc = Array.isArray(p.strategy_emotional_arc) && p.strategy_emotional_arc.length > 0
    ? p.strategy_emotional_arc.filter((a: any) => typeof a === 'string' && a.trim()).map((a: string) => a.trim())
    : ['Погружение', 'Развитие', 'Кульминация', 'Послесвечение'];

  const vibe_verdict = typeof p.vibe_verdict === 'string' && p.vibe_verdict.trim()
    ? p.vibe_verdict.trim()
    : strategy_concept;

  return {
    current_state,
    desired_state,
    visual_context,
    music_profile,
    tempo,
    genres,
    subgenres,
    artist_styles,
    avoid,
    discovery,
    strategy_concept,
    strategy_emotional_arc,
    vibe_verdict,
  };
}

function adaptMusicProfileToVibeAnalysis(profile: MusicProfile): VibeAnalysis {
  const rawMoods = [
    ...profile.desired_state.mood,
    ...profile.visual_context.atmosphere,
    ...profile.current_state.mood,
  ];
  const uniqueMoods = Array.from(new Set(rawMoods.map((m) => m.trim()))).filter(Boolean);
  const mood_tags = (uniqueMoods.length > 0 ? uniqueMoods : ['Vibe', 'Atmosphere', 'Flow'])
    .slice(0, 5)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag.replace(/\s+/g, '')}`));

  const sortedGenres = [...profile.genres]
    .sort((a, b) => b.weight - a.weight)
    .map((g) => g.name);
  const finalGenres = sortedGenres.length > 0 ? sortedGenres.slice(0, 4) : ['Electronic', 'Ambient'];

  const energy_level = Math.max(1, Math.min(10, Math.round(profile.music_profile.energy / 10)));

  let brightness: 'dark' | 'mellow' | 'warm' | 'balanced' | 'bright' | 'crystalline' = 'balanced';
  if (profile.music_profile.darkness > 65) {
    brightness = 'dark';
  } else if (profile.music_profile.warmth > 60) {
    brightness = 'warm';
  } else if (profile.music_profile.melodicness > 70 && profile.music_profile.energy < 40) {
    brightness = 'mellow';
  } else if (profile.music_profile.energy > 75) {
    brightness = 'bright';
  }

  let harmonic_density: 'sparse_minimal' | 'focused_monophonic' | 'rich_polyphonic' | 'dense_multilayered' = 'rich_polyphonic';
  if (profile.music_profile.atmospheric > 70 && profile.music_profile.rhythm_density < 40) {
    harmonic_density = 'sparse_minimal';
  } else if (profile.music_profile.rhythm_density > 75) {
    harmonic_density = 'dense_multilayered';
  }

  let curve_type: 'hypnotic_linear' | 'slow_crescendo_to_drop' | 'undulating_waves' | 'explosive_burst' | 'nocturnal_drift' | 'staccato_stomp' = 'undulating_waves';
  if (profile.music_profile.energy > 80 && profile.music_profile.aggression > 60) {
    curve_type = 'explosive_burst';
  } else if (profile.music_profile.darkness > 60 && profile.music_profile.energy < 50) {
    curve_type = 'nocturnal_drift';
  } else if (profile.music_profile.danceability > 70) {
    curve_type = 'slow_crescendo_to_drop';
  } else if (profile.music_profile.atmospheric > 70) {
    curve_type = 'hypnotic_linear';
  }

  let peak_profile: 'intro_peak' | 'mid_drop' | 'extended_crescendo' | 'continuous_pulse' | 'subdued_valley' = 'extended_crescendo';
  if (profile.music_profile.danceability > 65) {
    peak_profile = 'continuous_pulse';
  } else if (profile.music_profile.energy < 40) {
    peak_profile = 'subdued_valley';
  } else if (profile.music_profile.aggression > 60) {
    peak_profile = 'mid_drop';
  }

  const primaryScene = profile.visual_context.scene[0] || 'Atmospheric Space';
  const reverbDecay = profile.music_profile.atmospheric > 65 ? '3.8s diffuse plate' : '1.4s tight room';

  return {
    mood_tags,
    genres: finalGenres,
    target_bpm: profile.tempo.target,
    energy_level,
    vibe_verdict: profile.vibe_verdict || profile.strategy_concept,
    dominant_colors: profile.visual_context.dominant_colors || [],
    location_setting: primaryScene,
    time_of_day: profile.visual_context.time_of_day || 'Сейчас',
    visual_atmosphere: profile.visual_context.atmosphere.join(', '),
    emotional_depth: `Текущее: ${profile.current_state.mood.join(', ')} (${profile.current_state.energy}%) → Желаемое: ${profile.desired_state.mood.join(', ')} (${profile.desired_state.energy}%)`,
    cinematic_scene: profile.visual_context.scene.join(' // '),
    timbre_profile: {
      texture: `Мелодичность: ${profile.music_profile.melodicness}%, плотность: ${profile.music_profile.rhythm_density}%`,
      brightness,
      grain_and_saturation: profile.music_profile.experimental > 50 ? 'analog overdrive, subtle flutter' : 'clean digital clarity',
      harmonic_density,
      spectral_weight: profile.music_profile.darkness > 55 ? 'deep sub-bass, rolled-off highs' : 'balanced frequency spectrum',
    },
    energy_curve: {
      curve_type,
      tempo_feel: `${profile.tempo.target} BPM // ${profile.music_profile.danceability}% danceability`,
      dynamic_tension: profile.strategy_concept,
      peak_profile,
    },
    acoustic_landscape: {
      space_type: primaryScene,
      reverb_decay_time: reverbDecay,
      stereo_dimension: 'wide_panoramic_stereo',
      environmental_cues: profile.visual_context.atmosphere,
    },
  };
}

// 5. Main Vibe Analysis Endpoint
app.post('/api/analyze-vibe', async (req, res) => {
  try {
    const { photoBase64, moodText, userId, generationCount = 1, isSubscribed = false } = req.body || {};

    // Gate Subscription Rule:
    // User gets 1 free generation. On 2nd generation or higher, requires subscription to @speed_sound
    if (generationCount > 1 && !isSubscribed) {
      let realSubscribed = false;
      if (userId && process.env.TELEGRAM_BOT_TOKEN) {
        realSubscribed = await verifyTelegramChannelSubscription(userId);
      }

      if (!realSubscribed) {
        return res.json({
          gate_triggered: true,
          message: 'Подпишись на канал @speed_sound, чтобы разблокировать безлимитный ИИ-саундтрек момента.',
        });
      }
    }

    const ai = getGemini();
    let vibeData: VibeAnalysis | null = null;
    let musicProfile: MusicProfile | null = null;

    // Cache key for avoiding redundant Gemini calls and bypassing quota limits
    const cacheKey = photoBase64
      ? `photo_${photoBase64.slice(0, 100)}_${photoBase64.length}_${(moodText || '').toLowerCase().trim()}`
      : `mood_${(moodText || '').toLowerCase().trim()}`;

    if (vibeAnalysisCache.has(cacheKey)) {
      const cached = vibeAnalysisCache.get(cacheKey)!;
      vibeData = cached.vibe;
      musicProfile = cached.profile || null;
    }

    if (!vibeData && ai) {
      const systemInstruction = `Ты — элитный музыкальный куратор и аналитик.
Твоя задача — провести глубокий семантический анализ пользовательского контекста (текст и/или фотография) и составить точный, структурированный MusicProfile в формате JSON.

КРИТИЧЕСКИЕ ПРАВИЛА:
1. EXPLICIT USER INTENT > VISUAL INFERENCE: Текст пользователя имеет абсолютный приоритет! Если пользователь прямо пишет "я устал, хочу что-нибудь бодрое", то желаемое состояние (desired_state), энергия и музыкальный профиль определяются текстом (бодрый, энергичный), а фотография используется исключительно для атмосферного окраса, времени суток, текстуры и кинематографического фона. Не позволяй изображению отменять явно выраженное желание пользователя.
2. СТРОГО ЗАПРЕЩЕНО РЕКОМЕНДОВАТЬ ТРЕКИ: Не придумывай артистов, не предлагай названия песен, альбомов или списков треков. Твоя задача — исключительно описать многомерное МУЗЫКАЛЬНОЕ ПРОСТРАНСТВО (темп, акустические свойства, энергия, жанровые веса, драматургия), в котором система рекомендаций будет искать музыку.
3. ШКАЛЫ: Все числовые характеристики (energy, danceability, darkness, warmth, melodicness, atmospheric, aggression, experimental, rhythm_density, emotional_intensity, cinematic, visual_energy, discovery) строго от 0 до 100.
4. DISCOVERY: Шкала от 0 до 100 (0 = максимально знакомая, мейнстримная музыка; 100 = максимально новая, андерграундная, редкая, неожиданная музыка).
5. ЖАНРЫ И ВЕСА: Жанры (genres) и поджанры (subgenres) должны быть массивом объектов { name, weight }, где weight от 0 до 100. Веса должны отражать релевантность запросу. Не ограничивайся только Electronic. Если контекст требует Hip-Hop, Rock, Jazz, Ambient, Indie, Neo-Classical — используй их с соответствующими весами. Rock или любой другой жанр не должен добавляться автоматически — только если это уместно для запроса.
6. ТЕМП: Укажи реалистичный диапазон BPM (min, max, target), где min <= target <= max (в диапазоне от 60 до 200 BPM).`;

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

      if (photoBase64 && typeof photoBase64 === 'string') {
        if (photoBase64.startsWith('http://') || photoBase64.startsWith('https://')) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const imgRes = await fetch(photoBase64, {
              signal: controller.signal,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                Accept: 'image/*,*/*',
              },
            });
            clearTimeout(timeoutId);

            if (imgRes.ok) {
              const arrayBuffer = await imgRes.arrayBuffer();
              const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
              const base64Data = Buffer.from(arrayBuffer).toString('base64');
              parts.push({
                inlineData: {
                  mimeType: contentType.split(';')[0] || 'image/jpeg',
                  data: base64Data,
                },
              });
            } else {
              console.warn(`Could not load remote image (${imgRes.status}), proceeding with text.`);
            }
          } catch {
            // Silently proceed with text prompt
          }
        } else if (photoBase64.includes(';base64,')) {
          const split = photoBase64.split(';base64,');
          let mimeType = 'image/jpeg';
          const mimeMatch = split[0].match(/data:(.*?);/);
          if (mimeMatch) mimeType = mimeMatch[1];
          const base64Data = split[1]?.trim();
          if (base64Data) {
            parts.push({
              inlineData: {
                mimeType,
                data: base64Data,
              },
            });
          }
        } else {
          const cleaned = photoBase64.replace(/\s/g, '');
          if (/^[A-Za-z0-9+/=]+$/.test(cleaned) && cleaned.length > 50) {
            parts.push({
              inlineData: {
                mimeType: 'image/jpeg',
                data: cleaned,
              },
            });
          }
        }
      }

      const promptText = `Проведи семантический анализ и сформируй детальный MusicProfile.
${moodText ? `Текстовый контекст пользователя: "${moodText}"` : 'Анализируй визуальное настроение прикрепленного фото.'}
Помни: EXPLICIT USER INTENT > VISUAL INFERENCE.
Опиши current_state, desired_state, visual_context, music_profile, tempo, жанровые веса, discovery и эмоциональную драматургию (strategy_concept, strategy_emotional_arc, vibe_verdict).
Никаких названий песен и артистов!`;

      parts.push({ text: promptText });

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          current_state: {
            type: Type.OBJECT,
            properties: {
              mood: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Current mood descriptors' },
              energy: { type: Type.INTEGER, description: 'Scale 0-100' },
              emotional_intensity: { type: Type.INTEGER, description: 'Scale 0-100' },
            },
            required: ['mood', 'energy', 'emotional_intensity'],
          },
          desired_state: {
            type: Type.OBJECT,
            properties: {
              mood: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Target desired mood descriptors' },
              energy: { type: Type.INTEGER, description: 'Scale 0-100' },
              emotional_intensity: { type: Type.INTEGER, description: 'Scale 0-100' },
            },
            required: ['mood', 'energy', 'emotional_intensity'],
          },
          visual_context: {
            type: Type.OBJECT,
            properties: {
              scene: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Visual setting or scene tags' },
              time_of_day: { type: Type.STRING, description: 'Time of day (e.g. Night, Sunset, Dawn, Midday, Deep Night)' },
              atmosphere: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Atmosphere keywords' },
              dominant_colors: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Dominant colors detected in the scene' },
              cinematic: { type: Type.INTEGER, description: 'Scale 0-100' },
              darkness: { type: Type.INTEGER, description: 'Scale 0-100' },
              warmth: { type: Type.INTEGER, description: 'Scale 0-100' },
              visual_energy: { type: Type.INTEGER, description: 'Scale 0-100' },
            },
            required: ['scene', 'time_of_day', 'atmosphere', 'dominant_colors', 'cinematic', 'darkness', 'warmth', 'visual_energy'],
          },
          music_profile: {
            type: Type.OBJECT,
            properties: {
              energy: { type: Type.INTEGER, description: 'Scale 0-100' },
              danceability: { type: Type.INTEGER, description: 'Scale 0-100' },
              darkness: { type: Type.INTEGER, description: 'Scale 0-100' },
              warmth: { type: Type.INTEGER, description: 'Scale 0-100' },
              melodicness: { type: Type.INTEGER, description: 'Scale 0-100' },
              atmospheric: { type: Type.INTEGER, description: 'Scale 0-100' },
              aggression: { type: Type.INTEGER, description: 'Scale 0-100' },
              experimental: { type: Type.INTEGER, description: 'Scale 0-100' },
              rhythm_density: { type: Type.INTEGER, description: 'Scale 0-100' },
            },
            required: ['energy', 'danceability', 'darkness', 'warmth', 'melodicness', 'atmospheric', 'aggression', 'experimental', 'rhythm_density'],
          },
          tempo: {
            type: Type.OBJECT,
            properties: {
              min: { type: Type.INTEGER, description: 'Min BPM (60-200)' },
              max: { type: Type.INTEGER, description: 'Max BPM (60-200)' },
              target: { type: Type.INTEGER, description: 'Target BPM (60-200)' },
            },
            required: ['min', 'max', 'target'],
          },
          genres: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                weight: { type: Type.INTEGER, description: 'Relevance weight 0-100' },
              },
              required: ['name', 'weight'],
            },
            description: 'Primary genres and their weights',
          },
          subgenres: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                weight: { type: Type.INTEGER, description: 'Relevance weight 0-100' },
              },
              required: ['name', 'weight'],
            },
            description: 'Subgenres and their weights',
          },
          artist_styles: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Stylistic and aesthetic reference archetypes',
          },
          avoid: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Genres, textures or moods to strictly avoid',
          },
          discovery: {
            type: Type.INTEGER,
            description: 'Scale 0-100 (0 = familiar/mainstream, 100 = underground/discovery/niche)',
          },
          strategy_concept: {
            type: Type.STRING,
            description: '1-2 sentence core curation narrative',
          },
          strategy_emotional_arc: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Emotional progression phases',
          },
          vibe_verdict: {
            type: Type.STRING,
            description: 'A poetic, evocative summary statement of the vibe',
          },
        },
        required: [
          'current_state',
          'desired_state',
          'visual_context',
          'music_profile',
          'tempo',
          'genres',
          'subgenres',
          'artist_styles',
          'avoid',
          'discovery',
          'strategy_concept',
          'strategy_emotional_arc',
          'vibe_verdict',
        ],
      };

      // Model cascade to handle per-model rate limits or quota constraints gracefully
      if (GeminiCircuitBreaker.isAvailable()) {
        const candidateModels = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];

        for (const model of candidateModels) {
          if (!GeminiCircuitBreaker.isAvailable()) break;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => {
            controller.abort();
          }, 4500);

          try {
            const response = await ai.models.generateContent({
              model,
              contents: { parts },
              config: {
                systemInstruction,
                responseMimeType: 'application/json',
                responseSchema,
                abortSignal: controller.signal,
              },
            });

            const rawText = response.text?.trim();
            if (rawText) {
              const parsed = JSON.parse(rawText) as any;
              const validated = validateMusicProfile(parsed);
              musicProfile = validated;
              vibeData = adaptMusicProfileToVibeAnalysis(validated);
              GeminiCircuitBreaker.recordSuccess();
              break;
            }
          } catch (modelErr: any) {
            const status = parseGeminiNoticeStatus(modelErr);
            console.info(`[Speed of Sound] Gemini ${model} unavailable (${status}). Trying next model or editorial engine.`);
            if (status.includes('503') || status.includes('429')) {
              GeminiCircuitBreaker.recordFailure(status);
              break;
            }
          } finally {
            clearTimeout(timeoutId);
          }
        }
      } else {
        console.info('[Speed of Sound] Gemini API in cooldown. Fast editorial engine active.');
      }
    }

    // If Gemini wasn't configured, failed or hit rate limits, seamlessly use Editorial Intelligence engine
    if (!vibeData) {
      vibeData = generateHeuristicVibe(moodText);
    }

    // Save to cache for ultra-fast subsequent lookups and quota preservation
    if (vibeData) {
      vibeAnalysisCache.set(cacheKey, {
        vibe: vibeData,
        profile: musicProfile || undefined,
      });
    }

    // Stage 2 & 3A recommendation pipeline:
    const effectiveProfile = musicProfile || synthesizeProfileFromVibe(vibeData);
    const candidates = retrieveCandidates(effectiveProfile, SPEED_SOUND_TRACKS);
    const ranked = rankCandidates(effectiveProfile, candidates);
    
    // Get up to 30 candidates from Stage 2 for semantic reranking
    const top30Ranked = selectTopCandidatesRanked(ranked, 30, 2);
    
    // Stage 3A: Semantic Reranking (pick best 10)
    const catalogMatches = await performSemanticReranking(effectiveProfile, top30Ranked, 10);
    
    // Stage 3B: Playlist Optimization
    const optimizedMatches = optimizePlaylistOrder(catalogMatches, effectiveProfile);

    // Stage 4A: Last.fm Enrichment
    const enrichedWithLastFm = await enrichWithLastFm(optimizedMatches);

    // Crucial step: Resolve real studio audio streams from SoundCloud / iTunes for each track!
    const enrichedPlaylist = await enrichTracksWithRealAudio(enrichedWithLastFm);

    // Stage 4C.5 P0 Final Invariant Guard: Ensure playlist uniqueness and length
    const candidateTracks = candidates.map(c => typeof c === 'object' && 'track' in c ? (c as any).track : c);
    const finalPlaylist = dedupeTracksById(enrichedPlaylist, candidateTracks, 10, 3, effectiveProfile.avoid);

    const uniqueIdsCount = new Set(finalPlaylist.map((t) => t.id)).size;
    console.log(`[Speed of Sound] Final Playlist Invariant: length=${finalPlaylist.length}, uniqueIds=${uniqueIdsCount}`);

    return res.json({
      gate_triggered: false,
      vibe: vibeData,
      playlist: finalPlaylist,
    });
  } catch (error) {
    console.error('Fatal /api/analyze-vibe error:', error);
    res.status(500).json({
      error: 'Ошибка при анализе настроения. Попробуйте еще раз.',
    });
  }
});

// --- USER PROFILE & AUTH ENDPOINTS ---
app.post('/api/auth/register', (req, res) => {
  try {
    const { username, password, displayName, telegramId } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }
    const user = storage.registerUser(username.trim(), password, displayName?.trim(), telegramId);
    res.json({ success: true, user });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Ошибка регистрации' });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Введите логин и пароль' });
    }
    const user = storage.loginUser(username.trim(), password);
    res.json({ success: true, user });
  } catch (err: any) {
    res.status(401).json({ error: err.message || 'Неверные данные для входа' });
  }
});

app.post('/api/auth/telegram-sync', (req, res) => {
  try {
    const { id, first_name, username } = req.body || {};
    if (!id) {
      return res.status(400).json({ error: 'Telegram ID обязателен' });
    }
    const user = storage.syncTelegramUser({ id, first_name: first_name || 'Listener', username });
    res.json({ success: true, user });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/user/:id', (req, res) => {
  const user = storage.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ user });
});

// --- SAVED PLAYLISTS & HISTORY ENDPOINTS ---
app.post('/api/playlists', (req, res) => {
  try {
    const { userId, authorName, name, customTags, vibe, tracks, photoUrl, moodText } = req.body || {};
    if (!userId || !tracks || !vibe) {
      return res.status(400).json({ error: 'Недостаточно данных для сохранения плейлиста' });
    }
    const saved = storage.createPlaylist(
      userId,
      authorName || 'Слушатель',
      name || 'Саундтрек момента',
      customTags || [],
      vibe,
      tracks,
      photoUrl,
      moodText
    );
    res.json({ success: true, playlist: saved });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Ошибка сохранения' });
  }
});

app.get('/api/playlists/user/:userId', (req, res) => {
  const playlists = storage.getUserPlaylists(req.params.userId);
  res.json({ playlists });
});

app.get('/api/playlists/:id', (req, res) => {
  const playlist = storage.getPlaylistById(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Плейлист не найден' });
  res.json({ playlist });
});

app.put('/api/playlists/:id', (req, res) => {
  try {
    const { userId, name, customTags } = req.body || {};
    const updated = storage.updatePlaylist(req.params.id, userId, { name, customTags });
    res.json({ success: true, playlist: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/playlists/:id', (req, res) => {
  try {
    const { userId } = req.body || {};
    const success = storage.deletePlaylist(req.params.id, userId);
    res.json({ success });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- PLAYLIST SHARING & COLLABORATION ENDPOINTS ---
app.get('/api/playlists/share/:shareCode', (req, res) => {
  const playlist = storage.getPlaylistByShareCode(req.params.shareCode);
  if (!playlist) return res.status(404).json({ error: 'Плейлист не найден или срок ссылки истек' });
  res.json({ playlist });
});

app.post('/api/playlists/share/:shareCode/add-track', (req, res) => {
  try {
    const { track, addedBy, comment } = req.body || {};
    if (!track) {
      return res.status(400).json({ error: 'Необходимо указать трек' });
    }
    const updated = storage.addCollaborativeTrack(
      req.params.shareCode,
      track,
      addedBy || 'Друг',
      comment
    );
    res.json({ success: true, playlist: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Vite & Static middleware setup
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Speed of Sound TMA server running on http://0.0.0.0:${PORT}`);
  });
}

if (
  process.env.NODE_ENV !== 'test' &&
  !process.argv.some((arg) => arg.includes('tests/') || arg.includes('qa-'))
) {
  startServer();
}
