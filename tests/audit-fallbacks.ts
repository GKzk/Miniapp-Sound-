import dotenv from 'dotenv';
dotenv.config({ override: true });

import { SPEED_SOUND_TRACKS } from '../src/data/tracks';
import {
  soundCloudAdapter,
  evaluateSoundCloudMatch,
  extractPlayableTranscoding,
  resolveSoundCloudStreamUrl,
  SoundCloudTrackItem,
} from '../src/services/musicProviders/soundcloud';

const FALLBACK_TRACKS = [
  { artist: 'Vacant', title: 'In Discord' },
  { artist: 'Sorrow', title: 'Search of the Miraculous' },
  { artist: 'Sammy Virji', title: 'If U Need It' },
  { artist: 'Fred again..', title: 'Danielle (smile on my face)' },
];

async function runFallbackAudit() {
  const activeClientId = await soundCloudAdapter.getActiveClientId();
  if (!activeClientId) {
    console.error('No active SoundCloud client ID could be resolved');
    return;
  }
  console.log(`Using active Client ID: ${activeClientId}`);

  for (const track of FALLBACK_TRACKS) {
    console.log('\n======================================================');
    console.log(`TRACK: ${track.artist} — ${track.title}`);
    console.log('======================================================');

    const query = `${track.artist} ${track.title}`;
    const searchUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(
      query
    )}&limit=10&client_id=${encodeURIComponent(activeClientId)}`;

    let items: SoundCloudTrackItem[] = [];
    let searchStatus = 'FAIL';
    try {
      const res = await fetch(searchUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json',
          Referer: 'https://soundcloud.com/',
        },
      });
      if (res.ok) {
        const data = await res.json();
        items = Array.isArray(data)
          ? data
          : Array.isArray(data?.collection)
          ? data.collection
          : [];
        searchStatus = 'PASS';
      }
    } catch (err: any) {
      console.log('Search API Error:', err.message);
    }

    console.log(`Search: ${searchStatus}`);
    console.log(`Search results: ${items.length}`);

    if (items.length === 0) {
      console.log('Matching: FAIL');
      console.log('Final reason: NO_RESULTS');
      continue;
    }

    // Evaluate all candidates
    const evaluated = items.map((item) => {
      const evalRes = evaluateSoundCloudMatch(track.artist, track.title, undefined, item);
      const playableInfo = extractPlayableTranscoding(item);
      return { item, evalRes, playableInfo };
    });

    const acceptedCandidates = evaluated.filter((c) => c.evalRes.accepted);
    const rejectedCandidates = evaluated.filter((c) => !c.evalRes.accepted);

    console.log(`Matching: ${acceptedCandidates.length > 0 ? 'PASS' : 'FAIL'}`);

    if (rejectedCandidates.length > 0) {
      console.log('Rejected candidates:');
      rejectedCandidates.forEach((c, idx) => {
        console.log(`  ${idx + 1}. "${c.item.title}" by ${c.item.user?.username || 'unknown'}`);
        console.log(`     reason: ${c.evalRes.reason || 'Not matched / score low'}`);
        console.log(`     score: ${c.evalRes.score}`);
      });
    } else {
      console.log('Rejected candidates: None');
    }

    if (acceptedCandidates.length === 0) {
      console.log('Access: FAIL');
      console.log('Playable: FAIL');
      console.log('Transcodings: 0');
      console.log('Stream resolution: FAIL');
      console.log('Final reason: MATCH_REJECTED');
      continue;
    }

    // Take the best accepted candidate
    acceptedCandidates.sort((a, b) => b.evalRes.score - a.evalRes.score);
    const best = acceptedCandidates[0];

    console.log(`Accepted candidate count: ${acceptedCandidates.length}`);
    console.log(`Best matched candidate: "${best.item.title}" (ID: ${best.item.id})`);
    console.log(`Match score: ${best.evalRes.score}`);

    const isBlocked = best.item.policy === 'BLOCK' || best.item.access === 'blocked';
    console.log(`Access: ${!isBlocked ? 'PASS' : 'FAIL'}`);

    const isPlayable = best.playableInfo.isPlayable;
    console.log(`Playable: ${isPlayable ? 'PASS' : 'FAIL'}`);

    const transcodings = best.item.media?.transcodings || [];
    console.log(`Transcodings: ${transcodings.length}`);

    if (transcodings.length > 0) {
      console.log('Transcoding formats:');
      transcodings.forEach((t) => {
        console.log(`  - preset: ${t.preset}, protocol: ${t.format?.protocol}, mime: ${t.format?.mime_type}`);
      });
    }

    console.log(`Selected transcoding: ${best.playableInfo.streamFormat || 'NONE'}`);

    let streamStatus = 'FAIL';
    let streamUrlResolved = false;
    if (best.playableInfo.transcodingUrl) {
      const streamUrl = await resolveSoundCloudStreamUrl(best.playableInfo.transcodingUrl, activeClientId);
      if (streamUrl) {
        streamStatus = 'PASS';
        streamUrlResolved = true;
      }
    }

    console.log(`Stream resolution: ${streamStatus}`);

    // Determine exact final reason
    let finalReason = 'OTHER';
    if (!isPlayable) {
      finalReason = 'BLOCKED';
    } else if (transcodings.length === 0) {
      finalReason = 'NO_TRANSCODING';
    } else if (!best.playableInfo.transcodingUrl) {
      finalReason = 'UNSUPPORTED_TRANSCODING';
    } else if (!streamUrlResolved) {
      finalReason = 'STREAM_RESOLUTION_FAILED';
    } else {
      finalReason = 'RESOLVED';
    }
    console.log(`Final reason: ${finalReason}`);
  }
}

runFallbackAudit();
