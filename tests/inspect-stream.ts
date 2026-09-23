import dotenv from 'dotenv';
dotenv.config({ override: true });

import { soundCloudAdapter } from '../src/services/musicProviders/soundcloud';

async function inspectTracks() {
  const activeClientId = await soundCloudAdapter.getActiveClientId();
  if (!activeClientId) {
    console.error('No active SoundCloud client ID');
    return;
  }
  
  // Track IDs to inspect
  const trackIds = ['1654511685', '1335196105']; // Sammy Virji and Fred again..
  
  for (const id of trackIds) {
    console.log(`\nInspecting Track ID: ${id}`);
    const url = `https://api-v2.soundcloud.com/tracks/${id}?client_id=${activeClientId}`;
    
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          Referer: 'https://soundcloud.com/',
        }
      });
      
      if (!res.ok) {
        console.log(`HTTP Error: ${res.status}`);
        continue;
      }
      
      const track = await res.json() as any;
      console.log(`Title: ${track.title}`);
      console.log(`User: ${track.user?.username}`);
      console.log(`Policy: ${track.policy}`);
      console.log(`Access: ${track.access}`);
      console.log(`Monetization Model: ${track.monetization_model}`);
      console.log(`Streamable: ${track.streamable}`);
      console.log(`Playable: ${track.playable}`);
      
      const transcodings = track.media?.transcodings || [];
      console.log(`Transcodings Count: ${transcodings.length}`);
      
      for (const t of transcodings) {
        console.log(`Preset: ${t.preset}, Protocol: ${t.format?.protocol}, Mime: ${t.format?.mime_type}`);
        // Let's try to resolve this transcoding stream URL
        const tUrl = `${t.url}${t.url.includes('?') ? '&' : '?'}client_id=${activeClientId}`;
        const streamRes = await fetch(tUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            Referer: 'https://soundcloud.com/',
          }
        });
        console.log(`  -> Stream Resolution Status: ${streamRes.status}`);
        if (streamRes.ok) {
          const body = await streamRes.json() as any;
          console.log(`  -> Stream URL: ${body.url ? 'RESOLVED' : 'NONE'}`);
        } else {
          const bodyText = await streamRes.text();
          console.log(`  -> Stream Resolution Error: ${bodyText.slice(0, 100)}`);
        }
      }
    } catch (err: any) {
      console.log('Error:', err.message);
    }
  }
}

inspectTracks();
