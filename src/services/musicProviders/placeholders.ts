import type { MusicProviderAdapter, TrackSource, TrackSearchQuery } from './types';
import type { Track } from '../../types';

/**
 * Placeholder adapter for Apple Music.
 * On Stage 4B, this returns null (no OAuth, MusicKit, or user tokens).
 */
export class AppleMusicProviderAdapter implements MusicProviderAdapter {
  readonly provider = 'apple_music' as const;

  async searchTrack(_queryOrArtist: TrackSearchQuery | Track | string, _title?: string): Promise<TrackSource | null> {
    return null;
  }
}

/**
 * Placeholder adapter for Spotify.
 * On Stage 4B/4C, this returns null (no OAuth or Spotify Web Playback SDK).
 */
export class SpotifyProviderAdapter implements MusicProviderAdapter {
  readonly provider = 'spotify' as const;

  async searchTrack(_queryOrArtist: TrackSearchQuery | Track | string, _title?: string): Promise<TrackSource | null> {
    return null;
  }
}

