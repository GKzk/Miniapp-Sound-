export interface AudioTimbreProfile {
  texture: string; // e.g. 'tape-saturated analog Rhodes with vinyl flutter'
  brightness: 'dark' | 'mellow' | 'warm' | 'balanced' | 'bright' | 'crystalline';
  grain_and_saturation: string; // e.g. 'vintage vacuum-tube overdrive, subtle tape hiss'
  harmonic_density: 'sparse_minimal' | 'focused_monophonic' | 'rich_polyphonic' | 'dense_multilayered';
  spectral_weight: string; // e.g. 'deep sub-bass 35-50Hz, dipped harsh mids, silky rolled-off highs'
}

export interface AudioEnergyCurve {
  curve_type: 'hypnotic_linear' | 'slow_crescendo_to_drop' | 'undulating_waves' | 'explosive_burst' | 'nocturnal_drift' | 'staccato_stomp';
  tempo_feel: string; // e.g. 'half-time floating syncopation over driving 136 BPM'
  dynamic_tension: string; // e.g. 'taut cinematic suspense with sudden euphoric releases'
  peak_profile: 'intro_peak' | 'mid_drop' | 'extended_crescendo' | 'continuous_pulse' | 'subdued_valley';
}

export interface AcousticLandscape {
  space_type: string; // e.g. 'damp concrete underground warehouse with late diffuse reflections'
  reverb_decay_time: string; // e.g. '3.8s diffuse plate'
  stereo_dimension: 'tight_mono_intimate' | 'wide_panoramic_stereo' | 'binaural_3d_surround' | 'disorienting_haas_effect';
  environmental_cues: string[]; // e.g. ['wet asphalt reflection', 'distant siren echo', 'room ventilation hum']
}

export interface LastFmSimilarTrack {
  artist: string;
  title: string;
  match: number;
}

export interface LastFmSimilarArtist {
  name: string;
  match: number;
}

export interface LastFmMetadata {
  tags: string[];
  similarTracks: LastFmSimilarTrack[];
  similarArtists: LastFmSimilarArtist[];
}

export interface Track {
  id: string;
  artist: string;
  title: string;
  bpm: number;
  energy: number; // 1 to 10
  genres: string[];
  moods: string[];
  vibeTags: string[];
  coverColor: string;
  previewNote: string;
  synthPreset: 'uk_garage' | 'dark_wave' | 'lofi_hiphop' | 'phonk' | 'downtempo' | 'techno';
  durationSeconds?: number;
  audioUrl?: string; // Direct real audio stream URL (Apple iTunes / CDN)
  artworkUrl?: string; // High-res cover art (600x600)
  curatorReason?: string; // Contextual reason why this exact track matches the vibe
  moodMatch?: number;
  contextMatch?: number;
  transitionQuality?: number;
  overallScore?: number;
  isRealAudio?: boolean;
  timbreProfile?: AudioTimbreProfile;
  energyCurve?: AudioEnergyCurve;
  acousticLandscape?: AcousticLandscape;
  lastfm?: LastFmMetadata;
  links: {
    spotify: string;
    yandex: string;
    apple: string;
  };
}

export interface GenreScore {
  name: string;
  weight: number; // 0-100
}

export interface ScoreBreakdown {
  genre: number;          // 0..30
  subgenre: number;       // 0..10
  bpm: number;            // 0..20
  energy: number;         // 0..15
  mood: number;           // 0..10
  timbre: number;         // 0..10
  discovery: number;      // currently 0 unless real metadata exists
  avoidPenalty: number;   // 0 or negative
}

export interface RankedCandidate {
  track: Track;
  score: number;          // 0..100
  breakdown: ScoreBreakdown;
}

export interface MusicProfile {
  current_state: {
    mood: string[];
    energy: number;
    emotional_intensity: number;
  };
  desired_state: {
    mood: string[];
    energy: number;
    emotional_intensity: number;
  };
  visual_context: {
    scene: string[];
    time_of_day: string;
    atmosphere: string[];
    dominant_colors: string[];
    cinematic: number;
    darkness: number;
    warmth: number;
    visual_energy: number;
  };
  music_profile: {
    energy: number;
    danceability: number;
    darkness: number;
    warmth: number;
    melodicness: number;
    atmospheric: number;
    aggression: number;
    experimental: number;
    rhythm_density: number;
  };
  tempo: {
    min: number;
    max: number;
    target: number;
  };
  genres: GenreScore[];
  subgenres: GenreScore[];
  artist_styles: string[];
  avoid: string[];
  discovery: number;
  strategy_concept: string;
  strategy_emotional_arc: string[];
  vibe_verdict: string;
}

export interface AcousticProfile {
  sub_bass: string;
  percussion: string;
  space: string;
}

export interface VibeAnalysis {
  mood_tags: string[];
  genres: string[];
  target_bpm: number;
  energy_level: number;
  vibe_verdict: string;
  dominant_colors: string[];
  location_setting: string;
  time_of_day: string;
  // Deep multimodal analysis additions:
  visual_atmosphere?: string;
  emotional_depth?: string;
  acoustic_profile?: AcousticProfile;
  cinematic_scene?: string;
  // Higher-level audio features extracted from image:
  timbre_profile?: AudioTimbreProfile;
  energy_curve?: AudioEnergyCurve;
  acoustic_landscape?: AcousticLandscape;
  synesthetic_transduction?: string;
}

export interface AnalyzeResponse {
  gate_triggered: boolean;
  message?: string;
  vibe?: VibeAnalysis;
  playlist?: Track[];
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  is_subscribed: boolean;
}

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  telegramId?: number;
  isSubscribed?: boolean;
  createdAt: string;
}

export interface CollaborativeTrackItem {
  track: Track;
  addedBy: string;
  addedAt: string;
  comment?: string;
}

export interface SavedPlaylist {
  id: string;
  userId: string;
  authorName: string;
  name: string;
  customTags: string[];
  createdAt: string;
  photoUrl?: string;
  moodText?: string;
  vibe: VibeAnalysis;
  tracks: Track[];
  collaborativeTracks: CollaborativeTrackItem[];
  shareCode: string;
  viewsCount: number;
}
