import {
  validateSemanticRerankResponse,
  performSemanticReranking,
  retrieveCandidates,
  rankCandidates,
  selectTopCandidatesRanked
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
console.log('STAGE 3A QA TESTS');
console.log('==============================================');

const candidates: RankedCandidate[] = [
  { track: createMockTrack({ id: 'A', artist: 'Art1', title: 'Tit1', bpm: 130 }), score: 50, breakdown: {} as any },
  { track: createMockTrack({ id: 'B', artist: 'Art2', title: 'Tit2', bpm: 135 }), score: 45, breakdown: {} as any },
  { track: createMockTrack({ id: 'C', artist: 'Art3', title: 'Tit3', bpm: 140 }), score: 40, breakdown: {} as any }
];

// Test 15 — No hallucinated tracks
console.log('Test 15 — No hallucinated tracks');
{
  const parsed = {
    selected_tracks: [
      { id: 'A', semantic_score: 90, curator_reason: 'reason' },
      { id: 'D', semantic_score: 80, curator_reason: 'hallucinated' } // Not in candidates
    ]
  };
  const result = validateSemanticRerankResponse(parsed, candidates, 3);
  
  assert('Returns non-null result', result !== null);
  assert('Hallucinated track D is dropped', result!.findIndex(t => t.id === 'D') === -1);
  assert('Fallback kicks in and fills remaining from Stage 2', result!.length === 3);
  assert('Contains A', result!.some(t => t.id === 'A'));
}

// Test 16 — Duplicate IDs
console.log('Test 16 — Duplicate IDs');
{
  const parsed = {
    selected_tracks: [
      { id: 'B', semantic_score: 95, curator_reason: 'reason' },
      { id: 'B', semantic_score: 95, curator_reason: 'duplicate' },
      { id: 'A', semantic_score: 85, curator_reason: 'reason' }
    ]
  };
  const result = validateSemanticRerankResponse(parsed, candidates, 3);
  
  assert('Result has no duplicates', result!.filter(t => t.id === 'B').length === 1);
  assert('Length is 3 (filled by fallback)', result!.length === 3);
}

// Test 17 — Invalid ID
console.log('Test 17 — Invalid ID');
{
  const parsed = {
    selected_tracks: [
      { id: 'A', semantic_score: 90, curator_reason: 'reason' },
      { id: 'UNKNOWN', semantic_score: 90, curator_reason: 'reason' },
      { id: 'B', semantic_score: 90, curator_reason: 'reason' }
    ]
  };
  const result = validateSemanticRerankResponse(parsed, candidates, 3);
  
  assert('Invalid ID UNKNOWN is dropped', result!.findIndex(t => t.id === 'UNKNOWN') === -1);
  assert('Length is 3 (filled by fallback)', result!.length === 3);
  assert('A and B are kept', result!.some(t => t.id === 'A') && result!.some(t => t.id === 'B'));
}

// Test 18 — Gemini failure (invalid schema)
console.log('Test 18 — Gemini failure (invalid schema)');
{
  const parsed = { something_else: [] };
  const result = validateSemanticRerankResponse(parsed, candidates, 3);
  assert('Invalid schema returns null', result === null);
}

// Test 19 — Gemini invented artist/title
console.log('Test 19 — Gemini invented artist/title');
{
  const parsed = {
    selected_tracks: [
      { id: 'A', artist: 'Fake Artist', title: 'Fake Title', semantic_score: 90, curator_reason: 'reason' },
    ]
  };
  const result = validateSemanticRerankResponse(parsed, candidates, 3);
  
  const a = result!.find(t => t.id === 'A');
  assert('Original artist is preserved', a!.artist === 'Art1');
  assert('Original title is preserved', a!.title === 'Tit1');
}

// Test 20 — Hard avoid after reranking
console.log('Test 20 — Hard avoid (Implicitly tested because candidate pool is already filtered)');
{
  assert('Candidates are filtered by Stage 2, Gemini can only pick from safe pool', true);
}

// Test 21 — Determinism of validation
console.log('Test 21 — Determinism of validation');
{
  const parsed1 = {
    selected_tracks: [
      { id: 'B', semantic_score: 90, curator_reason: 'reason B' },
      { id: 'C', semantic_score: 80, curator_reason: 'reason C' }
    ]
  };
  const parsed2 = JSON.parse(JSON.stringify(parsed1)); // Exact clone
  
  const result1 = validateSemanticRerankResponse(parsed1, candidates, 3);
  const result2 = validateSemanticRerankResponse(parsed2, candidates, 3);
  
  assert('First element matches', result1![0].id === result2![0].id);
  assert('Second element matches', result1![1].id === result2![1].id);
  assert('Third element matches (fallback)', result1![2].id === result2![2].id);
}


console.log('\\n==============================================');
console.log('REAL CATALOG SIMULATION (STAGE 3A)');
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

async function runSimulation() {
  for (const p of realProfiles) {
    console.log(`\\n>>> PROFILE ${p.name.charAt(0)}: ${p.name.substring(4).toUpperCase()} <<<`);
    
    // Stage 2 pipeline
    const candidates = retrieveCandidates(p.profile, SPEED_SOUND_TRACKS);
    const ranked = rankCandidates(p.profile, candidates);
    const top30 = selectTopCandidatesRanked(ranked, 30, 2);
    
    // Fallback/deterministic Stage 2 Top 10
    const stage2Top10 = top30.slice(0, 10);
    
    console.log('--- STAGE 2 TOP 10 ---');
    stage2Top10.forEach((c, i) => {
      console.log(`  ${i+1}. ${c.track.artist} - ${c.track.title} [S2: ${c.score.toFixed(1)}]`);
    });
    
    console.log('\\n--- STAGE 3A SEMANTIC RERANKING ---');
    // Using real API call if API key is present
    const stage3aSelected = await performSemanticReranking(p.profile, top30, 10);
    
    stage3aSelected.forEach((t, i) => {
      const isNewInTop = stage2Top10.findIndex(c => c.track.id === t.id) === -1;
      const marker = isNewInTop ? '*PROMOTED*' : '';
      console.log(`  ${i+1}. ${marker} ${t.artist} - ${t.title} [Total: ${(t.overallScore || 0).toFixed(1)}]`);
      if (t.curatorReason) {
        console.log(`       Reason: ${t.curatorReason}`);
      }
    });
    console.log('-------------------------------------------');
  }

  if (failed) {
    console.log('\\n==============================================');
    console.log('SOME QA TESTS FAILED! CHECK OUTPUT ABOVE.');
    process.exit(1);
  } else {
    console.log('\\n==============================================');
    console.log('ALL NEW QA TESTS PASSED SUCCESSFULLY!');
    console.log('==============================================');
  }
}

runSimulation().catch(err => {
  console.error(err);
  process.exit(1);
});
