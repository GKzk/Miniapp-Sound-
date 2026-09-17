import {
  retrieveCandidates,
  rankCandidates,
  selectTopCandidates,
  isHardAvoidMatch,
  calculateAvoidPenalty,
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
    tempo: { min: 115, max: 145, target: 128 },
    genres: [{ name: 'Electronic', weight: 100 }],
    subgenres: [],
    artist_styles: [],
    avoid: [],
    discovery: 0,
    strategy_concept: 'Test concept',
    strategy_emotional_arc: ['Intro', 'Peak', 'Outro'],
    vibe_verdict: 'Test verdict',
    ...overrides,
  };
}

let allPassed = true;
function assert(desc: string, condition: boolean, extraInfo?: string) {
  if (condition) {
    console.log(`  [PASS] ${desc}`);
  } else {
    console.error(`  [FAIL] ${desc} ${extraInfo ? `(${extraInfo})` : ''}`);
    allPassed = false;
  }
}

console.log('==============================================');
console.log('STAGE 2.1 QA TESTS');
console.log('==============================================\n');

// -------------------------------------------------------------
// Test 1: Artist diversity
// -------------------------------------------------------------
console.log('Test 1 — Artist Diversity');
{
  // Scenario 1A: 5 artists (A, B, C, D, E), limit = 10 -> sufficient artists, strictly max 2 per artist
  const fiveArtists: Track[] = [
    ...[1, 2, 3].map((i) => createMockTrack({ id: `a_${i}`, artist: 'Artist A', title: `Track A${i}` })),
    ...[1, 2, 3].map((i) => createMockTrack({ id: `b_${i}`, artist: 'Artist B', title: `Track B${i}` })),
    ...[1, 2, 3].map((i) => createMockTrack({ id: `c_${i}`, artist: 'Artist C', title: `Track C${i}` })),
    ...[1, 2, 3].map((i) => createMockTrack({ id: `d_${i}`, artist: 'Artist D', title: `Track D${i}` })),
    ...[1, 2, 3].map((i) => createMockTrack({ id: `e_${i}`, artist: 'Artist E', title: `Track E${i}` })),
  ];
  const ranked5: RankedCandidate[] = fiveArtists.map((t, idx) => ({
    track: t,
    score: 100 - idx,
    breakdown: { genre: 30, subgenre: 10, bpm: 20, energy: 15, mood: 10, timbre: 10, discovery: 0, avoidPenalty: 0 },
  }));
  const selected5 = selectTopCandidates(ranked5, 10, 2);
  const counts5 = new Map<string, number>();
  selected5.forEach((t) => counts5.set(t.artist, (counts5.get(t.artist) || 0) + 1));
  const maxIn5 = Math.max(...Array.from(counts5.values()));

  assert('Sufficient artists (5 artists): strictly max 2 per artist', maxIn5 <= 2, `max was ${maxIn5}`);
  assert('Sufficient artists reaches limit of 10 tracks', selected5.length === 10, `length was ${selected5.length}`);

  // Scenario 1B: Catalog: Artist A × 5, Artist B × 5, Artist C × 5, Artist D × 5. Limit = 10.
  // 4 artists: Pass 1 gives 4*2 = 8 (< 10). Relaxation triggers Pass 2 (max 3).
  // Total reached = 10, max per artist = 3, NEVER 4+.
  const fourArtists: Track[] = [
    ...[1, 2, 3, 4, 5].map((i) => createMockTrack({ id: `4a_${i}`, artist: 'Artist A', title: `Track A${i}` })),
    ...[1, 2, 3, 4, 5].map((i) => createMockTrack({ id: `4b_${i}`, artist: 'Artist B', title: `Track B${i}` })),
    ...[1, 2, 3, 4, 5].map((i) => createMockTrack({ id: `4c_${i}`, artist: 'Artist C', title: `Track C${i}` })),
    ...[1, 2, 3, 4, 5].map((i) => createMockTrack({ id: `4d_${i}`, artist: 'Artist D', title: `Track D${i}` })),
  ];
  const ranked4: RankedCandidate[] = fourArtists.map((t, idx) => ({
    track: t,
    score: 100 - idx,
    breakdown: { genre: 30, subgenre: 10, bpm: 20, energy: 15, mood: 10, timbre: 10, discovery: 0, avoidPenalty: 0 },
  }));
  const selected4 = selectTopCandidates(ranked4, 10, 2);
  const counts4 = new Map<string, number>();
  selected4.forEach((t) => counts4.set(t.artist, (counts4.get(t.artist) || 0) + 1));
  const maxIn4 = Math.max(...Array.from(counts4.values()));

  assert('4 artists catalog after relaxation: max 3 per artist', maxIn4 <= 3, `max was ${maxIn4}`);
  assert('4 artists catalog reaches limit of 10 tracks', selected4.length === 10, `length was ${selected4.length}`);
  assert('4 artists catalog never exceeds 3 (never 4+)', maxIn4 < 4, `max was ${maxIn4}`);

  // Scenario 1C: Capped catalog A×5, B×4, C×1 (Total 10 tracks, only 3 artists). Limit = 10.
  // Pass 1: max 2 -> A:2, B:2, C:1 (5 tracks)
  // Pass 2: max 3 -> A:3, B:3, C:1 (7 tracks)
  // After Pass 2: NO Pass 3! Total must be 7, NEVER add 4th track for A or B.
  const limitedTracks: Track[] = [
    ...[1, 2, 3, 4, 5].map((i) => createMockTrack({ id: `la_${i}`, artist: 'Artist A', title: `Track A${i}` })),
    ...[1, 2, 3, 4].map((i) => createMockTrack({ id: `lb_${i}`, artist: 'Artist B', title: `Track B${i}` })),
    createMockTrack({ id: 'lc_1', artist: 'Artist C', title: 'Track C1' }),
  ];
  const rankedLimited: RankedCandidate[] = limitedTracks.map((t, idx) => ({
    track: t,
    score: 100 - idx,
    breakdown: { genre: 30, subgenre: 10, bpm: 20, energy: 15, mood: 10, timbre: 10, discovery: 0, avoidPenalty: 0 },
  }));

  const selectedLimited = selectTopCandidates(rankedLimited, 10, 2);
  const countsLimited = new Map<string, number>();
  selectedLimited.forEach((t) => countsLimited.set(t.artist, (countsLimited.get(t.artist) || 0) + 1));
  const maxInLimited = Math.max(...Array.from(countsLimited.values()));

  assert('Capped catalog never violates max 3 per artist (no 4+ tracks)', maxInLimited <= 3, `max was ${maxInLimited}`);
  assert('Returns 7 tracks without adding A4/A5 or B4', selectedLimited.length === 7, `length was ${selectedLimited.length}`);
  assert('Artist A has exactly 3 tracks', countsLimited.get('Artist A') === 3);
  assert('Artist B has exactly 3 tracks', countsLimited.get('Artist B') === 3);
  assert('Artist C has exactly 1 track', countsLimited.get('Artist C') === 1);
}

// -------------------------------------------------------------
// Test 2: Exact hard avoid
// -------------------------------------------------------------
console.log('\nTest 2 — Exact Hard Avoid');
{
  const avoidList = ['house'];
  const houseTrack = createMockTrack({ id: 't_house', genres: ['House'] });
  const ambientHouseTrack = createMockTrack({ id: 't_amb_house', genres: ['Ambient House'] });
  const melodicHouseTrack = createMockTrack({ id: 't_mel_house', genres: ['Melodic House'] });

  assert('House is hard excluded', isHardAvoidMatch(houseTrack, avoidList) === true);
  assert('Ambient House is NOT hard excluded', isHardAvoidMatch(ambientHouseTrack, avoidList) === false);
  assert('Melodic House is NOT hard excluded', isHardAvoidMatch(melodicHouseTrack, avoidList) === false);

  // Check that Ambient House receives soft avoid penalty instead
  const softPenalty = calculateAvoidPenalty(ambientHouseTrack, avoidList);
  assert('Ambient House receives soft penalty (-5)', softPenalty === -5, `penalty was ${softPenalty}`);
}

// -------------------------------------------------------------
// Test 3: Artist hard avoid
// -------------------------------------------------------------
console.log('\nTest 3 — Artist Hard Avoid');
{
  const avoidList = ['Burial'];
  const burialTrack = createMockTrack({ id: 't_burial', artist: 'Burial', title: 'Archangel' });
  const otherTrack = createMockTrack({ id: 't_other', artist: 'Overmono', title: 'So U Kno' });

  assert('Burial artist is hard excluded', isHardAvoidMatch(burialTrack, avoidList) === true);
  assert('Non-Burial artist is NOT excluded', isHardAvoidMatch(otherTrack, avoidList) === false);
}

// -------------------------------------------------------------
// Test 4: Title hard avoid
// -------------------------------------------------------------
console.log('\nTest 4 — Title Hard Avoid');
{
  const avoidList = ['Archangel'];
  const archangelTrack = createMockTrack({ id: 't_arch', artist: 'Someone Else', title: 'Archangel' });
  const soUKnoTrack = createMockTrack({ id: 't_so', artist: 'Overmono', title: 'So U Kno' });

  assert('Archangel title is hard excluded', isHardAvoidMatch(archangelTrack, avoidList) === true);
  assert('Non-Archangel title is NOT excluded', isHardAvoidMatch(soUKnoTrack, avoidList) === false);
}

// -------------------------------------------------------------
// Test 5: BPM target scoring
// -------------------------------------------------------------
console.log('\nTest 5 — BPM Target Scoring');
{
  const profile = createBaseProfile({
    tempo: { min: 115, max: 145, target: 128 },
  });
  const trackTarget = createMockTrack({ id: 'bpm_128', bpm: 128, genres: ['Electronic'] });
  const trackEdge = createMockTrack({ id: 'bpm_143', bpm: 143, genres: ['Electronic'] });

  const ranked = rankCandidates(profile, [trackTarget, trackEdge]);
  const score128 = ranked.find((r) => r.track.id === 'bpm_128')!.breakdown.bpm;
  const score143 = ranked.find((r) => r.track.id === 'bpm_143')!.breakdown.bpm;

  assert('128 BPM receives full 20.0 pts', score128 === 20.0, `score was ${score128}`);
  assert('128 BPM receives notably higher BPM score than 143 BPM (diff >= 7 pts)', score128 - score143 >= 7, `128=${score128}, 143=${score143}, diff=${score128 - score143}`);
}

// -------------------------------------------------------------
// Test 6: BPM boundary scoring
// -------------------------------------------------------------
console.log('\nTest 6 — BPM Boundary Scoring');
{
  const profile = createBaseProfile({
    tempo: { min: 115, max: 145, target: 128 },
  });
  const track128 = createMockTrack({ id: 'bpm_128', bpm: 128 });
  const track145 = createMockTrack({ id: 'bpm_145', bpm: 145 }); // exact upper boundary
  const track115 = createMockTrack({ id: 'bpm_115', bpm: 115 }); // exact lower boundary

  const ranked = rankCandidates(profile, [track128, track145, track115]);
  const score128 = ranked.find((r) => r.track.id === 'bpm_128')!.breakdown.bpm;
  const score145 = ranked.find((r) => r.track.id === 'bpm_145')!.breakdown.bpm;
  const score115 = ranked.find((r) => r.track.id === 'bpm_115')!.breakdown.bpm;

  assert('Boundary 145 BPM receives exactly 10.0 pts', score145 === 10.0, `score was ${score145}`);
  assert('Boundary 115 BPM receives exactly 10.0 pts', score115 === 10.0, `score was ${score115}`);
  assert('Target 128 BPM is double the boundary score (20.0 vs 10.0)', score128 > score145 && score128 === 20.0);
}

// -------------------------------------------------------------
// Test 7: Determinism
// -------------------------------------------------------------
console.log('\nTest 7 — Determinism');
{
  const profile = createBaseProfile({
    tempo: { min: 120, max: 140, target: 130 },
    genres: [{ name: 'Techno', weight: 80 }, { name: 'Electronic', weight: 50 }],
  });

  const runs: string[][] = [];
  for (let i = 0; i < 5; i++) {
    const candidates = retrieveCandidates(profile, SPEED_SOUND_TRACKS);
    const ranked = rankCandidates(profile, candidates);
    const selected = selectTopCandidates(ranked, 10, 2);
    runs.push(selected.map((t) => t.id));
  }

  let deterministic = true;
  const firstRun = runs[0].join(',');
  for (let i = 1; i < runs.length; i++) {
    if (runs[i].join(',') !== firstRun) {
      deterministic = false;
      break;
    }
  }

  assert('5 consecutive runs produce identical track sequences', deterministic);
}

// -------------------------------------------------------------
// Test 8: No duplicate IDs
// -------------------------------------------------------------
console.log('\nTest 8 — No Duplicate IDs');
{
  const profile = createBaseProfile({
    tempo: { min: 110, max: 150, target: 130 },
  });
  const candidates = retrieveCandidates(profile, SPEED_SOUND_TRACKS);
  const ranked = rankCandidates(profile, candidates);
  const selected = selectTopCandidates(ranked, 10, 2);

  const ids = selected.map((t) => t.id);
  const uniqueIds = new Set(ids);
  assert('Final selected tracks contain 0 duplicate IDs', ids.length === uniqueIds.size, `${ids.length} vs ${uniqueIds.size}`);
}

// -------------------------------------------------------------
// 9. SIMULATION ON REAL CATALOG (5 SYNTHETIC PROFILES)
// -------------------------------------------------------------
console.log('\n==============================================');
console.log('REAL CATALOG SIMULATION (SPEED_SOUND_TRACKS: 50 TRACKS)');
console.log('==============================================\n');

const profilesToSimulate: Array<{ name: string; profile: MusicProfile }> = [
  {
    name: 'Profile A: Rainy night city',
    profile: createBaseProfile({
      current_state: { mood: ['melancholic', 'nocturnal', 'rain'], energy: 50, emotional_intensity: 60 },
      desired_state: { mood: ['atmospheric', 'nocturnal', 'melancholic'], energy: 55, emotional_intensity: 60 },
      music_profile: {
        energy: 55,
        danceability: 50,
        darkness: 70,
        warmth: 40,
        melodicness: 65,
        atmospheric: 85,
        aggression: 30,
        experimental: 50,
        rhythm_density: 55,
      },
      tempo: { min: 125, max: 135, target: 130 },
      genres: [
        { name: 'Future Garage', weight: 90 },
        { name: 'Electronic', weight: 70 },
        { name: 'Downtempo', weight: 60 },
      ],
      subgenres: [{ name: 'UK Garage', weight: 50 }, { name: 'Ambient', weight: 40 }],
    }),
  },
  {
    name: 'Profile B: Dark industrial',
    profile: createBaseProfile({
      current_state: { mood: ['dark', 'mechanical', 'cold'], energy: 80, emotional_intensity: 85 },
      desired_state: { mood: ['aggressive', 'dark', 'industrial'], energy: 85, emotional_intensity: 90 },
      music_profile: {
        energy: 85,
        danceability: 65,
        darkness: 90,
        warmth: 20,
        melodicness: 30,
        atmospheric: 60,
        aggression: 85,
        experimental: 60,
        rhythm_density: 80,
      },
      tempo: { min: 130, max: 155, target: 140 },
      genres: [
        { name: 'Industrial Techno', weight: 100 },
        { name: 'Dark Techno', weight: 80 },
        { name: 'EBM', weight: 70 },
      ],
      subgenres: [{ name: 'Industrial', weight: 60 }, { name: 'Dark Electro', weight: 50 }],
    }),
  },
  {
    name: 'Profile C: Warm evening',
    profile: createBaseProfile({
      current_state: { mood: ['relaxed', 'warm', 'peace'], energy: 45, emotional_intensity: 40 },
      desired_state: { mood: ['soulful', 'deep', 'warm'], energy: 50, emotional_intensity: 50 },
      music_profile: {
        energy: 50,
        danceability: 60,
        darkness: 30,
        warmth: 85,
        melodicness: 75,
        atmospheric: 65,
        aggression: 15,
        experimental: 30,
        rhythm_density: 50,
      },
      tempo: { min: 115, max: 126, target: 122 },
      genres: [
        { name: 'Deep House', weight: 90 },
        { name: 'House', weight: 80 },
        { name: 'Downtempo', weight: 60 },
      ],
      subgenres: [{ name: 'Soulful House', weight: 50 }, { name: 'Chillout', weight: 40 }],
    }),
  },
  {
    name: 'Profile D: Peak-time club',
    profile: createBaseProfile({
      current_state: { mood: ['energetic', 'club', 'drive'], energy: 85, emotional_intensity: 80 },
      desired_state: { mood: ['danceable', 'driving', 'euphoric'], energy: 90, emotional_intensity: 90 },
      music_profile: {
        energy: 90,
        danceability: 90,
        darkness: 50,
        warmth: 50,
        melodicness: 60,
        atmospheric: 50,
        aggression: 65,
        experimental: 30,
        rhythm_density: 85,
      },
      tempo: { min: 130, max: 145, target: 138 },
      genres: [
        { name: 'Techno', weight: 90 },
        { name: 'Electronic', weight: 70 },
        { name: 'Trance', weight: 60 },
      ],
      subgenres: [{ name: 'Peak Time Techno', weight: 50 }, { name: 'Hard Trance', weight: 40 }],
    }),
  },
  {
    name: 'Profile E: Experimental electronic',
    profile: createBaseProfile({
      current_state: { mood: ['unconventional', 'complex', 'curiosity'], energy: 65, emotional_intensity: 70 },
      desired_state: { mood: ['atmospheric', 'experimental', 'architecture'], energy: 65, emotional_intensity: 75 },
      music_profile: {
        energy: 65,
        danceability: 50,
        darkness: 60,
        warmth: 45,
        melodicness: 55,
        atmospheric: 85,
        aggression: 50,
        experimental: 95,
        rhythm_density: 70,
      },
      tempo: { min: 110, max: 145, target: 125 },
      genres: [
        { name: 'IDM', weight: 95 },
        { name: 'Experimental Electronic', weight: 85 },
        { name: 'Ambient Techno', weight: 75 },
      ],
      subgenres: [{ name: 'Glitch', weight: 50 }, { name: 'Leftfield', weight: 40 }],
    }),
  },
];

for (const sim of profilesToSimulate) {
  console.log(`\n>>> ${sim.name.toUpperCase()} <<<`);
  console.log(`Target BPM: ${sim.profile.tempo.target} (range: ${sim.profile.tempo.min}-${sim.profile.tempo.max}), Target Energy: ${sim.profile.music_profile.energy / 10}`);
  console.log(`Primary Genres: ${sim.profile.genres.map((g) => `${g.name} (${g.weight})`).join(', ')}`);

  const candidates = retrieveCandidates(sim.profile, SPEED_SOUND_TRACKS);
  console.log(`1. Retrieved candidates count: ${candidates.length}`);

  const ranked = rankCandidates(sim.profile, candidates);
  console.log('2. Top 5 Ranked Candidates Breakdown:');
  ranked.slice(0, 5).forEach((r, idx) => {
    const b = r.breakdown;
    console.log(`   #${idx + 1} [Score: ${r.score.toFixed(1)}] ${r.track.artist} - "${r.track.title}" (${r.track.bpm} BPM, E:${r.track.energy}, ${r.track.genres.slice(0, 2).join('/')})`);
    console.log(`      Breakdown: Genre=${b.genre}, Sub=${b.subgenre}, BPM=${b.bpm}, Energy=${b.energy}, Mood=${b.mood}, Timbre=${b.timbre}, Avoid=${b.avoidPenalty}`);
  });

  const selected = selectTopCandidates(ranked, 10, 2);
  console.log(`3. Final Selected Tracks (Top 10, max 2 per artist):`);
  const artistFreq = new Map<string, number>();
  selected.forEach((t, idx) => {
    artistFreq.set(t.artist, (artistFreq.get(t.artist) || 0) + 1);
    const item = ranked.find((r) => r.track.id === t.id);
    console.log(`   ${idx + 1}. [${item?.score.toFixed(1) || '?'}] ${t.artist} - ${t.title} (${t.bpm} BPM, E:${t.energy}, ${t.genres.join(', ')})`);
  });

  const artistStats = Array.from(artistFreq.entries()).map(([a, c]) => `${a}: ${c}`).join(', ');
  console.log(`   Artist Distribution: ${artistStats}`);
}

console.log('\n==============================================');
if (allPassed) {
  console.log('ALL 8 QA TESTS PASSED SUCCESSFULLY!');
} else {
  console.error('SOME QA TESTS FAILED! CHECK OUTPUT ABOVE.');
  process.exit(1);
}
console.log('==============================================');
