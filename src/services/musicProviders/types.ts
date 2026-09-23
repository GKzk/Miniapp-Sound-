import type { MusicProvider, PlaybackType, TrackSource, Track } from '../../types';

export type { MusicProvider, PlaybackType, TrackSource };

export interface TrackSearchQuery {
  artist: string;
  title: string;
  durationSeconds?: number;
}

export interface MusicProviderAdapter {
  readonly provider: MusicProvider;

  searchTrack(
    queryOrArtist: TrackSearchQuery | Track | string,
    title?: string
  ): Promise<TrackSource | null>;
}
