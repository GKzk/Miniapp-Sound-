process.env.NODE_ENV = 'test';

import type { Track, TrackSource, MusicProvider, PlaybackType, MusicProfile } from '../src/types';
import {
  getPlayableSource,
  resolveTrackSources,
  enrichTrackWithSources,
  validateTrackSource,
  deduplicateSources,
  MusicProviderAdapter,
  ITunesProviderAdapter,
} from '../src/services/musicProviders';
import {
  retrieveCandidates,
  rankCandidates,
  optimizePlaylistOrder,
} from '../server';
import { SPEED_SOUND_TRACKS } from '../src/data/tracks';

function createMockTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: overrides.id || `mock_${Math.random().toString(36).substring(7)}`,
    artist: overrides.artist || 'Overmono',
    title: overrides.title || 'So U Kno',
    bpm: overrides.bpm ?? 134,
    energy: overrides.energy ?? 8,
    genres: overrides.genres || ['UK Garage', 'Electronic'],
    moods: overrides.moods || ['night', 'drive'],
    vibeTags: overrides.vibeTags || ['#NightDrive', '#Garage'],
    coverColor: '#1a2238',
    previewNote: 'Test preview note',
    synthPreset: 'uk_garage',
    links: overrides.links || {
      spotify: 'https://open.spotify.com/search/mock',
      yandex: 'https://music.yandex.ru/search?text=mock',
      apple: 'https://music.apple.com/us/search?term=mock',
    },
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
console.log('STAGE 4B QA TESTS — Track Source & Provider Architecture');
console.log('==============================================');

async function runTests() {
  // -------------------------------------------------------------
  // Test 44 — TrackSource type
  // -------------------------------------------------------------
  console.log('\nTest 44 — TrackSource type');
  {
    const source: TrackSource = {
      provider: 'itunes',
      playback: 'preview',
      providerTrackId: '1440857781',
      url: 'https://audio-ssl.itunes.apple.com/itunes-assets/test.m4a',
      available: true,
    };

    assert('TrackSource has valid provider', source.provider === 'itunes');
    assert('TrackSource has valid playback', source.playback === 'preview');
    assert('TrackSource has providerTrackId', source.providerTrackId === '1440857781');
    assert('TrackSource has stream url', typeof source.url === 'string');
    assert('TrackSource availability flag is boolean', source.available === true);
    assert('validateTrackSource accepts valid source', validateTrackSource(source));
  }

  // -------------------------------------------------------------
  // Test 45 — iTunes source
  // -------------------------------------------------------------
  console.log('\nTest 45 — iTunes source');
  {
    const mockItunesAdapter: MusicProviderAdapter = {
      provider: 'itunes',
      async searchTrack(artist: any, title: any) {
        return {
          provider: 'itunes',
          playback: 'preview',
          providerTrackId: 'itunes_999',
          url: `https://itunes.preview/${encodeURIComponent(String(artist))}-${encodeURIComponent(String(title))}.m4a`,
          available: true,
        };
      },
    };

    const track = createMockTrack({ artist: 'Bicep', title: 'Glue' });
    const sources = await resolveTrackSources(track, [mockItunesAdapter]);

    const itunesSource = sources.find((s) => s.provider === 'itunes');
    assert('iTunes source is resolved', Boolean(itunesSource));
    assert('iTunes source has playback type "preview"', itunesSource?.playback === 'preview');
    assert('iTunes source providerTrackId is populated', itunesSource?.providerTrackId === 'itunes_999');
    assert('iTunes source contains stream url', itunesSource?.url?.includes('Bicep') === true);
    assert('iTunes source is marked available', itunesSource?.available === true);
  }

  // -------------------------------------------------------------
  // Test 46 — Full source priority
  // -------------------------------------------------------------
  console.log('\nTest 46 — Full source priority');
  {
    const trackWithBoth: Track = createMockTrack({
      sources: [
        {
          provider: 'itunes',
          playback: 'preview',
          url: 'https://itunes.apple.com/preview.m4a',
          available: true,
        },
        {
          provider: 'spotify',
          playback: 'full',
          url: 'https://api.spotify.com/v1/tracks/full_stream',
          available: true,
        },
      ],
    });

    const chosen = getPlayableSource(trackWithBoth);
    assert('getPlayableSource selects full playback over preview', chosen?.playback === 'full');
    assert('chosen provider is spotify', chosen?.provider === 'spotify');
    assert('chosen source has valid stream url', chosen?.url === 'https://api.spotify.com/v1/tracks/full_stream');
  }

  // -------------------------------------------------------------
  // Test 47 — Preview fallback
  // -------------------------------------------------------------
  console.log('\nTest 47 — Preview fallback');
  {
    const trackWithPreviewOnly: Track = createMockTrack({
      sources: [
        {
          provider: 'itunes',
          playback: 'preview',
          url: 'https://itunes.apple.com/preview.m4a',
          available: true,
        },
      ],
    });

    const chosen = getPlayableSource(trackWithPreviewOnly);
    assert('getPlayableSource selects preview when full is absent', chosen?.playback === 'preview');
    assert('chosen provider is itunes', chosen?.provider === 'itunes');
    assert('chosen url matches preview', chosen?.url === 'https://itunes.apple.com/preview.m4a');
  }

  // -------------------------------------------------------------
  // Test 48 — No source
  // -------------------------------------------------------------
  console.log('\nTest 48 — No source');
  {
    const trackNoSources = createMockTrack({ sources: [] });
    const trackUndefinedSources = createMockTrack({ sources: undefined });
    const trackExternalOnly = createMockTrack({
      sources: [
        {
          provider: 'spotify',
          playback: 'external',
          url: 'https://open.spotify.com/track/123',
          available: true,
        },
      ],
    });
    const trackUnavailableOnly = createMockTrack({
      sources: [
        {
          provider: 'itunes',
          playback: 'preview',
          url: 'https://audio.com/preview.m4a',
          available: false,
        },
      ],
    });

    assert('Empty sources array returns null', getPlayableSource(trackNoSources) === null);
    assert('Undefined sources returns null', getPlayableSource(trackUndefinedSources) === null);
    assert('External-only source returns null (not auto-playable)', getPlayableSource(trackExternalOnly) === null);
    assert('Unavailable source returns null', getPlayableSource(trackUnavailableOnly) === null);
  }

  // -------------------------------------------------------------
  // Test 49 — Provider failure
  // -------------------------------------------------------------
  console.log('\nTest 49 — Provider failure');
  {
    const failingAdapter: MusicProviderAdapter = {
      provider: 'spotify',
      async searchTrack() {
        throw new Error('Spotify API 503 Outage Simulation');
      },
    };

    const healthyAdapter: MusicProviderAdapter = {
      provider: 'itunes',
      async searchTrack() {
        return {
          provider: 'itunes',
          playback: 'preview',
          url: 'https://itunes.apple.com/fallback.m4a',
          available: true,
        };
      },
    };

    const track = createMockTrack({ artist: 'Burial', title: 'Archangel' });
    let resolved: TrackSource[] = [];
    let didCrash = false;

    try {
      resolved = await resolveTrackSources(track, [failingAdapter, healthyAdapter]);
    } catch {
      didCrash = true;
    }

    assert('Provider failure does not throw or crash resolution', !didCrash);
    assert('Healthy provider still yields its source', resolved.some((s) => s.provider === 'itunes'));
    assert('Failing provider is gracefully skipped', !resolved.some((s) => s.provider === 'spotify'));
    assert('Track object remains fully intact', track.artist === 'Burial' && track.title === 'Archangel');
  }

  // -------------------------------------------------------------
  // Test 50 — Metadata integrity
  // -------------------------------------------------------------
  console.log('\nTest 50 — Metadata integrity');
  {
    const originalTrack = createMockTrack({
      id: 'trk_meta_test',
      artist: 'Floating Points',
      title: 'LesAlpx',
      bpm: 128,
      energy: 8,
      genres: ['Microhouse', 'Techno'],
      moods: ['drive', 'night'],
      vibeTags: ['#LateNight', '#Techno'],
      coverColor: '#101018',
    });

    const enriched = await enrichTrackWithSources(originalTrack, [
      {
        provider: 'itunes',
        async searchTrack() {
          return {
            provider: 'itunes',
            playback: 'preview',
            url: 'https://preview.m4a',
            available: true,
          };
        },
      },
    ]);

    assert('ID is unchanged', enriched.id === originalTrack.id);
    assert('Artist is unchanged', enriched.artist === originalTrack.artist);
    assert('Title is unchanged', enriched.title === originalTrack.title);
    assert('BPM is unchanged', enriched.bpm === originalTrack.bpm);
    assert('Energy is unchanged', enriched.energy === originalTrack.energy);
    assert('Genres are unchanged', JSON.stringify(enriched.genres) === JSON.stringify(originalTrack.genres));
    assert('Moods are unchanged', JSON.stringify(enriched.moods) === JSON.stringify(originalTrack.moods));
    assert('VibeTags are unchanged', JSON.stringify(enriched.vibeTags) === JSON.stringify(originalTrack.vibeTags));
    assert('CoverColor is unchanged', enriched.coverColor === originalTrack.coverColor);
    assert('Sources were successfully attached', Array.isArray(enriched.sources) && enriched.sources.length === 1);
  }

  // -------------------------------------------------------------
  // Test 51 — Last.fm independence
  // -------------------------------------------------------------
  console.log('\nTest 51 — Last.fm independence');
  {
    const lastfmData = {
      tags: ['electronic', 'garage', 'uk'],
      similarTracks: [{ artist: 'Joy Orbison', title: 'Hyph Mngo', match: 0.95 }],
      similarArtists: [{ name: 'Bicep', match: 0.88 }],
    };

    const trackWithLastFm = createMockTrack({
      artist: 'Four Tet',
      title: 'Baby',
      lastfm: lastfmData,
    });

    const enriched = await enrichTrackWithSources(trackWithLastFm, [
      {
        provider: 'itunes',
        async searchTrack() {
          return {
            provider: 'itunes',
            playback: 'preview',
            url: 'https://itunes.com/fourtet.m4a',
            available: true,
          };
        },
      },
    ]);

    assert('track.lastfm is preserved identically', JSON.stringify(enriched.lastfm) === JSON.stringify(lastfmData));

    // Also verify resolution works seamlessly when track.lastfm is undefined
    const trackWithoutLastFm = createMockTrack({ lastfm: undefined });
    const enrichedNoLastFm = await enrichTrackWithSources(trackWithoutLastFm, []);
    assert('Resolution succeeds without lastfm metadata', enrichedNoLastFm.lastfm === undefined);
  }

  // -------------------------------------------------------------
  // Test 52 — Recommendation independence
  // -------------------------------------------------------------
  console.log('\nTest 52 — Recommendation independence');
  {
    const mockProfile: MusicProfile = {
      current_state: { mood: ['night', 'drive'], energy: 75, emotional_intensity: 70 },
      desired_state: { mood: ['club', 'electronic'], energy: 80, emotional_intensity: 75 },
      visual_context: {
        scene: ['city streets'],
        time_of_day: 'night',
        atmosphere: ['urban neon'],
        dominant_colors: ['#0f172a'],
        cinematic: 80,
        darkness: 70,
        warmth: 40,
        visual_energy: 75,
      },
      music_profile: {
        energy: 80,
        danceability: 75,
        darkness: 60,
        warmth: 50,
        melodicness: 65,
        atmospheric: 70,
        aggression: 40,
        experimental: 50,
        rhythm_density: 75,
      },
      tempo: { min: 125, max: 140, target: 134 },
      genres: [
        { name: 'UK Garage', weight: 80 },
        { name: 'Electronic', weight: 70 },
      ],
      subgenres: [],
      artist_styles: [],
      avoid: [],
      discovery: 0,
      strategy_concept: 'Night club drive',
      strategy_emotional_arc: ['Rising energy to peak club vibe'],
      vibe_verdict: 'Peak night drive',
    };

    // Candidates without any provider sources attached
    const catalogRaw = SPEED_SOUND_TRACKS.map((t) => ({ ...t, sources: undefined }));

    const retrieved = retrieveCandidates(mockProfile, catalogRaw);
    assert('Stage 2 retrieval works without provider sources', retrieved.length > 0);

    const ranked = rankCandidates(mockProfile, retrieved);
    assert('Stage 2 ranking works without provider sources', ranked.length > 0);
    assert('Ranked candidates have valid numeric scores', typeof ranked[0].score === 'number');

    const topTracks = ranked.slice(0, 10).map((r) => r.track);
    const optimized = optimizePlaylistOrder(topTracks, mockProfile);
    assert('Stage 3B optimizer functions without provider sources', optimized.length === topTracks.length);
    assert('Sequencing produces valid tracks', Boolean(optimized[0].artist && optimized[0].title));
  }

  // -------------------------------------------------------------
  // Test 53 — Legacy compatibility
  // -------------------------------------------------------------
  console.log('\nTest 53 — Legacy compatibility');
  {
    const sampleTrack = SPEED_SOUND_TRACKS[0];
    assert('SPEED_SOUND_TRACKS[0] has links object', Boolean(sampleTrack.links));
    assert('spotify link exists in legacy links', typeof sampleTrack.links.spotify === 'string');
    assert('yandex link exists in legacy links', typeof sampleTrack.links.yandex === 'string');
    assert('apple link exists in legacy links', typeof sampleTrack.links.apple === 'string');

    // A track with legacy links can still resolve playable source if audioUrl exists
    const legacyTrack: Track = {
      ...sampleTrack,
      sources: undefined,
      audioUrl: 'https://legacy-preview.apple.com/song.m4a',
    };

    // Before resolving sources, getPlayableSource returns null (sources is undefined)
    assert('getPlayableSource(legacyTrack) returns null when sources is undefined', getPlayableSource(legacyTrack) === null);

    // Resolving sources automatically bridges audioUrl to itunes preview source
    const resolved = await resolveTrackSources(legacyTrack, []);
    assert('resolveTrackSources creates itunes preview source from legacy audioUrl', resolved.length === 1);
    assert('bridged source provider is itunes', resolved[0].provider === 'itunes');
    assert('bridged source playback is preview', resolved[0].playback === 'preview');
    assert('bridged source url matches legacy audioUrl', resolved[0].url === legacyTrack.audioUrl);
  }

  // -------------------------------------------------------------
  // Test 54 — No fake full playback
  // -------------------------------------------------------------
  console.log('\nTest 54 — No fake full playback');
  {
    const fakeFullSource: TrackSource = {
      provider: 'itunes',
      playback: 'full' as PlaybackType,
      url: 'https://itunes.apple.com/preview-pretending-to-be-full.m4a',
      available: true,
    };

    // 1. Validation explicitly disallows fake full itunes source
    const isValid = validateTrackSource(fakeFullSource);
    assert('validateTrackSource rejects fake full itunes playback', isValid === false);

    // 2. getPlayableSource refuses to select fake full itunes source
    const trackWithFakeFull = createMockTrack({
      sources: [fakeFullSource],
    });
    const chosen = getPlayableSource(trackWithFakeFull);
    assert('getPlayableSource rejects fake full itunes source', chosen === null);

    // 3. ITunesProviderAdapter strictly specifies 'preview'
    const adapter = new ITunesProviderAdapter();
    assert('iTunes provider adapter is declared as "itunes"', adapter.provider === 'itunes');
  }

  // -------------------------------------------------------------
  // Test 55 — Source deduplication
  // -------------------------------------------------------------
  console.log('\nTest 55 — Source deduplication');
  {
    const duplicateSources: TrackSource[] = [
      {
        provider: 'itunes',
        playback: 'preview',
        url: 'https://preview.apple.com/track1.m4a',
        available: true,
      },
      {
        provider: 'itunes',
        playback: 'preview',
        url: 'https://preview.apple.com/track1-duplicate.m4a',
        available: true,
      },
      {
        provider: 'spotify',
        playback: 'full',
        url: 'https://spotify.com/full1',
        available: true,
      },
      {
        provider: 'spotify',
        playback: 'full',
        url: 'https://spotify.com/full1-dup',
        available: true,
      },
    ];

    const deduplicated = deduplicateSources(duplicateSources);
    assert('Deduplication reduces 4 sources to 2 unique providers/playback', deduplicated.length === 2);
    assert('Contains exactly one itunes source', deduplicated.filter((s) => s.provider === 'itunes').length === 1);
    assert('Contains exactly one spotify source', deduplicated.filter((s) => s.provider === 'spotify').length === 1);

    // Verify resolveTrackSources also enforces deduplication when merging existing and new sources
    const trackWithExisting = createMockTrack({
      sources: [
        {
          provider: 'itunes',
          playback: 'preview',
          url: 'https://preview.apple.com/original.m4a',
          available: true,
        },
      ],
    });

    const mockAdapterReturningDup: MusicProviderAdapter = {
      provider: 'itunes',
      async searchTrack() {
        return {
          provider: 'itunes',
          playback: 'preview',
          url: 'https://preview.apple.com/new.m4a',
          available: true,
        };
      },
    };

    const merged = await resolveTrackSources(trackWithExisting, [mockAdapterReturningDup]);
    assert('resolveTrackSources does not produce duplicate provider/source', merged.length === 1);
  }

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  if (failed) {
    console.log('\n==============================================');
    console.log('SOME STAGE 4B QA TESTS FAILED! CHECK OUTPUT ABOVE.');
    console.log('==============================================');
    process.exit(1);
  } else {
    console.log('\n==============================================');
    console.log('ALL 12 STAGE 4B QA TESTS PASSED SUCCESSFULLY!');
    console.log('==============================================');
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
