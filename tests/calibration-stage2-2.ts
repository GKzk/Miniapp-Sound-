import {
  retrieveCandidates,
  rankCandidates,
  normalizeText,
} from '../server';
import { SPEED_SOUND_TRACKS } from '../src/data/tracks';
import { MusicProfile, Track } from '../src/types';

function createMockTrack(overrides: Partial<Track>): Track {
  return {
    id: overrides.id || `mock_${Math.random()}`,
    artist: overrides.artist || 'Mock Artist',
    title: overrides.title || 'Mock Title',
    bpm: overrides.bpm ?? 128,
    energy: overrides.energy ?? 5,
    genres: overrides.genres || ['Electronic'],
    moods: overrides.moods || ['night'],
    vibeTags: overrides.vibeTags || ['#Electronic'],
    coverColor: '#000000',
    previewNote: 'Preview',
    synthPreset: 'techno',
    links: { spotify: '', yandex: '', apple: '' },
    ...overrides,
  };
}

function createBaseProfile(overrides: Partial<MusicProfile> = {}): MusicProfile {
  return {
    current_state: { mood: ['night'], energy: 50, emotional_intensity: 50 },
    desired_state: { mood: ['night'], energy: 50, emotional_intensity: 50 },
    visual_context: {
      scene: ['city'],
      time_of_day: 'night',
      atmosphere: ['urban'],
      dominant_colors: ['#000000'],
      cinematic: 50,
      darkness: 50,
      warmth: 50,
      visual_energy: 50,
    },
    music_profile: {
      energy: 50,
      danceability: 50,
      darkness: 50,
      warmth: 50,
      melodicness: 50,
      atmospheric: 50,
      aggression: 50,
      experimental: 50,
      rhythm_density: 50,
    },
    tempo: { min: 115, max: 145, target: 128 },
    genres: [{ name: 'Electronic', weight: 100 }],
    subgenres: [],
    artist_styles: [],
    avoid: [],
    discovery: 0,
    strategy_concept: 'Test',
    strategy_emotional_arc: ['Intro', 'Peak', 'Outro'],
    vibe_verdict: 'Test',
    ...overrides,
  };
}

// ---------------------------------------------------------
// TESTS A & B: Genre vs BPM Outlier
// ---------------------------------------------------------
console.log('--- TEST A & B: GENRE VS BPM ---');
const profileAB = createBaseProfile({
  tempo: { min: 130, max: 155, target: 140 },
  music_profile: { ...createBaseProfile().music_profile, energy: 80 }, // target energy 8.0
  genres: [{ name: 'Industrial Techno', weight: 100 }],
  subgenres: [{ name: 'EBM', weight: 50 }]
});

const trackA = createMockTrack({
  id: 'A_exact_genre_outlier_bpm',
  genres: ['Industrial Techno', 'EBM'],
  bpm: 115,
  energy: 8
});

const trackB = createMockTrack({
  id: 'B_adjacent_genre_target_bpm',
  genres: ['Techno'], // adjacent, not exact Industrial Techno
  bpm: 140,
  energy: 8
});

const trackC = createMockTrack({
  id: 'C_exact_genre_target_bpm',
  genres: ['Industrial Techno', 'EBM'],
  bpm: 140,
  energy: 8
});

const rankedAB = rankCandidates(profileAB, [trackA, trackB, trackC]);
rankedAB.forEach(r => {
  console.log(`Track: ${r.track.id}`);
  console.log(`  BPM: ${r.track.bpm}, Genres: ${r.track.genres.join(', ')}`);
  console.log(`  Genre: ${r.breakdown.genre}, Sub: ${r.breakdown.subgenre}, BPM: ${r.breakdown.bpm}, Energy: ${r.breakdown.energy}, Timbre: ${r.breakdown.timbre}`);
  console.log(`  Final Score: ${r.score}`);
});

// ---------------------------------------------------------
// TEST C: Allowed Range Decay
// ---------------------------------------------------------
console.log('\n--- TEST C: BPM RANGE SCORES ---');
const bpms = [115, 120, 125, 130, 135, 140, 145, 150, 155, 160];
const tracksC = bpms.map(bpm => createMockTrack({ id: `bpm_${bpm}`, bpm }));
const rankedC = rankCandidates(profileAB, tracksC);
console.log('Target: 140, Range: 130-155');
rankedC.sort((a,b) => a.track.bpm - b.track.bpm).forEach(r => {
  console.log(`BPM ${r.track.bpm.toString().padEnd(3)} -> Score: ${r.breakdown.bpm}`);
});

// ---------------------------------------------------------
// TEST D: Different Range Widths
// ---------------------------------------------------------
console.log('\n--- TEST D: WIDTH COMPARISONS ---');
const profNarrow = createBaseProfile({ tempo: { min: 135, max: 145, target: 140 } });
const profMedium = createBaseProfile({ tempo: { min: 130, max: 150, target: 140 } });
const profWide   = createBaseProfile({ tempo: { min: 110, max: 170, target: 140 } });

[120, 130, 135, 140, 145, 150, 160].forEach(bpm => {
  const trk = createMockTrack({ bpm });
  const n = rankCandidates(profNarrow, [trk])[0].breakdown.bpm;
  const m = rankCandidates(profMedium, [trk])[0].breakdown.bpm;
  const w = rankCandidates(profWide, [trk])[0].breakdown.bpm;
  console.log(`BPM ${bpm}: Narrow[135-145]=${n}, Medium[130-150]=${m}, Wide[110-170]=${w}`);
});

// ---------------------------------------------------------
// TEST E & RETRIEVAL: 5 Real Profiles
// ---------------------------------------------------------
console.log('\n--- TEST E & RETRIEVAL: REAL CATALOG SIMULATION ---');
const profiles = [
  {
    name: 'A - Rainy night city',
    profile: createBaseProfile({
      current_state: { mood: ['melancholic', 'nocturnal', 'rain'], energy: 50, emotional_intensity: 60 },
      music_profile: { energy: 55, danceability: 50, darkness: 70, warmth: 40, melodicness: 65, atmospheric: 85, aggression: 30, experimental: 50, rhythm_density: 55 },
      tempo: { min: 125, max: 135, target: 130 },
      genres: [{ name: 'Future Garage', weight: 90 }, { name: 'Electronic', weight: 70 }, { name: 'Downtempo', weight: 60 }]
    }),
  },
  {
    name: 'B - Dark industrial',
    profile: createBaseProfile({
      current_state: { mood: ['dark', 'mechanical', 'cold'], energy: 80, emotional_intensity: 85 },
      music_profile: { energy: 85, danceability: 65, darkness: 90, warmth: 20, melodicness: 30, atmospheric: 60, aggression: 85, experimental: 60, rhythm_density: 80 },
      tempo: { min: 130, max: 155, target: 140 },
      genres: [{ name: 'Industrial Techno', weight: 100 }, { name: 'Dark Techno', weight: 80 }, { name: 'EBM', weight: 70 }]
    }),
  },
  {
    name: 'C - Warm evening',
    profile: createBaseProfile({
      current_state: { mood: ['relaxed', 'warm', 'peace'], energy: 45, emotional_intensity: 40 },
      music_profile: { energy: 50, danceability: 60, darkness: 30, warmth: 85, melodicness: 75, atmospheric: 65, aggression: 15, experimental: 30, rhythm_density: 50 },
      tempo: { min: 115, max: 126, target: 122 },
      genres: [{ name: 'Deep House', weight: 90 }, { name: 'House', weight: 80 }, { name: 'Downtempo', weight: 60 }]
    }),
  },
  {
    name: 'D - Peak-time club',
    profile: createBaseProfile({
      current_state: { mood: ['energetic', 'club', 'drive'], energy: 85, emotional_intensity: 80 },
      music_profile: { energy: 90, danceability: 90, darkness: 50, warmth: 50, melodicness: 60, atmospheric: 50, aggression: 65, experimental: 30, rhythm_density: 85 },
      tempo: { min: 130, max: 145, target: 138 },
      genres: [{ name: 'Techno', weight: 90 }, { name: 'Electronic', weight: 70 }, { name: 'Trance', weight: 60 }]
    }),
  },
  {
    name: 'E - Experimental electronic',
    profile: createBaseProfile({
      current_state: { mood: ['unconventional', 'complex'], energy: 65, emotional_intensity: 70 },
      music_profile: { energy: 65, danceability: 50, darkness: 60, warmth: 45, melodicness: 55, atmospheric: 85, aggression: 50, experimental: 95, rhythm_density: 70 },
      tempo: { min: 110, max: 145, target: 125 },
      genres: [{ name: 'IDM', weight: 95 }, { name: 'Experimental Electronic', weight: 85 }, { name: 'Ambient Techno', weight: 75 }]
    }),
  }
];

profiles.forEach(p => {
  console.log(`\n>>> Profile: ${p.name}`);
  console.log(`Target BPM: ${p.profile.tempo.target} [${p.profile.tempo.min} - ${p.profile.tempo.max}]`);
  
  // Custom retrieval analysis
  const t1Min = p.profile.tempo.min - 15;
  const t1Max = p.profile.tempo.max + 15;
  const t2Min = p.profile.tempo.min - 25;
  const t2Max = p.profile.tempo.max + 25;
  
  let inTier1 = 0;
  let inTier2 = 0;
  let allCount = SPEED_SOUND_TRACKS.length;
  
  SPEED_SOUND_TRACKS.forEach(t => {
    if (t.bpm >= t1Min && t.bpm <= t1Max) inTier1++;
    if (t.bpm >= t2Min && t.bpm <= t2Max) inTier2++;
  });
  
  console.log(`Retrieval Info: Total Catalog = ${allCount}`);
  console.log(`  Tier 1 [${t1Min}-${t1Max}] count: ${inTier1}`);
  console.log(`  Tier 2 [${t2Min}-${t2Max}] count: ${inTier2}`);
  
  let relaxLevel = 'Tier 1 (No relax)';
  if (inTier1 < 20) relaxLevel = inTier2 < 20 ? 'Tier 3 (All tracks)' : 'Tier 2 (±25)';
  console.log(`  => Retrieval used: ${relaxLevel}`);

  const candidates = retrieveCandidates(p.profile, SPEED_SOUND_TRACKS);
  console.log(`  Actual Retrieved candidates count: ${candidates.length}`);

  const ranked = rankCandidates(p.profile, candidates);
  
  console.log(String('Artist').padEnd(20) + ' | ' + 'BPM'.padEnd(3) + ' | ' + 'BPM Scr'.padEnd(7) + ' | ' + 'Gen Scr'.padEnd(7) + ' | ' + 'En Scr'.padEnd(6) + ' | ' + 'Total');
  console.log(''.padEnd(70, '-'));
  ranked.slice(0, 10).forEach(r => {
    const isOutlier = r.track.bpm < p.profile.tempo.min || r.track.bpm > p.profile.tempo.max;
    const marker = isOutlier ? '*OUTLIER*' : '         ';
    console.log(`${r.track.artist.substring(0,19).padEnd(20)} | ${r.track.bpm.toString().padEnd(3)} | ${r.breakdown.bpm.toString().padEnd(7)} | ${r.breakdown.genre.toString().padEnd(7)} | ${r.breakdown.energy.toString().padEnd(6)} | ${r.score.toString()} ${marker}`);
  });
});
