import dotenv from 'dotenv';
dotenv.config({ override: true });

import { SPEED_SOUND_TRACKS } from '../src/data/tracks';
import {
  soundCloudAdapter,
  resolveSoundCloudStreamUrl,
  evaluateSoundCloudMatch,
  extractPlayableTranscoding,
  SoundCloudTrackItem,
} from '../src/services/musicProviders/soundcloud';
import { enrichTrackWithSources, getPlayableSource } from '../src/services/musicProviders';

async function runProductionDiagnostic() {
  console.log('=====================================');
  console.log('SoundCloud Production Diagnostic');
  console.log('=====================================');

  // Select a prominent signature track from SPEED_SOUND_TRACKS
  const sampleTrack =
    SPEED_SOUND_TRACKS.find((t) => t.artist === 'Burial' && t.title === 'Archangel') ||
    SPEED_SOUND_TRACKS.find((t) => t.artist === 'Bicep' && t.title === 'Glue') ||
    SPEED_SOUND_TRACKS[0];

  console.log(`Track:\n${sampleTrack.artist} — ${sampleTrack.title}\n`);

  let stageSearch = 'FAIL';
  let stageMatch = 'FAIL';
  let stageAccess = 'FAIL';
  let stageTranscoding = 'FAIL';
  let stageStream = 'FAIL';
  let stageTrackSource = 'FAIL';
  let failureReason: string | undefined;

  let bestItem: SoundCloudTrackItem | undefined;
  let playableInfo: ReturnType<typeof extractPlayableTranscoding> | undefined;
  let streamUrl: string | null = null;

  try {
    const activeClientId = await soundCloudAdapter.getActiveClientId();
    if (!activeClientId) {
      throw new Error('No active SoundCloud client ID could be resolved');
    }

    // [1] Search
    const searchUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(
      `${sampleTrack.artist} ${sampleTrack.title}`
    )}&limit=6&client_id=${encodeURIComponent(activeClientId)}`;

    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
        Referer: 'https://soundcloud.com/',
      },
    });

    if (!res.ok) {
      throw new Error(`SoundCloud search returned HTTP ${res.status}`);
    }

    const data = await res.json();
    const items: SoundCloudTrackItem[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.collection)
      ? data.collection
      : [];

    if (items.length === 0) {
      throw new Error('No track candidates returned from SoundCloud search');
    }
    stageSearch = 'PASS';

    // [2] Match
    const candidates = items
      .map((item) => {
        const evalRes = evaluateSoundCloudMatch(
          sampleTrack.artist,
          sampleTrack.title,
          sampleTrack.durationSeconds,
          item
        );
        return { item, evalRes };
      })
      .filter((c) => c.evalRes.accepted)
      .sort((a, b) => b.evalRes.score - a.evalRes.score);

    if (candidates.length === 0) {
      throw new Error('Candidates found but none met strict metadata & version matching');
    }
    bestItem = candidates[0].item;
    stageMatch = 'PASS';

    // [3] Access
    playableInfo = extractPlayableTranscoding(bestItem);
    if (!playableInfo.isPlayable) {
      throw new Error('Matched candidate is policy-blocked or unplayable');
    }
    stageAccess = 'PASS';

    // [4] Transcoding
    if (!playableInfo.transcodingUrl) {
      throw new Error('No suitable audio transcoding preset found');
    }
    stageTranscoding = 'PASS';

    // [5] Stream resolution
    streamUrl = await resolveSoundCloudStreamUrl(playableInfo.transcodingUrl, activeClientId);
    if (!streamUrl) {
      throw new Error('Failed to resolve authenticated stream playback URL');
    }
    stageStream = 'PASS';

    // [6] TrackSource via official provider pipeline
    const enrichedTrack = await enrichTrackWithSources(sampleTrack);
    const playableSource = getPlayableSource(enrichedTrack);

    if (playableSource && playableSource.provider === 'soundcloud') {
      stageTrackSource = 'PASS';
    } else {
      throw new Error(
        `TrackSource failed: selected provider=${playableSource?.provider || 'none'}, playback=${
          playableSource?.playback || 'none'
        }`
      );
    }

    console.log(`[1] Search              ${stageSearch}`);
    console.log(`[2] Match               ${stageMatch}`);
    console.log(`[3] Access              ${stageAccess}`);
    console.log(`[4] Transcoding         ${stageTranscoding}`);
    console.log(`[5] Stream resolution   ${stageStream}`);
    console.log(`[6] TrackSource         ${stageTrackSource}`);
    console.log(`Provider: ${playableSource.provider}`);
    console.log(`Playback: ${playableSource.playback}`);
    console.log(`Stream format: ${playableSource.streamFormat || 'hls'}`);
    console.log(`Duration: ${Math.round((playableSource.durationMs || 0) / 1000)}s`);
    console.log('=====================================');
  } catch (err: any) {
    failureReason = err?.message || String(err);
    console.log(`[1] Search              ${stageSearch}`);
    console.log(`[2] Match               ${stageMatch}`);
    console.log(`[3] Access              ${stageAccess}`);
    console.log(`[4] Transcoding         ${stageTranscoding}`);
    console.log(`[5] Stream resolution   ${stageStream}`);
    console.log(`[6] TrackSource         ${stageTrackSource}`);
    console.log(`\nFAILURE REASON: ${failureReason}`);
    console.log('=====================================');
    process.exit(1);
  }
}

runProductionDiagnostic();
