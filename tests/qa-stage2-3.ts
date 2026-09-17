import {
  retrieveCandidates,
  rankCandidates,
  selectTopCandidates,
} from '../server';
import { SPEED_SOUND_TRACKS } from '../src/data/tracks';
import { MusicProfile, Track, RankedCandidate } from '../src/types';

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
console.log('STAGE 2.3 QA TESTS');
console.log('==============================================');

// Test 9 - Strict Tier 1
console.log('Test 9 — Strict Tier 1');
{
  const profile = createBaseProfile({ tempo: { min: 130, max: 155, target: 140 } });
  const catalog = [
    createMockTrack({ id: 't130', bpm: 130 }),
    createMockTrack({ id: 't140', bpm: 140 }),
    createMockTrack({ id: 't155', bpm: 155 }),
    createMockTrack({ id: 't129', bpm: 129 }),
    createMockTrack({ id: 't156', bpm: 156 }),
    ...Array.from({ length: 20 }, (_, i) => createMockTrack({ id: `filler_${i}`, bpm: 140 }))
  ];
  
  const retrieved = retrieveCandidates(profile, catalog, { minCandidates: 20, maxCandidates: 30 });
  const t130 = retrieved.find(t => t.id === 't130');
  const t129 = retrieved.find(t => t.id === 't129');
  
  assert('130 is in Tier 1', !!t130 && (t130 as any)._retrievalTier === 1);
  assert('129 is not in Tier 1 (it is not retrieved because Tier 1 is sufficient)', !t129);
}

// Test 10 - Tier 2
console.log('Test 10 — Tier 2');
{
  const profile = createBaseProfile({ tempo: { min: 130, max: 155, target: 140 } });
  // only 5 tracks in Tier 1 -> Tier 2 will be activated.
  const catalog = [
    ...Array.from({ length: 5 }, (_, i) => createMockTrack({ id: `t1_${i}`, bpm: 140 })),
    createMockTrack({ id: 't120', bpm: 120 }), // Tier 2 (min - 10)
    createMockTrack({ id: 't165', bpm: 165 }), // Tier 2 (max + 10)
    createMockTrack({ id: 't110', bpm: 110 }), // Tier 3
  ];
  const retrieved = retrieveCandidates(profile, catalog, { minCandidates: 20, maxCandidates: 30 });
  const t120 = retrieved.find(t => t.id === 't120');
  const t165 = retrieved.find(t => t.id === 't165');
  const t110 = retrieved.find(t => t.id === 't110');
  
  assert('120 is retrieved as Tier 2', !!t120 && (t120 as any)._retrievalTier === 2);
  assert('165 is retrieved as Tier 2', !!t165 && (t165 as any)._retrievalTier === 2);
  assert('110 is retrieved as Tier 3', !!t110 && (t110 as any)._retrievalTier === 3);
}

// Test 11 - Tier 3
console.log('Test 11 — Tier 3');
{
  const profile = createBaseProfile({ tempo: { min: 130, max: 155, target: 140 } });
  // only 5 tracks total in catalog, none in T1, none in T2
  const catalog = [
    ...Array.from({ length: 5 }, (_, i) => createMockTrack({ id: `t3_${i}`, bpm: 100 })),
  ];
  const retrieved = retrieveCandidates(profile, catalog, { minCandidates: 20, maxCandidates: 30 });
  
  assert('Tier 3 is used when T1+T2 < minCandidates', retrieved.length === 5);
  assert('Tracks are correctly marked as Tier 3', (retrieved[0] as any)._retrievalTier === 3);
}

// Test 12 - Tier 1 Sufficiency
console.log('Test 12 — Tier 1 Sufficiency');
{
  const profile = createBaseProfile({ tempo: { min: 130, max: 155, target: 140 } });
  // >= 20 tracks in Tier 1
  const catalog = [
    ...Array.from({ length: 25 }, (_, i) => createMockTrack({ id: `t1_${i}`, bpm: 140 })),
    createMockTrack({ id: 't2_125', bpm: 125 }), // Tier 2
    createMockTrack({ id: 't3_100', bpm: 100 }), // Tier 3
  ];
  const retrieved = retrieveCandidates(profile, catalog, { minCandidates: 20, maxCandidates: 30 });
  
  const hasTier2 = retrieved.some(t => (t as any)._retrievalTier === 2);
  const hasTier3 = retrieved.some(t => (t as any)._retrievalTier === 3);
  
  assert('Tier 2 is NOT used when Tier 1 >= minimum', !hasTier2);
  assert('Tier 3 is NOT used when Tier 1 >= minimum', !hasTier3);
}

// Test 13 - BPM Outlier
console.log('Test 13 — BPM Outlier Ranking');
{
  const profile = createBaseProfile({
    tempo: { min: 130, max: 155, target: 140 },
    music_profile: { ...createBaseProfile().music_profile, energy: 80 },
    genres: [{ name: 'Industrial Techno', weight: 100 }],
    subgenres: [{ name: 'EBM', weight: 50 }]
  });
  
  const tOutlier = createMockTrack({ id: 'outlier', genres: ['Industrial Techno', 'EBM'], bpm: 115, energy: 8 });
  const tInBand = createMockTrack({ id: 'inband', genres: ['Techno'], bpm: 140, energy: 8 });
  
  const ranked = rankCandidates(profile, [tOutlier, tInBand]);
  const sOutlier = ranked.find(r => r.track.id === 'outlier');
  const sInBand = ranked.find(r => r.track.id === 'inband');
  
  assert('BPM Outlier gets expected decayed score', sOutlier!.breakdown.bpm === 0);
  assert('In-band gets 20', sInBand!.breakdown.bpm === 20);
  // Total score:
  // Outlier: Genre(30) + Sub(10) + Energy(15) + BPM(0) = 55
  // In-band: Genre(20) + Sub(0) + Energy(15) + BPM(20) = 55
  // So they are tied in base features (before Timbre/Mood). 
  // With tier 1 vs tier 3, in-band wins tie-breaker! (Assuming retrieval Tier was used)
  // Let's manually inject tier
  const tOutlierTiered = { ...tOutlier, _retrievalTier: 3 };
  const tInBandTiered = { ...tInBand, _retrievalTier: 1 };
  const rankedTiered = rankCandidates(profile, [tOutlierTiered, tInBandTiered]);
  assert('Tier 1 in-band candidate beats or equals Tier 3 outlier', rankedTiered[0].track.id === 'inband');
}

// Test 14 - Synthetic Profile B on Real Catalog
console.log('Test 14 — Profile B Synthetic Test');
{
  const profileB = createBaseProfile({
    tempo: { min: 130, max: 155, target: 140 },
    music_profile: { ...createBaseProfile().music_profile, energy: 85 },
    genres: [{ name: 'Industrial Techno', weight: 100 }, { name: 'Dark Techno', weight: 80 }, { name: 'EBM', weight: 70 }]
  });

  const candidates = retrieveCandidates(profileB, SPEED_SOUND_TRACKS);
  
  const t1Count = candidates.filter(t => (t as any)._retrievalTier === 1).length;
  const t2Count = candidates.filter(t => (t as any)._retrievalTier === 2).length;
  const t3Count = candidates.filter(t => (t as any)._retrievalTier === 3).length;
  
  assert('Candidates retrieved count > 0', candidates.length > 0);
  
  const ranked = rankCandidates(profileB, candidates);
  const top10 = selectTopCandidates(ranked, 10, 2);
  
  const isGesaffelsteinInTop10 = top10.some(t => t.artist === 'Gesaffelstein');
  assert('Gesaffelstein - Pursuit (115 BPM) is not in Top 10 for Profile B', !isGesaffelsteinInTop10);
  
  const outliersCount = top10.filter(t => t.bpm < 130 || t.bpm > 155).length;
  assert('Number of outliers in Top 10 is low or 0', outliersCount <= 5, `Outliers: ${outliersCount}`);
}

console.log('\n==============================================');
console.log('REAL CATALOG SIMULATION (STAGE 2.3)');
console.log('==============================================');

const realProfiles = [
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

realProfiles.forEach(p => {
  console.log(`\n>>> PROFILE ${p.name.charAt(0)}: ${p.name.substring(4).toUpperCase()} <<<`);
  console.log(`Target BPM: ${p.profile.tempo.target} (range: ${p.profile.tempo.min}-${p.profile.tempo.max})`);
  
  const candidates = retrieveCandidates(p.profile, SPEED_SOUND_TRACKS);
  
  const t1 = candidates.filter(t => (t as any)._retrievalTier === 1).length;
  const t2 = candidates.filter(t => (t as any)._retrievalTier === 2).length;
  const t3 = candidates.filter(t => (t as any)._retrievalTier === 3).length;
  
  console.log(`1. Retrieved candidates count: ${candidates.length} (Tier1: ${t1}, Tier2: ${t2}, Tier3: ${t3})`);

  const ranked = rankCandidates(p.profile, candidates);
  const selected = selectTopCandidates(ranked, 10, 2);

  console.log('2. Final Selected Tracks (Top 10):');
  let outliers = 0;
  selected.forEach((t, i) => {
    const isOut = t.bpm < p.profile.tempo.min || t.bpm > p.profile.tempo.max;
    if (isOut) outliers++;
    const mark = isOut ? '*OUTLIER* ' : '';
    console.log(`   ${i + 1}. ${mark}[T${(t as any)._retrievalTier || 1}] ${t.artist} - ${t.title} (${t.bpm} BPM, E:${t.energy})`);
  });
  console.log(`3. Outliers in Top 10: ${outliers}`);
});

if (failed) {
  console.log('\n==============================================');
  console.log('SOME QA TESTS FAILED! CHECK OUTPUT ABOVE.');
  process.exit(1);
} else {
  console.log('\n==============================================');
  console.log('ALL NEW QA TESTS PASSED SUCCESSFULLY!');
  console.log('==============================================');
}
