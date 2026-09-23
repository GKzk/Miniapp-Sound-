import type { Track } from '../../types';
import type {
  MusicProvider,
  MusicProviderAdapter,
  PlaybackType,
  TrackSource,
  TrackSearchQuery,
} from './types';
import { ITunesProviderAdapter, resolveITunesAudio, clearITunesCache } from './itunes';
import {
  SoundCloudProviderAdapter,
  clearSoundCloudCaches,
  invalidateSoundCloudStreamCache,
  runSoundCloudPlaybackDiagnostic,
  soundCloudMetrics,
} from './soundcloud';
import {
  AppleMusicProviderAdapter,
  SpotifyProviderAdapter,
} from './placeholders';

export type { MusicProvider, PlaybackType, TrackSource, MusicProviderAdapter, TrackSearchQuery };
export {
  ITunesProviderAdapter,
  resolveITunesAudio,
  clearITunesCache,
  SoundCloudProviderAdapter,
  clearSoundCloudCaches,
  invalidateSoundCloudStreamCache,
  runSoundCloudPlaybackDiagnostic,
  AppleMusicProviderAdapter,
  SpotifyProviderAdapter,
};

// Singleton adapter instances
export const itunesAdapter = new ITunesProviderAdapter();
export const soundCloudAdapter = new SoundCloudProviderAdapter();
export const appleMusicAdapter = new AppleMusicProviderAdapter();
export const spotifyAdapter = new SpotifyProviderAdapter();

// Default registered provider adapters for active playback:
// Strict priority order:
// 1. SoundCloud (priority full stream / preview)
// 2. iTunes (official 30s preview fallback)
// Apple Music & Spotify remain architecturally ready for future stages, but are not in the active playback chain.
export const defaultMusicProviders: MusicProviderAdapter[] = [
  soundCloudAdapter,
  itunesAdapter,
];

/**
 * Validates a TrackSource.
 * Prevents invalid states, such as iTunes being marked as 'full' playback.
 */
export function validateTrackSource(source: TrackSource): boolean {
  if (!source || !source.provider || !source.playback) {
    return false;
  }
  // Enforce: iTunes preview is strictly a preview, never full
  if (source.provider === 'itunes' && source.playback === 'full') {
    return false;
  }
  return true;
}

/**
 * Resolves the primary playable source for a track according to Stage 4B / 4C.1 priority:
 * 1. SoundCloud full playback source has priority 1
 * 2. Any other full playback source (must be available and have a stream url)
 * 3. SoundCloud preview source
 * 4. iTunes preview source
 * 5. Returns null if no playable source is available (triggers procedural DSP synth fallback)
 */
export function getPlayableSource(
  track: Track,
  failedSourceUrls: Set<string> = new Set()
): TrackSource | null {
  if (!track || !Array.isArray(track.sources) || track.sources.length === 0) {
    return null;
  }

  const validSources = track.sources.filter(
    (s) =>
      s.available !== false &&
      Boolean(s.url) &&
      !failedSourceUrls.has(s.url!) &&
      validateTrackSource(s)
  );

  // 1. Priority 1: SoundCloud Full
  const scFull = validSources.find(
    (s) => s.provider === 'soundcloud' && s.playback === 'full'
  );
  if (scFull) return scFull;

  // 2. Priority 2: Other Full sources
  const otherFull = validSources.find((s) => s.playback === 'full');
  if (otherFull) return otherFull;

  // 3. Priority 3: SoundCloud Preview
  const scPreview = validSources.find(
    (s) => s.provider === 'soundcloud' && s.playback === 'preview'
  );
  if (scPreview) return scPreview;

  // 4. Priority 4: iTunes Preview
  const itunesPreview = validSources.find(
    (s) => s.provider === 'itunes' && s.playback === 'preview'
  );
  if (itunesPreview) return itunesPreview;

  // 5. Priority 5: Any other valid preview source
  const anyPreview = validSources.find((s) => s.playback === 'preview');
  if (anyPreview) return anyPreview;

  // External sources are not automatically played
  return null;
}

/**
 * Deduplicates sources by provider and playback type.
 */
export function deduplicateSources(sources: TrackSource[]): TrackSource[] {
  const seenKeys = new Set<string>();
  const result: TrackSource[] = [];

  for (const src of sources) {
    if (!validateTrackSource(src)) continue;
    const key = `${src.provider}:${src.playback}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      result.push(src);
    }
  }

  return result;
}

/**
 * Resolves track sources from registered provider adapters.
 * Gracefully handles provider errors and guarantees metadata integrity.
 */
export async function resolveTrackSources(
  track: Track,
  providers: MusicProviderAdapter[] = defaultMusicProviders
): Promise<TrackSource[]> {
  const existingSources = Array.isArray(track.sources) ? [...track.sources] : [];
  const fetchedSources: TrackSource[] = [];

  // Query adapters safely in pipeline sequence
  for (const provider of providers) {
    try {
      const source =
        provider.searchTrack.length >= 2
          ? await (provider.searchTrack as any)(track.artist, track.title, track.durationSeconds)
          : await provider.searchTrack(track);
      if (source && validateTrackSource(source) && source.available !== false) {
        fetchedSources.push(source);
      }
    } catch {
      // Provider failure should never crash resolution or break the track
    }
  }

  // If track already has an audioUrl and no itunes preview in sources, ensure itunes preview exists
  if (
    track.audioUrl &&
    !fetchedSources.some((s) => s.provider === 'itunes') &&
    !existingSources.some((s) => s.provider === 'itunes')
  ) {
    fetchedSources.push({
      provider: 'itunes',
      playback: 'preview',
      url: track.audioUrl,
      available: true,
    });
  }

  // Count iTunes fallback occurrences when SoundCloud full/preview was not resolved
  const hasSoundCloud =
    fetchedSources.some((s) => s.provider === 'soundcloud') ||
    existingSources.some((s) => s.provider === 'soundcloud');
  const hasItunes =
    fetchedSources.some((s) => s.provider === 'itunes') ||
    existingSources.some((s) => s.provider === 'itunes');

  if (!hasSoundCloud && hasItunes) {
    soundCloudMetrics.itunesFallbackCount++;
  }

  // Merge and deduplicate
  return deduplicateSources([...existingSources, ...fetchedSources]);
}

/**
 * Enriches a Track with resolved sources while strictly preserving metadata.
 */
export async function enrichTrackWithSources(
  track: Track,
  providers: MusicProviderAdapter[] = defaultMusicProviders
): Promise<Track> {
  const sources = await resolveTrackSources(track, providers);
  const playable = getPlayableSource({ ...track, sources });

  // Resolve artwork from itunes source or track itself
  let artworkUrl = track.artworkUrl;
  if (!artworkUrl) {
    const itunesSource = sources.find((s) => s.provider === 'itunes');
    if (itunesSource?.artworkUrl) {
      artworkUrl = itunesSource.artworkUrl;
    }
  }

  const effectiveAudioUrl = playable?.url || track.audioUrl;
  const effectiveDuration = playable?.durationMs
    ? Math.round(playable.durationMs / 1000)
    : (track.durationSeconds || 30);

  return {
    ...track,
    audioUrl: effectiveAudioUrl,
    artworkUrl: artworkUrl || track.artworkUrl,
    durationSeconds: effectiveDuration,
    isRealAudio: Boolean(effectiveAudioUrl),
    sources: sources.length > 0 ? sources : undefined,
  };
}
