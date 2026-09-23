import dotenv from 'dotenv';
dotenv.config({ override: true });

import { SPEED_SOUND_TRACKS } from '../src/data/tracks';
import {
  retrieveCandidates,
  rankCandidates,
  selectTopCandidates,
  optimizePlaylistOrder,
  enrichTracksWithRealAudio,
} from '../server';
import { getPlayableSource } from '../src/services/musicProviders';
import { getSoundCloudMetrics, resetSoundCloudMetrics } from '../src/services/musicProviders/soundcloud';

async function runProductionPipelineDiagnostic() {
  console.log('=====================================================');
  console.log('Production Recommendation & Provider Pipeline Diagnostic');
  console.log('=====================================================');

  resetSoundCloudMetrics();

  // Representative Gemini MusicProfile (Night Drive, UK Garage / Dubstep / Melancholic Vibe)
  const sampleProfile: any = {
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
      { name: 'Phonk', weight: 60 },
      { name: 'Dubstep', weight: 50 },
    ],
    subgenres: [],
    artist_styles: [],
    avoid: [],
    discovery: 0,
    strategy_concept: 'Night club drive',
    strategy_emotional_arc: ['Rising energy to peak club vibe'],
    vibe_verdict: 'Peak night drive',
  };

  console.log('\nStep 1: Stage 2 Candidate Retrieval & Ranking...');
  const candidates = retrieveCandidates(sampleProfile, SPEED_SOUND_TRACKS);
  console.log(`Candidates retrieved: ${candidates.length}`);
  const ranked = rankCandidates(sampleProfile, candidates);
  console.log(`Candidates ranked: ${ranked.length}`);
  const top10 = selectTopCandidates(ranked, 10, 2);
  console.log(`Top candidates selected: ${top10.length}`);

  console.log('\nStep 2: Stage 3B Playlist Ordering...');
  const orderedTracks = optimizePlaylistOrder(top10, sampleProfile);
  console.log(`Ordered playlist tracks: ${orderedTracks.length}`);

  console.log('\nStep 3: Stage 4C Audio Provider Enrichment...');
  const enrichedPlaylist = await enrichTracksWithRealAudio(orderedTracks);

  let soundCloudFullCount = 0;
  let soundCloudPreviewCount = 0;
  let itunesPreviewCount = 0;
  let dspCount = 0;

  console.log('\nREAL PRODUCTION TRACE:\n');
  enrichedPlaylist.forEach((track, idx) => {
    const playable = getPlayableSource(track);
    const sc = track.sources?.find((s) => s.provider === 'soundcloud');
    const itunes = track.sources?.find((s) => s.provider === 'itunes');

    console.log(`Track ${idx + 1}:`);
    console.log(`${track.artist} — ${track.title}`);
    console.log(`SoundCloud search: ${sc ? 'PASS' : 'FAIL'}`);
    console.log(`Match: ${sc ? 'PASS' : 'FAIL'}`);
    console.log(`Stream: ${sc?.url ? 'PASS' : 'FAIL'}`);
    console.log(`Final source: provider=${playable?.provider || 'dsp'}, playback=${playable?.playback || 'none'}\n`);

    if (playable?.provider === 'soundcloud') {
      if (playable.playback === 'full') soundCloudFullCount++;
      else soundCloudPreviewCount++;
    } else if (playable?.provider === 'itunes') {
      itunesPreviewCount++;
    } else {
      dspCount++;
    }
  });

  const metrics = getSoundCloudMetrics();

  console.log('-----------------------------------------------------');
  console.log('DEBUG COUNTER METRICS:');
  console.log(`SoundCloud attempts:       ${metrics.soundcloudResolutionAttempts}`);
  console.log(`SoundCloud search success: ${metrics.soundcloudSearchSuccess}`);
  console.log(`SoundCloud match success:  ${metrics.soundcloudMatchSuccess}`);
  console.log(`SoundCloud stream success: ${metrics.soundcloudStreamSuccess}`);
  console.log(`SoundCloud full sources:   ${metrics.soundcloudFullSourceProduced}`);
  console.log(`iTunes fallback:           ${metrics.itunesFallbackCount}`);

  console.log('\nFINAL SOURCE DISTRIBUTION:');
  console.log(`Final playlist: 10 tracks`);
  console.log(`SoundCloud full:    ${soundCloudFullCount}`);
  console.log(`SoundCloud preview: ${soundCloudPreviewCount}`);
  console.log(`iTunes preview:     ${itunesPreviewCount}`);
  console.log(`DSP:                ${dspCount}`);
  console.log('=====================================================\n');

  if (soundCloudFullCount > 0) {
    console.log('VERDICT: PASS — SoundCloud full audio successfully resolved in production pipeline!');
    process.exit(0);
  } else {
    console.error('VERDICT: FAIL — No SoundCloud full sources resolved.');
    process.exit(1);
  }
}

runProductionPipelineDiagnostic();
