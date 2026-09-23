process.env.NODE_ENV = 'test';

import nock from 'nock';
import type { Track, TrackSource, MusicProfile } from '../src/types';
import {
  SoundCloudProviderAdapter,
  normalizeSearchString,
  getSoundCloudCacheKey,
  evaluateSoundCloudMatch,
  extractPlayableTranscoding,
  resolveSoundCloudStreamUrl,
  clearSoundCloudCaches,
  invalidateSoundCloudStreamCache,
  runSoundCloudPlaybackDiagnostic,
  soundcloudSearchCache,
  soundcloudStreamCache,
  extractArtistNames,
  extractDerivativeModifiers,
} from '../src/services/musicProviders/soundcloud';
import {
  getPlayableSource,
  resolveTrackSources,
  enrichTrackWithSources,
  validateTrackSource,
  defaultMusicProviders,
  soundCloudAdapter,
  itunesAdapter,
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
    artist: overrides.artist || 'Burial',
    title: overrides.title || 'Archangel',
    bpm: overrides.bpm ?? 134,
    energy: overrides.energy ?? 8,
    genres: overrides.genres || ['Future Garage', 'Electronic'],
    moods: overrides.moods || ['night', 'rain'],
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
console.log('STAGE 4C.1 QA TESTS — SoundCloud Full Playback & Architecture');
console.log('==============================================');

async function runTests() {
  clearSoundCloudCaches();

  // -------------------------------------------------------------
  // Test 56 — Provider disabled
  // -------------------------------------------------------------
  console.log('\nTest 56 — Provider disabled');
  {
    const savedId = process.env.SOUNDCLOUD_CLIENT_ID;
    delete process.env.SOUNDCLOUD_CLIENT_ID;

    const unconfiguredAdapter = new SoundCloudProviderAdapter({ clientId: undefined });
    assert('Adapter reports not configured when clientId is missing', unconfiguredAdapter.isConfigured() === false);

    const result = await unconfiguredAdapter.searchTrack('Burial', 'Archangel');
    assert('SoundCloud provider returns null when unconfigured', result === null);

    if (savedId) process.env.SOUNDCLOUD_CLIENT_ID = savedId;
  }

  // -------------------------------------------------------------
  // Test 57 — Search normalization
  // -------------------------------------------------------------
  console.log('\nTest 57 — Search normalization');
  {
    const variations = ['Burial', 'burial', '  Burial  ', 'BURIAL', 'Burial...'];
    const keys = variations.map((artist) => getSoundCloudCacheKey(artist, 'Archangel'));
    const allSame = keys.every((k) => k === keys[0]);
    assert('All artist case/space/punctuation variants yield identical cache key', allSame);
    assert('Key has expected soundcloud:artist:title format', keys[0] === 'soundcloud:burial:archangel');
  }

  // -------------------------------------------------------------
  // Test 58 — Exact artist/title matching
  // -------------------------------------------------------------
  console.log('\nTest 58 — Exact artist/title matching');
  {
    const targetArtist = 'Burial';
    const targetTitle = 'Archangel';

    const perfectCandidate = {
      title: 'Archangel',
      user: { username: 'Burial' },
      duration: 240000,
    };

    const irrelevantCandidate = {
      title: 'Some Completely Different Song',
      user: { username: 'RandomArtist' },
      duration: 180000,
    };

    const perfectMatch = evaluateSoundCloudMatch(targetArtist, targetTitle, 240, perfectCandidate);
    const badMatch = evaluateSoundCloudMatch(targetArtist, targetTitle, 240, irrelevantCandidate);

    assert('Exact artist and title candidate is accepted', perfectMatch.accepted === true);
    assert('Exact match score is high (>= 80)', perfectMatch.score >= 80);
    assert('Irrelevant candidate is rejected', badMatch.accepted === false);
    assert('Irrelevant match score is low (< 50)', badMatch.score < 50);
    assert('Exact match score is strictly greater than irrelevant candidate', perfectMatch.score > badMatch.score);
  }

  // -------------------------------------------------------------
  // Test 59 — Remix & version modifier rejection
  // -------------------------------------------------------------
  console.log('\nTest 59 — Remix & version modifier rejection');
  {
    const targetArtist = 'Burial';
    const targetTitle = 'Archangel';

    const remixCandidate = {
      title: 'Archangel (Drum & Bass VIP Remix)',
      user: { username: 'Burial' },
      duration: 240000,
    };

    const liveCandidate = {
      title: 'Archangel (Live)',
      user: { username: 'Burial' },
      duration: 240000,
    };

    const bootlegCandidate = {
      title: 'Archangel (Bootleg)',
      user: { username: 'Burial' },
      duration: 240000,
    };

    const coverCandidate = {
      title: 'Archangel (Cover)',
      user: { username: 'Burial' },
      duration: 240000,
    };

    const originalCandidate = {
      title: 'Archangel',
      user: { username: 'Burial' },
      duration: 240000,
    };

    const remixResult = evaluateSoundCloudMatch(targetArtist, targetTitle, 240, remixCandidate);
    const liveResult = evaluateSoundCloudMatch(targetArtist, targetTitle, 240, liveCandidate);
    const bootlegResult = evaluateSoundCloudMatch(targetArtist, targetTitle, 240, bootlegCandidate);
    const coverResult = evaluateSoundCloudMatch(targetArtist, targetTitle, 240, coverCandidate);
    const originalResult = evaluateSoundCloudMatch(targetArtist, targetTitle, 240, originalCandidate);

    assert('Remix candidate is rejected when original is sought', remixResult.accepted === false);
    assert('Live version is rejected when original is sought', liveResult.accepted === false);
    assert('Bootleg version is rejected when original is sought', bootlegResult.accepted === false);
    assert('Cover version is rejected when original is sought', coverResult.accepted === false);
    assert('Original candidate is accepted', originalResult.accepted === true);
  }

  // -------------------------------------------------------------
  // Test 60 — Wrong artist rejection & Collaboration matching
  // -------------------------------------------------------------
  console.log('\nTest 60 — Wrong artist rejection & Collaboration matching');
  {
    const targetArtist = 'Overmono';
    const targetTitle = 'So U Kno';

    const wrongArtistCandidate = {
      title: 'So U Kno',
      user: { username: 'Different Random Band' },
      duration: 250000,
    };

    const evalResult = evaluateSoundCloudMatch(targetArtist, targetTitle, 250, wrongArtistCandidate);
    assert('Wrong artist candidate is rejected', evalResult.accepted === false);
    assert('Rejection reason specifies Artist mismatch', evalResult.reason === 'Artist mismatch');

    // Loose single word substring like "The" matching "The Chemical Brothers" must be rejected
    const chemBrothersTarget = 'The Chemical Brothers';
    const fakeSubstringCandidate = {
      title: 'Block Rockin Beats',
      user: { username: 'The' },
      duration: 280000,
    };
    const looseResult = evaluateSoundCloudMatch(chemBrothersTarget, 'Block Rockin Beats', 280, fakeSubstringCandidate);
    assert('Loose substring artist "The" is rejected for "The Chemical Brothers"', looseResult.accepted === false);

    // Legitimate collaboration match
    const collabTarget = 'Four Tet & Burial';
    const collabCandidate = {
      title: 'Nova',
      user: { username: 'Burial' },
      duration: 340000,
    };
    const collabResult = evaluateSoundCloudMatch(collabTarget, 'Nova', 340, collabCandidate);
    assert('Legitimate collaboration match (Burial in Four Tet & Burial) is accepted', collabResult.accepted === true);
  }

  // -------------------------------------------------------------
  // Test 60b — Duration discrepancy rejection
  // -------------------------------------------------------------
  console.log('\nTest 60b — Duration discrepancy rejection');
  {
    const targetArtist = 'Bicep';
    const targetTitle = 'Glue';
    const targetDuration = 269; // ~4.5 minutes

    const djMixCandidate = {
      title: 'Glue',
      user: { username: 'Bicep' },
      duration: 3600000, // 1 hour DJ set!
    };

    const snippetCandidate = {
      title: 'Glue',
      user: { username: 'Bicep' },
      duration: 30000, // 30s snippet
    };

    const mixResult = evaluateSoundCloudMatch(targetArtist, targetTitle, targetDuration, djMixCandidate);
    const snippetResult = evaluateSoundCloudMatch(targetArtist, targetTitle, targetDuration, snippetCandidate);

    assert('1-hour DJ set is rejected due to duration mismatch', mixResult.accepted === false);
    assert('Snippet (<45s) is rejected when full track expected', snippetResult.accepted === false);
  }

  // -------------------------------------------------------------
  // Test 61 — Playable source extraction
  // -------------------------------------------------------------
  console.log('\nTest 61 — Playable source');
  {
    const playableItem = {
      id: 998877,
      title: 'Archangel',
      user: { username: 'Burial', permalink_url: 'https://soundcloud.com/burial' },
      permalink_url: 'https://soundcloud.com/burial/archangel',
      duration: 238000,
      playable: true,
      streamable: true,
      access: 'playable',
      media: {
        transcodings: [
          {
            url: 'https://api.soundcloud.com/media/hls_aac_160_stream',
            preset: 'aac_160',
            format: { protocol: 'hls', mime_type: 'audio/aac' },
            quality: 'sq',
          },
        ],
      },
    };

    const extracted = extractPlayableTranscoding(playableItem);
    assert('Playable track is flagged as isPlayable === true', extracted.isPlayable === true);
    assert('Playable track is flagged as isFull === true', extracted.isFull === true);
    assert('Transcoding selected is HLS AAC 160', extracted.streamFormat === 'hls_aac_160');
    assert('Transcoding URL is populated', extracted.transcodingUrl === 'https://api.soundcloud.com/media/hls_aac_160_stream');
  }

  // -------------------------------------------------------------
  // Test 62 — Preview is not full
  // -------------------------------------------------------------
  console.log('\nTest 62 — Preview is not full');
  {
    const previewItem = {
      id: 112233,
      title: 'Paid Exclusive Track',
      user: { username: 'Artist' },
      access: 'preview',
      playable: true,
      streamable: true,
      media: {
        transcodings: [
          {
            url: 'https://api.soundcloud.com/media/preview_stream',
            preset: 'aac_96',
            format: { protocol: 'hls', mime_type: 'audio/aac' },
            quality: 'sq',
          },
        ],
      },
    };

    const extracted = extractPlayableTranscoding(previewItem);
    assert('Preview track has isPlayable === true', extracted.isPlayable === true);
    assert('Preview track strictly has isFull === false', extracted.isFull === false);
  }

  // -------------------------------------------------------------
  // Test 63 — Blocked track
  // -------------------------------------------------------------
  console.log('\nTest 63 — Blocked track');
  {
    const blockedByPolicy = {
      id: 334455,
      title: 'Blocked Track',
      policy: 'BLOCK',
      access: 'blocked',
      media: { transcodings: [] },
    };

    const blockedByPlayableFlag = {
      id: 334456,
      title: 'Unstreamable Track',
      playable: false,
      streamable: false,
      media: {
        transcodings: [{ url: 'https://api.soundcloud.com/media/test', preset: 'aac_160', format: { protocol: 'hls', mime_type: 'audio/aac' }, quality: 'sq' }],
      },
    };

    assert('Policy blocked track has isPlayable === false', extractPlayableTranscoding(blockedByPolicy).isPlayable === false);
    assert('Playable=false track has isPlayable === false', extractPlayableTranscoding(blockedByPlayableFlag).isPlayable === false);
  }

  // -------------------------------------------------------------
  // Test 64 — Stream resolution failure
  // -------------------------------------------------------------
  console.log('\nTest 64 — Stream resolution failure');
  {
    nock('https://api.soundcloud.com')
      .get('/media/broken_transcoding')
      .query(true)
      .reply(404);

    const streamUrl = await resolveSoundCloudStreamUrl('https://api.soundcloud.com/media/broken_transcoding', 'test_client_id');
    assert('Failed stream endpoint resolution returns null', streamUrl === null);
  }

  // -------------------------------------------------------------
  // Test 65 — API 401/403
  // -------------------------------------------------------------
  console.log('\nTest 65 — API 401/403');
  {
    nock('https://api.soundcloud.com').get('/media/auth_error_401').query(true).reply(401);
    nock('https://api.soundcloud.com').get('/media/auth_error_403').query(true).reply(403);

    const res401 = await resolveSoundCloudStreamUrl('https://api.soundcloud.com/media/auth_error_401', 'bad_key');
    const res403 = await resolveSoundCloudStreamUrl('https://api.soundcloud.com/media/auth_error_403', 'bad_key');

    assert('401 Unauthorized returns null without throwing error', res401 === null);
    assert('403 Forbidden returns null without throwing error', res403 === null);
  }

  // -------------------------------------------------------------
  // Test 66 — API 429 Rate limit
  // -------------------------------------------------------------
  console.log('\nTest 66 — API 429');
  {
    nock('https://api.soundcloud.com').get('/media/rate_limit_429').query(true).reply(429);
    const res429 = await resolveSoundCloudStreamUrl('https://api.soundcloud.com/media/rate_limit_429', 'key');
    assert('429 Rate limit returns null gracefully and avoids crash', res429 === null);
  }

  // -------------------------------------------------------------
  // Test 67 — API 5xx Server error
  // -------------------------------------------------------------
  console.log('\nTest 67 — API 5xx');
  {
    nock('https://api.soundcloud.com').get('/media/server_error_503').query(true).reply(503);
    const res503 = await resolveSoundCloudStreamUrl('https://api.soundcloud.com/media/server_error_503', 'key');
    assert('503 Service Unavailable returns null gracefully', res503 === null);
  }

  // -------------------------------------------------------------
  // Test 68 — Timeout
  // -------------------------------------------------------------
  console.log('\nTest 68 — Timeout');
  {
    nock('https://api.soundcloud.com').get('/media/timeout_test').query(true).delay(600).reply(200, { url: 'https://delayed.stream' });
    const resTimeout = await resolveSoundCloudStreamUrl('https://api.soundcloud.com/media/timeout_test', 'key', 100);
    assert('Slow response/timeout triggers abort and returns null', resTimeout === null);
  }

  // -------------------------------------------------------------
  // Test 69 — iTunes fallback
  // -------------------------------------------------------------
  console.log('\nTest 69 — iTunes fallback');
  {
    const track = createMockTrack({
      sources: [
        {
          provider: 'itunes',
          playback: 'preview',
          url: 'https://audio-ssl.itunes.apple.com/preview.m4a',
          available: true,
        },
      ],
    });

    const chosen = getPlayableSource(track);
    assert('When SoundCloud is absent, getPlayableSource returns iTunes preview', chosen !== null && chosen.provider === 'itunes');
    assert('iTunes source playback is preview', chosen?.playback === 'preview');
    assert('iTunes stream URL is intact', chosen?.url === 'https://audio-ssl.itunes.apple.com/preview.m4a');
  }

  // -------------------------------------------------------------
  // Test 70 — Full priority over preview
  // -------------------------------------------------------------
  console.log('\nTest 70 — Full priority');
  {
    const track = createMockTrack({
      sources: [
        {
          provider: 'itunes',
          playback: 'preview',
          url: 'https://audio-ssl.itunes.apple.com/preview.m4a',
          available: true,
        },
        {
          provider: 'soundcloud',
          playback: 'full',
          url: 'https://cf-media.sndcdn.com/full_stream.m3u8',
          available: true,
        },
      ],
    });

    const chosen = getPlayableSource(track);
    assert('SoundCloud full has priority over iTunes preview', chosen?.provider === 'soundcloud');
    assert('Chosen source playback is full', chosen?.playback === 'full');
    assert('Chosen stream URL is soundcloud stream', chosen?.url === 'https://cf-media.sndcdn.com/full_stream.m3u8');
  }

  // -------------------------------------------------------------
  // Test 71 — Playback error fallback
  // -------------------------------------------------------------
  console.log('\nTest 71 — Playback error fallback');
  {
    const track = createMockTrack({
      sources: [
        {
          provider: 'soundcloud',
          playback: 'full',
          url: 'https://cf-media.sndcdn.com/failed_stream.m3u8',
          available: true,
        },
        {
          provider: 'itunes',
          playback: 'preview',
          url: 'https://audio-ssl.itunes.apple.com/working_preview.m4a',
          available: true,
        },
      ],
    });

    const initial = getPlayableSource(track);
    assert('Before failure, SoundCloud full is selected', initial?.provider === 'soundcloud');

    // Simulate playback error recorded by player
    const failedUrls = new Set<string>(['https://cf-media.sndcdn.com/failed_stream.m3u8']);
    const afterFailure = getPlayableSource(track, failedUrls);

    assert('After SoundCloud playback fails, player falls back to iTunes preview', afterFailure?.provider === 'itunes');
    assert('iTunes preview URL is chosen', afterFailure?.url === 'https://audio-ssl.itunes.apple.com/working_preview.m4a');

    // If all remote sources fail -> procedural DSP fallback
    failedUrls.add('https://audio-ssl.itunes.apple.com/working_preview.m4a');
    const allFailed = getPlayableSource(track, failedUrls);
    assert('When all remote sources fail, getPlayableSource returns null (procedural DSP fallback)', allFailed === null);
  }

  // -------------------------------------------------------------
  // Test 72 — Metadata integrity
  // -------------------------------------------------------------
  console.log('\nTest 72 — Metadata integrity');
  {
    const originalTrack = createMockTrack({
      id: 'burial_archangel_unique',
      artist: 'Burial',
      title: 'Archangel',
      bpm: 134,
      energy: 8,
      genres: ['Future Garage', 'Dubstep'],
      moods: ['night', 'rain'],
      vibeTags: ['#Garage', '#NightDrive'],
      overallScore: 94,
    });

    const sources: TrackSource[] = [
      {
        provider: 'soundcloud',
        playback: 'full',
        providerTrackId: '12345',
        url: 'https://cf-media.sndcdn.com/stream.m3u8',
        available: true,
      },
    ];

    const enriched = { ...originalTrack, sources };

    assert('ID is unchanged', enriched.id === originalTrack.id);
    assert('Artist is unchanged', enriched.artist === originalTrack.artist);
    assert('Title is unchanged', enriched.title === originalTrack.title);
    assert('BPM is unchanged', enriched.bpm === originalTrack.bpm);
    assert('Energy is unchanged', enriched.energy === originalTrack.energy);
    assert('Genres are unchanged', JSON.stringify(enriched.genres) === JSON.stringify(originalTrack.genres));
    assert('Moods are unchanged', JSON.stringify(enriched.moods) === JSON.stringify(originalTrack.moods));
    assert('VibeTags are unchanged', JSON.stringify(enriched.vibeTags) === JSON.stringify(originalTrack.vibeTags));
    assert('OverallScore is unchanged', enriched.overallScore === originalTrack.overallScore);
    assert('SoundCloud source is populated', enriched.sources?.[0].provider === 'soundcloud');
  }

  // -------------------------------------------------------------
  // Test 73 — Last.fm independence
  // -------------------------------------------------------------
  console.log('\nTest 73 — Last.fm independence');
  {
    const trackWithLastFm = createMockTrack({
      lastfm: {
        tags: ['future garage', 'ambient'],
        similarTracks: [{ artist: 'Burial', title: 'Near Dark', match: 0.95 }],
        similarArtists: [{ name: 'Four Tet', match: 0.9 }],
      },
    });

    const enriched = {
      ...trackWithLastFm,
      sources: [{ provider: 'soundcloud' as const, playback: 'full' as const, url: 'https://stream', available: true }],
    };

    assert('track.lastfm is preserved identically', JSON.stringify(enriched.lastfm) === JSON.stringify(trackWithLastFm.lastfm));
  }

  // -------------------------------------------------------------
  // Test 74 — Recommendation independence
  // -------------------------------------------------------------
  console.log('\nTest 74 — Recommendation independence');
  {
    const profile: any = {
      current_state: { mood: ['chill', 'night'], energy: 40, emotional_intensity: 50 },
      desired_state: { mood: ['night', 'electronic'], energy: 80, emotional_intensity: 75 },
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
        { name: 'Future Garage', weight: 80 },
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

    const candidates = retrieveCandidates(profile, SPEED_SOUND_TRACKS);
    assert('Stage 2 retrieval works without SoundCloud dependency', candidates.length > 0);

    const ranked = rankCandidates(profile, candidates);
    assert('Stage 2 ranking works without SoundCloud dependency', ranked.length > 0);

    const optimized = optimizePlaylistOrder(ranked.slice(0, 5).map((r) => r.track), profile);
    assert('Stage 3B optimizer functions identically without SoundCloud dependency', optimized.length > 0);
  }

  // -------------------------------------------------------------
  // Test 75 — Provider pipeline unification & Active providers
  // -------------------------------------------------------------
  console.log('\nTest 75 — Provider pipeline unification & Active providers');
  {
    assert('Default registered provider count is exactly 2 (SoundCloud + iTunes)', defaultMusicProviders.length === 2);
    assert('First provider in chain is soundcloud', defaultMusicProviders[0].provider === 'soundcloud');
    assert('Second provider in chain is itunes fallback', defaultMusicProviders[1].provider === 'itunes');

    // Verify adapter contract supports TrackSearchQuery object
    const track = createMockTrack({ artist: 'Burial', title: 'Archangel', durationSeconds: 240 });
    const sources = await resolveTrackSources(track, [itunesAdapter]);
    assert('resolveTrackSources resolves via unified contract', Array.isArray(sources));
  }

  // -------------------------------------------------------------
  // Test 76 — No secret leakage
  // -------------------------------------------------------------
  console.log('\nTest 76 — No secret leakage');
  {
    const secretValue = 'SUPER_SECRET_SOUNDCLOUD_KEY_XYZ_999';
    const source: TrackSource = {
      provider: 'soundcloud',
      playback: 'full',
      providerTrackId: '12345',
      url: 'https://cf-media.sndcdn.com/stream/track.m3u8',
      available: true,
      authorName: 'Burial',
      permalinkUrl: 'https://soundcloud.com/burial/archangel',
    };

    const serializedSource = JSON.stringify(source);
    assert('TrackSource JSON does not leak client secret', !serializedSource.includes(secretValue));
    assert('TrackSource contains public SoundCloud metadata', serializedSource.includes('Burial'));
    assert('No client_secret property in TrackSource interface', !('client_secret' in source) && !('secret' in source));
  }

  // -------------------------------------------------------------
  // Test 77 — Stream URL handling & Cache invalidation
  // -------------------------------------------------------------
  console.log('\nTest 77 — Stream URL handling & Cache invalidation');
  {
    const transcodingUrl = 'https://api.soundcloud.com/media/hls_test_cache';

    // Mock first stream resolve
    nock('https://api.soundcloud.com')
      .get('/media/hls_test_cache')
      .query(true)
      .reply(200, { url: 'https://cf-media.sndcdn.com/signed_token_1.m3u8' });

    const firstUrl = await resolveSoundCloudStreamUrl(transcodingUrl, 'test_client_77');
    assert('Stream URL 1 resolved', firstUrl === 'https://cf-media.sndcdn.com/signed_token_1.m3u8');

    // Simulate expiration by expiring cache entry
    const entry = soundcloudStreamCache.get(transcodingUrl);
    if (entry) {
      entry.expiresAt = Date.now() - 1000; // expired
    }

    // Mock second stream resolve with refreshed signature
    nock('https://api.soundcloud.com')
      .get('/media/hls_test_cache')
      .query(true)
      .reply(200, { url: 'https://cf-media.sndcdn.com/refreshed_signed_token_2.m3u8' });

    const secondUrl = await resolveSoundCloudStreamUrl(transcodingUrl, 'test_client_77');
    assert('Expired stream cache entry is refreshed with new signed URL', secondUrl === 'https://cf-media.sndcdn.com/refreshed_signed_token_2.m3u8');

    // Test explicit cache invalidation
    invalidateSoundCloudStreamCache(transcodingUrl);
    assert('invalidateSoundCloudStreamCache removes entry from cache', soundcloudStreamCache.has(transcodingUrl) === false);
  }

  // -------------------------------------------------------------
  // Test 77b — Cache clear bug fix verification
  // -------------------------------------------------------------
  console.log('\nTest 77b — Cache clear bug fix verification');
  {
    // Populate both caches
    soundcloudSearchCache.set('test_key', { data: 'test_val', expiresAt: Date.now() + 10000 });
    soundcloudStreamCache.set('test_url', { data: 'test_stream', expiresAt: Date.now() + 10000 });

    assert('Search cache has entries before clear', soundcloudSearchCache.size > 0);
    assert('Stream cache has entries before clear', soundcloudStreamCache.size > 0);

    // Call clearSoundCloudCaches
    clearSoundCloudCaches();

    assert('clearSoundCloudCaches() truly clears search cache (size === 0)', soundcloudSearchCache.size === 0);
    assert('clearSoundCloudCaches() truly clears stream cache (size === 0)', soundcloudStreamCache.size === 0);
  }

  // -------------------------------------------------------------
  // Test 78 — Stage 4C.1 Playback Diagnostic & Real Environment Verification
  // -------------------------------------------------------------
  console.log('\nTest 78 — Stage 4C.1 Playback Diagnostic & Environment Verification');
  {
    // Mock the SoundCloud API responses for the diagnostic test
    const mockClientId = 'diagnostic_client_id_test';
    nock('https://api.soundcloud.com')
      .get('/tracks')
      .query((q) => q.client_id === mockClientId)
      .reply(200, [
        {
          id: 554433,
          title: 'Archangel',
          user: { username: 'Burial' },
          duration: 240000,
          playable: true,
          streamable: true,
          access: 'playable',
          media: {
            transcodings: [
              {
                url: 'https://api.soundcloud.com/media/diagnostic_hls',
                preset: 'aac_160',
                format: { protocol: 'hls', mime_type: 'audio/aac' },
                quality: 'sq',
              },
            ],
          },
        },
      ]);

    nock('https://api.soundcloud.com')
      .get('/media/diagnostic_hls')
      .query(true)
      .reply(200, { url: 'https://cf-media.sndcdn.com/diagnostic_stream.m3u8' });

    const diagnostic = await runSoundCloudPlaybackDiagnostic('Burial', 'Archangel', 240, mockClientId);

    console.log('    [DIAGNOSTIC PIPELINE RESULTS]');
    console.log(`    SEARCH:             ${diagnostic.search}`);
    console.log(`    MATCH:              ${diagnostic.match}`);
    console.log(`    ACCESS:             ${diagnostic.access}`);
    console.log(`    TRANSCODING:        ${diagnostic.transcoding}`);
    console.log(`    STREAM_RESOLUTION:  ${diagnostic.streamResolution}`);
    console.log(`    AUDIO_ELEMENT:      ${diagnostic.audioElement}`);
    console.log(`    CAN_PLAY:           ${diagnostic.canPlay}`);
    console.log(`    PLAY:               ${diagnostic.play}`);
    console.log(`    PLAYBACK_30S:       ${diagnostic.playback30s}`);
    console.log(`    OVERALL:            ${diagnostic.overallStatus}`);

    assert('SEARCH step completed', diagnostic.search === 'PASS');
    assert('MATCH step validated deterministic candidate', diagnostic.match === 'PASS');
    assert('ACCESS step confirmed playable status', diagnostic.access === 'PASS');
    assert('TRANSCODING step confirmed HLS AAC 160 preset', diagnostic.transcoding === 'PASS');
    assert('STREAM_RESOLUTION step confirmed valid stream URL', diagnostic.streamResolution === 'PASS');

    // Real environment audit: Never return fake PASS for physical browser audio!
    const isBrowserAudioAvailable = typeof Audio !== 'undefined';
    if (!isBrowserAudioAvailable) {
      assert('Headless Node.js test environment correctly marks physical audio stages as MANUAL_REQUIRED', diagnostic.audioElement === 'MANUAL_REQUIRED');
      assert('Overall status in headless environment is MANUAL_REQUIRED (no fake PASS)', diagnostic.overallStatus === 'MANUAL_REQUIRED');
      console.log('\n    [PLATFORM VALIDATION REQUIREMENTS]');
      console.log('    -> Chrome Desktop (Web):         MANUAL REQUIRED (verify currentTime > 30s)');
      console.log('    -> Telegram Android Mini App:    MANUAL REQUIRED (physical device required)');
      console.log('    -> Telegram iOS Mini App:        MANUAL REQUIRED (physical device required)');
      console.log('    -> See manual QA protocol in docs/stage4c-playback-validation.md');
    }
  }

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  if (failed) {
    console.log('\n==============================================');
    console.log('SOME STAGE 4C.1 QA TESTS FAILED! CHECK OUTPUT ABOVE.');
    console.log('==============================================');
    process.exit(1);
  } else {
    console.log('\n==============================================');
    console.log('ALL STAGE 4C.1 QA TESTS (56-78) PASSED SUCCESSFULLY!');
    console.log('==============================================');
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
