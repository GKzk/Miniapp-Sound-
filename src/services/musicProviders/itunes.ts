import type { MusicProviderAdapter, TrackSource } from './types';

export interface ITunesAudioResolution {
  audioUrl?: string;
  artworkUrl?: string;
  durationSeconds?: number;
  providerTrackId?: string;
  source?: TrackSource;
}

// In-memory cache for audio streams & artwork
const itunesAudioCache = new Map<string, ITunesAudioResolution>();

/**
 * Resolves audio preview, artwork, duration and TrackSource from iTunes Search API.
 */
export async function resolveITunesAudio(
  artist: string,
  title: string,
  timeoutMs: number = 2500
): Promise<ITunesAudioResolution> {
  const cacheKey = `${artist.toLowerCase().trim()} - ${title.toLowerCase().trim()}`;
  if (itunesAudioCache.has(cacheKey)) {
    return itunesAudioCache.get(cacheKey)!;
  }

  try {
    const term = `${artist} ${title}`;
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=1`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as {
        results?: Array<{
          trackId?: number | string;
          previewUrl?: string;
          artworkUrl100?: string;
          trackTimeMillis?: number;
        }>;
      };

      if (data.results && data.results.length > 0) {
        const item = data.results[0];
        const artwork = item.artworkUrl100
          ? item.artworkUrl100.replace('100x100bb', '600x600bb')
          : undefined;

        const providerTrackId = item.trackId ? String(item.trackId) : undefined;
        const source: TrackSource | undefined = item.previewUrl
          ? {
              provider: 'itunes',
              playback: 'preview', // strictly preview fallback, never 'full'
              providerTrackId,
              url: item.previewUrl,
              available: true,
            }
          : undefined;

        const result: ITunesAudioResolution = {
          audioUrl: item.previewUrl,
          artworkUrl: artwork,
          durationSeconds: item.trackTimeMillis
            ? Math.round(item.trackTimeMillis / 1000)
            : 30,
          providerTrackId,
          source,
        };

        if (result.audioUrl) {
          itunesAudioCache.set(cacheKey, result);
        }
        return result;
      }
    }
  } catch {
    // Graceful fallback to synthesized DSP if preview isn't readily available or request times out
  }

  return {};
}

/**
 * iTunes adapter for the Music Provider abstraction layer.
 */
export class ITunesProviderAdapter implements MusicProviderAdapter {
  readonly provider = 'itunes' as const;

  async searchTrack(artist: string, title: string): Promise<TrackSource | null> {
    try {
      const resolved = await resolveITunesAudio(artist, title);
      return resolved.source || null;
    } catch {
      return null;
    }
  }
}
