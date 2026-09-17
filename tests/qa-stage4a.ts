import { getLastFmMetadata, enrichWithLastFm } from '../src/services/lastfm';
import { Track } from '../src/types';
import nock from 'nock';

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
console.log('STAGE 4A QA TESTS');
console.log('==============================================');

async function runTests() {
  const originalApiKey = process.env.LASTFM_API_KEY;

  // Test 32 — API disabled
  console.log('Test 32 — API disabled');
  {
    delete process.env.LASTFM_API_KEY;
    const result = await getLastFmMetadata('Artist', 'Title');
    assert('metadata === null when API key is missing', result === null);
  }

  process.env.LASTFM_API_KEY = 'test_key';
  
  nock.disableNetConnect();

  // Test 33 — Cache
  console.log('Test 33 — Cache');
  {
    nock('https://ws.audioscrobbler.com')
      .get('/2.0/')
      .query(q => q.method === 'artist.getsimilar')
      .reply(200, { similarartists: { artist: [] } })
      .get('/2.0/')
      .query(q => q.method === 'track.getsimilar')
      .reply(200, { similartracks: { track: [] } })
      .get('/2.0/')
      .query(q => q.method === 'track.gettoptags')
      .reply(200, { toptags: { tag: [] } });

    await getLastFmMetadata('CacheArtist', 'CacheTitle');
    
    // Nock will throw if another request is made because we didn't specify multiple intercepts
    let crashed = false;
    try {
      await getLastFmMetadata('CacheArtist', 'CacheTitle'); // should hit cache
    } catch (e) {
      crashed = true;
    }
    assert('Second call uses cache (no error thrown)', !crashed);
  }

  // Test 34 — Normalization & Test 35 — Duplicate tags & Test 36 — Similar track normalization
  console.log('Test 34, 35, 36 — Normalization');
  {
    nock('https://ws.audioscrobbler.com')
      .get('/2.0/')
      .query(q => q.method === 'artist.getsimilar')
      .reply(200, {
        similarartists: {
          artist: [
            { name: 'Similar Artist 1', match: "0.8523" },
            { name: 'Similar Artist 2', match: "1.5" }, // out of bounds
            { name: 'Similar Artist 3', match: "-0.5" }  // out of bounds
          ]
        }
      })
      .get('/2.0/')
      .query(q => q.method === 'track.getsimilar')
      .reply(200, {
        similartracks: {
          track: [
            { name: 'SimTrack1', artist: { name: 'SimArtist1' }, match: "0.9" }
          ]
        }
      })
      .get('/2.0/')
      .query(q => q.method === 'track.gettoptags')
      .reply(200, {
        toptags: {
          tag: [
            { name: ' Electronic ' },
            { name: 'electronic' },
            { name: 'ELECTRONIC' },
            { name: 'techno' }
          ]
        }
      });

    const result = await getLastFmMetadata('NormArtist', 'NormTitle');
    assert('Result is not null', result !== null);
    if (result) {
      assert('Tags are normalized and deduplicated', result.tags.length === 2 && result.tags.includes('electronic') && result.tags.includes('techno'));
      assert('Similar track match is normalized', result.similarTracks[0].match === 0.9);
      assert('Similar artist match handles out of bounds', result.similarArtists[1].match === 1 && result.similarArtists[2].match === 0);
    }
  }

  // Test 37 — API failure
  console.log('Test 37 — API failure');
  {
    nock('https://ws.audioscrobbler.com')
      .get('/2.0/')
      .query(true)
      .reply(500)
      .persist();

    const result = await getLastFmMetadata('FailArtist', 'FailTitle');
    assert('metadata === null on 500 error', result === null);
    nock.cleanAll();
  }

  // Test 38 — Timeout
  console.log('Test 38 — Timeout');
  {
    nock('https://ws.audioscrobbler.com')
      .get('/2.0/')
      .query(true)
      .delay(2500)
      .reply(200)
      .persist();

    const result = await getLastFmMetadata('TimeoutArtist', 'TimeoutTitle');
    assert('metadata === null on timeout', result === null);
    nock.cleanAll();
  }

  // Test 39 — Invalid JSON
  console.log('Test 39 — Invalid JSON');
  {
    nock('https://ws.audioscrobbler.com')
      .get('/2.0/')
      .query(true)
      .reply(200, 'this is not json')
      .persist();

    const result = await getLastFmMetadata('InvalidArtist', 'InvalidTitle');
    assert('metadata === null on invalid json', result === null);
    nock.cleanAll();
  }

  // Test 43 — No Track mutation
  console.log('Test 43 — No Track mutation');
  {
    nock('https://ws.audioscrobbler.com')
      .get('/2.0/')
      .query(true)
      .reply(200, { toptags: { tag: [{ name: 'test' }] } })
      .persist();

    const track = createMockTrack({ id: 'MutTrack', artist: 'MutArtist', title: 'MutTitle' });
    const originalJson = JSON.stringify(track);
    
    const enriched = await enrichWithLastFm([track]);
    
    const withoutLastFm = { ...enriched[0] };
    delete withoutLastFm.lastfm;
    
    assert('Original properties are not mutated', JSON.stringify(withoutLastFm) === originalJson);
    assert('Last.fm metadata was added as optional field', enriched[0].lastfm?.tags.includes('test') || false);
    
    nock.cleanAll();
  }

  nock.enableNetConnect();
  
  if (originalApiKey) {
    process.env.LASTFM_API_KEY = originalApiKey;
    console.log('\n==============================================');
    console.log('REAL LAST.FM API SMOKE TEST');
    console.log('==============================================');
    
    const tracks = [
      createMockTrack({ artist: 'Burial', title: 'Archangel' }),
      createMockTrack({ artist: 'Bicep', title: 'Glue' })
    ];
    
    const start = performance.now();
    const enriched = await enrichWithLastFm(tracks);
    const end = performance.now();
    
    enriched.forEach(t => {
      console.log(`\nTrack: ${t.artist} - ${t.title}`);
      if (t.lastfm) {
        console.log(`  Tags: ${t.lastfm.tags.join(', ')}`);
        console.log(`  Top Similar Track: ${t.lastfm.similarTracks[0]?.artist} - ${t.lastfm.similarTracks[0]?.title} (${t.lastfm.similarTracks[0]?.match.toFixed(2)})`);
        console.log(`  Top Similar Artist: ${t.lastfm.similarArtists[0]?.name} (${t.lastfm.similarArtists[0]?.match.toFixed(2)})`);
      } else {
        console.log(`  Last.fm metadata missing.`);
      }
    });
    console.log(`\nReal smoke test completed in ${(end - start).toFixed(2)}ms`);
    
  } else {
    console.log('\n==============================================');
    console.log('Real Last.fm API smoke test skipped: LASTFM_API_KEY not configured.');
    console.log('==============================================');
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

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
