import {
  calculateTransitionScore,
  optimizePlaylistOrder,
} from '../server';
import { Track, MusicProfile } from '../src/types';

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
    tempo: { min: 130, max: 155, target: 140 },
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

let failed = false;
function assert(name: string, condition: boolean, message?: string) {
  if (condition) {
    console.log(`  [PASS] ${name}`);
  } else {
    console.error(`  [FAIL] ${name}${message ? ` (${message})` : ''}`);
    failed = true;
  }
}

console.log('==============================================');
console.log('STAGE 3B QA TESTS');
console.log('==============================================');

// Test 22 — Same tracks
console.log('Test 22 — Same tracks');
{
  const tracks = Array.from({ length: 10 }, (_, i) => createMockTrack({ id: `T${i}` }));
  const profile = createBaseProfile();
  const optimized = optimizePlaylistOrder(tracks, profile);
  
  assert('Output length is exactly 10', optimized.length === 10);
  
  const originalIds = new Set(tracks.map(t => t.id));
  const optimizedIds = new Set(optimized.map(t => t.id));
  let sameSet = true;
  for (const id of originalIds) {
    if (!optimizedIds.has(id)) sameSet = false;
  }
  assert('Original IDs and Output IDs match perfectly', sameSet);
}

// Test 23 — No hallucinated tracks
console.log('Test 23 — No hallucinated tracks');
{
  const tracks = Array.from({ length: 10 }, (_, i) => createMockTrack({ id: `T${i}` }));
  const profile = createBaseProfile();
  const optimized = optimizePlaylistOrder(tracks, profile);
  
  const hasUnknown = optimized.some(t => !tracks.find(o => o.id === t.id));
  assert('No unknown/hallucinated tracks', !hasUnknown);
}

// Test 24 — No mutation
console.log('Test 24 — No mutation');
{
  const track = createMockTrack({ id: 'M1', bpm: 120, energy: 5 });
  const tracks = [track, ...Array.from({ length: 9 }, (_, i) => createMockTrack({ id: `T${i}` }))];
  const profile = createBaseProfile();
  
  const originalJson = JSON.stringify(track);
  const optimized = optimizePlaylistOrder(tracks, profile);
  
  const optimizedTrack = optimized.find(t => t.id === 'M1');
  assert('Track properties are not mutated', JSON.stringify(optimizedTrack) === originalJson);
}

// Test 25 — BPM transition
console.log('Test 25 — BPM transition');
{
  // A calm profile with small BPM differences
  const tracks = [
    createMockTrack({ id: 'B1', bpm: 120 }),
    createMockTrack({ id: 'B2', bpm: 145 }), // Extreme jump
    createMockTrack({ id: 'B3', bpm: 122 }),
    createMockTrack({ id: 'B4', bpm: 124 }),
    createMockTrack({ id: 'B5', bpm: 126 })
  ];
  const profile = createBaseProfile({ strategy_emotional_arc: ['steady'] });
  const optimized = optimizePlaylistOrder(tracks, profile);
  
  // 145 BPM track should probably be placed at the end or somewhere it causes the least disruption 
  // since all other transitions are super smooth (120->122->124->126).
  // Actually, let's just check if 120,122,124,126 are grouped together.
  let smoothTransitions = 0;
  for (let i = 0; i < optimized.length - 1; i++) {
    if (Math.abs(optimized[i].bpm - optimized[i+1].bpm) <= 4) {
      smoothTransitions++;
    }
  }
  // Max possible smooth transitions is 3 (120-122-124-126).
  assert('Smooth BPM sequences are prioritized', smoothTransitions >= 2);
}

// Test 26 — Energy curve
console.log('Test 26 — Energy curve');
{
  const tracks = [
    createMockTrack({ id: 'E1', energy: 20 }),
    createMockTrack({ id: 'E2', energy: 80 }),
    createMockTrack({ id: 'E3', energy: 35 }),
    createMockTrack({ id: 'E4', energy: 65 }),
    createMockTrack({ id: 'E5', energy: 50 })
  ];
  // Convert our tracks to 1-10 scale as that's what's used
  tracks.forEach(t => t.energy = Math.round(t.energy / 10)); // 2, 8, 4, 7, 5
  
  const profile = createBaseProfile({ 
    current_state: { mood: [], energy: 20, emotional_intensity: 20 },
    desired_state: { mood: [], energy: 80, emotional_intensity: 80 },
    strategy_emotional_arc: ['escalation'] 
  });
  
  const optimized = optimizePlaylistOrder(tracks, profile);
  const e1Idx = optimized.findIndex(t => t.id === 'E1'); // 20
  const e2Idx = optimized.findIndex(t => t.id === 'E2'); // 80
  
  assert('Low energy tends to be earlier in an escalation arc', e1Idx < e2Idx);
}

// Test 27 — Peak and release
console.log('Test 27 — Peak and release');
{
  const tracks = [
    createMockTrack({ id: 'P1', energy: 3 }),
    createMockTrack({ id: 'P2', energy: 4 }),
    createMockTrack({ id: 'P3', energy: 6 }),
    createMockTrack({ id: 'P4', energy: 8 }),
    createMockTrack({ id: 'P5', energy: 9 }),
    createMockTrack({ id: 'P6', energy: 7 }),
    createMockTrack({ id: 'P7', energy: 5 })
  ];
  const profile = createBaseProfile({
    current_state: { mood: [], energy: 30, emotional_intensity: 30 },
    desired_state: { mood: [], energy: 50, emotional_intensity: 50 },
    strategy_emotional_arc: ['build', 'peak', 'release']
  });
  
  const optimized = optimizePlaylistOrder(tracks, profile);
  const peakTrack = optimized.find(t => t.energy === 9);
  const peakIdx = optimized.indexOf(peakTrack!);
  
  assert('Peak energy track is roughly in the middle/late part of the playlist', peakIdx > 2 && peakIdx < 6);
}

// Test 28 — Artist spacing
console.log('Test 28 — Artist spacing');
{
  const tracks = [
    createMockTrack({ id: 'A1', artist: 'Artist A' }),
    createMockTrack({ id: 'A2', artist: 'Artist A' }),
    createMockTrack({ id: 'A3', artist: 'Artist A' }),
    createMockTrack({ id: 'B1', artist: 'Artist B' }),
    createMockTrack({ id: 'B2', artist: 'Artist B' }),
    createMockTrack({ id: 'B3', artist: 'Artist B' }),
    createMockTrack({ id: 'C1', artist: 'Artist C' }),
    createMockTrack({ id: 'C2', artist: 'Artist C' }),
    createMockTrack({ id: 'C3', artist: 'Artist C' }),
    createMockTrack({ id: 'C4', artist: 'Artist C' }),
  ];
  
  const profile = createBaseProfile();
  const optimized = optimizePlaylistOrder(tracks, profile);
  
  let adjacentSameArtist = 0;
  for (let i = 0; i < optimized.length - 1; i++) {
    if (optimized[i].artist === optimized[i+1].artist) {
      adjacentSameArtist++;
    }
  }
  
  assert('Artist spacing is respected, preventing consecutive identical artists if possible', adjacentSameArtist <= 3);
}

// Test 29 — Determinism
console.log('Test 29 — Determinism');
{
  const tracks = Array.from({ length: 10 }, (_, i) => createMockTrack({ id: `T${i}` }));
  const profile = createBaseProfile();
  
  const opt1 = optimizePlaylistOrder(tracks, profile);
  const opt2 = optimizePlaylistOrder(tracks, profile);
  
  const ids1 = opt1.map(t => t.id).join(',');
  const ids2 = opt2.map(t => t.id).join(',');
  
  assert('Optimization is perfectly deterministic', ids1 === ids2);
}

// Test 30 — Empty / small input
console.log('Test 30 — Empty / small input');
{
  const profile = createBaseProfile();
  
  const opt0 = optimizePlaylistOrder([], profile);
  assert('Empty array does not crash', opt0.length === 0);
  
  const opt1 = optimizePlaylistOrder([createMockTrack({ id: '1' })], profile);
  assert('Single track array does not crash', opt1.length === 1);
  
  const opt2 = optimizePlaylistOrder([createMockTrack({ id: '1' }), createMockTrack({ id: '2' })], profile);
  assert('Two tracks array does not crash', opt2.length === 2);
}

// Test 31 — Missing optional audio metadata
console.log('Test 31 — Missing optional audio metadata');
{
  const tracks = [
    createMockTrack({ id: '1', timbreProfile: undefined, acousticLandscape: undefined }),
    createMockTrack({ id: '2', timbreProfile: undefined, acousticLandscape: undefined }),
    createMockTrack({ id: '3', timbreProfile: undefined, acousticLandscape: undefined })
  ];
  const profile = createBaseProfile();
  
  let crashed = false;
  try {
    optimizePlaylistOrder(tracks, profile);
  } catch (e) {
    crashed = true;
  }
  
  assert('Missing timbre/acoustic profiles do not crash the optimizer', !crashed);
}

import {
  SPEED_SOUND_TRACKS
} from '../src/data/tracks';
import { retrieveCandidates, rankCandidates, selectTopCandidatesRanked } from '../server';
// Need a fake Stage 3A array, or use top 10 from stage 2

console.log('\n==============================================');
console.log('REAL CATALOG SIMULATION (STAGE 3B)');
console.log('==============================================');

const realProfiles = [
  {
    name: 'A - Rainy night city',
    profile: createBaseProfile({
      current_state: { mood: ['melancholic', 'nocturnal', 'rain'], energy: 50, emotional_intensity: 60 },
      desired_state: { mood: ['calm', 'focused'], energy: 40, emotional_intensity: 40 },
      music_profile: { energy: 55, danceability: 50, darkness: 70, warmth: 40, melodicness: 65, atmospheric: 85, aggression: 30, experimental: 50, rhythm_density: 55 },
      tempo: { min: 125, max: 135, target: 130 },
      genres: [{ name: 'Future Garage', weight: 90 }, { name: 'Electronic', weight: 70 }, { name: 'Downtempo', weight: 60 }],
      strategy_emotional_arc: ['intro', 'immersion', 'hypnotic', 'outro']
    }),
  },
  {
    name: 'B - Dark industrial',
    profile: createBaseProfile({
      current_state: { mood: ['dark', 'mechanical', 'cold'], energy: 80, emotional_intensity: 85 },
      desired_state: { mood: ['aggressive', 'exhausted'], energy: 90, emotional_intensity: 90 },
      music_profile: { energy: 85, danceability: 65, darkness: 90, warmth: 20, melodicness: 30, atmospheric: 60, aggression: 85, experimental: 60, rhythm_density: 80 },
      tempo: { min: 130, max: 155, target: 140 },
      genres: [{ name: 'Industrial Techno', weight: 100 }, { name: 'Dark Techno', weight: 80 }, { name: 'EBM', weight: 70 }],
      strategy_emotional_arc: ['build', 'peak', 'aggressive']
    }),
  },
  {
    name: 'C - Warm evening',
    profile: createBaseProfile({
      current_state: { mood: ['relaxed', 'warm', 'peace'], energy: 45, emotional_intensity: 40 },
      desired_state: { mood: ['euphoric', 'warm'], energy: 65, emotional_intensity: 60 },
      music_profile: { energy: 50, danceability: 60, darkness: 30, warmth: 85, melodicness: 75, atmospheric: 65, aggression: 15, experimental: 30, rhythm_density: 50 },
      tempo: { min: 115, max: 126, target: 122 },
      genres: [{ name: 'Deep House', weight: 90 }, { name: 'House', weight: 80 }, { name: 'Downtempo', weight: 60 }],
      strategy_emotional_arc: ['intro', 'warmth', 'escalation']
    }),
  },
  {
    name: 'D - Peak-time club',
    profile: createBaseProfile({
      current_state: { mood: ['energetic', 'club', 'drive'], energy: 85, emotional_intensity: 80 },
      desired_state: { mood: ['calm', 'resolved'], energy: 40, emotional_intensity: 30 },
      music_profile: { energy: 90, danceability: 90, darkness: 50, warmth: 50, melodicness: 60, atmospheric: 50, aggression: 65, experimental: 30, rhythm_density: 85 },
      tempo: { min: 130, max: 145, target: 138 },
      genres: [{ name: 'Techno', weight: 90 }, { name: 'Electronic', weight: 70 }, { name: 'Trance', weight: 60 }],
      strategy_emotional_arc: ['peak', 'release', 'outro']
    }),
  },
  {
    name: 'E - Experimental electronic',
    profile: createBaseProfile({
      current_state: { mood: ['unconventional', 'complex'], energy: 65, emotional_intensity: 70 },
      desired_state: { mood: ['complex', 'hypnotic'], energy: 65, emotional_intensity: 70 },
      music_profile: { energy: 65, danceability: 50, darkness: 60, warmth: 45, melodicness: 55, atmospheric: 85, aggression: 50, experimental: 95, rhythm_density: 70 },
      tempo: { min: 110, max: 145, target: 125 },
      genres: [{ name: 'IDM', weight: 95 }, { name: 'Experimental Electronic', weight: 85 }, { name: 'Ambient Techno', weight: 75 }],
      strategy_emotional_arc: ['hypnotic', 'steady']
    }),
  }
];

function printPlaylist(title: string, tracks: Track[], profile: MusicProfile) {
  let avgBpm = 0;
  let totalScore = 0;
  let artistRepeats = 0;
  const energySeq: number[] = [];
  
  tracks.forEach((t, i) => {
    avgBpm += t.bpm;
    energySeq.push(t.energy);
    if (i < tracks.length - 1) {
      totalScore += calculateTransitionScore(t, tracks[i+1], profile);
      if (t.artist === tracks[i+1].artist) artistRepeats++;
    }
  });
  
  avgBpm /= tracks.length;
  const avgTransitionScore = tracks.length > 1 ? totalScore / (tracks.length - 1) : 0;
  
  console.log(`\n--- ${title} ---`);
  tracks.forEach((t, i) => {
    console.log(`  ${i+1}. ${t.artist} - ${t.title} [${t.bpm} BPM | Energy: ${t.energy}]`);
  });
  console.log(`  > Average BPM: ${avgBpm.toFixed(1)}`);
  console.log(`  > Energy Sequence: [${energySeq.join(' -> ')}]`);
  console.log(`  > Average Transition Score: ${avgTransitionScore.toFixed(1)}`);
  console.log(`  > Artist Repeats: ${artistRepeats}`);
}

async function runSimulation() {
  for (const p of realProfiles) {
    console.log(`\n>>> PROFILE ${p.name.charAt(0)}: ${p.name.substring(4).toUpperCase()} <<<`);
    
    // Stage 2 pipeline to get 10 tracks
    const candidates = retrieveCandidates(p.profile, SPEED_SOUND_TRACKS);
    const ranked = rankCandidates(p.profile, candidates);
    const top30 = selectTopCandidatesRanked(ranked, 30, 2);
    
    // Take exactly 10
    const stage3aMock = top30.slice(0, 10).map(c => c.track);
    
    // Stage 3B optimization
    const start = performance.now();
    const optimized = optimizePlaylistOrder(stage3aMock, p.profile);
    const end = performance.now();
    
    printPlaylist('Stage 3A Order (Input)', stage3aMock, p.profile);
    printPlaylist('Stage 3B Order (Optimized)', optimized, p.profile);
    console.log(`\n  [Stage 3B Optimization Time: ${(end - start).toFixed(2)} ms]`);
    console.log('-------------------------------------------');
  }

  if (failed) {
    console.log('\n==============================================');
    console.log('SOME QA TESTS FAILED! CHECK OUTPUT ABOVE.');
    process.exit(1);
  } else {
    console.log('\n==============================================');
    console.log('ALL NEW QA TESTS PASSED SUCCESSFULLY!');
    console.log('==============================================');
  }
}

runSimulation().catch(err => {
  console.error(err);
  process.exit(1);
});

