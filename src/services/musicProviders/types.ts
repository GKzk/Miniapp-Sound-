import type { MusicProvider, PlaybackType, TrackSource } from '../../types';

export type { MusicProvider, PlaybackType, TrackSource };

export interface MusicProviderAdapter {
  readonly provider: MusicProvider;

  searchTrack(
    artist: string,
    title: string
  ): Promise<TrackSource | null>;
}
