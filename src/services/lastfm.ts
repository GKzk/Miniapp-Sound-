import { LastFmMetadata, Track, LastFmSimilarArtist, LastFmSimilarTrack } from '../types';

const lastFmCache = new Map<string, { data: LastFmMetadata; timestamp: number }>();
const artistCache = new Map<string, { data: LastFmSimilarArtist[]; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const normalizeString = (str: string) => {
  return str.toLowerCase().replace(/\s+/g, ' ').trim();
};

async function fetchWithTimeout(url: string, timeoutMs: number = 2000): Promise<any> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(id);
  }
}

async function getSimilarArtists(artist: string): Promise<LastFmSimilarArtist[]> {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) return [];

  const artistKey = normalizeString(artist);
  const cached = artistCache.get(artistKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(artist)}&api_key=${apiKey}&format=json&limit=5`;
    const data = await fetchWithTimeout(url);
    if (data?.similarartists?.artist && Array.isArray(data.similarartists.artist)) {
      const results = data.similarartists.artist.map((a: any) => ({
        name: a.name,
        match: Math.max(0, Math.min(1, parseFloat(a.match) || 0))
      }));
      artistCache.set(artistKey, { data: results, timestamp: Date.now() });
      return results;
    }
    return [];
}

export async function getLastFmMetadata(artist: string, title: string): Promise<LastFmMetadata | null> {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) return null;

  const trackKey = `track:${normalizeString(artist)}:${normalizeString(title)}`;
  const cached = lastFmCache.get(trackKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const similarArtistsPromise = getSimilarArtists(artist);

    // Track similar
    const similarTrackUrl = `https://ws.audioscrobbler.com/2.0/?method=track.getsimilar&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}&api_key=${apiKey}&format=json&limit=5`;
    const similarTrackDataPromise = fetchWithTimeout(similarTrackUrl);

    // Track tags
    const trackTagsUrl = `https://ws.audioscrobbler.com/2.0/?method=track.gettoptags&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}&api_key=${apiKey}&format=json`;
    const trackTagsDataPromise = fetchWithTimeout(trackTagsUrl);

    const [similarArtists, similarTrackData, trackTagsData] = await Promise.all([
      similarArtistsPromise,
      similarTrackDataPromise,
      trackTagsDataPromise
    ]);

    let similarTracks: LastFmSimilarTrack[] = [];
    if (similarTrackData?.similartracks?.track && Array.isArray(similarTrackData.similartracks.track)) {
      similarTracks = similarTrackData.similartracks.track.map((t: any) => ({
        artist: t.artist?.name || '',
        title: t.name,
        match: Math.max(0, Math.min(1, parseFloat(t.match) || 0))
      })).filter((t: LastFmSimilarTrack) => t.artist && t.title);
    }

    let tags: string[] = [];
    if (trackTagsData?.toptags?.tag && Array.isArray(trackTagsData.toptags.tag)) {
      const rawTags = trackTagsData.toptags.tag.map((t: any) => normalizeString(t.name));
      tags = Array.from(new Set<string>(rawTags)).slice(0, 10);
    }

    const result: LastFmMetadata = {
      tags,
      similarTracks,
      similarArtists
    };

    lastFmCache.set(trackKey, { data: result, timestamp: Date.now() });
    return result;

  } catch (err) {
    // Ignore errors, return null as per spec
    return null;
  }
}

export async function enrichWithLastFm(tracks: Track[]): Promise<Track[]> {
  if (!process.env.LASTFM_API_KEY) return tracks;

  const results: Track[] = [];
  const start = performance.now();
  
  // Process in chunks of 3 to limit concurrent API calls
  for (let i = 0; i < tracks.length; i += 3) {
    const chunk = tracks.slice(i, i + 3);
    const chunkResults = await Promise.all(
      chunk.map(async (track) => {
        const metadata = await getLastFmMetadata(track.artist, track.title);
        if (metadata) {
          return { ...track, lastfm: metadata };
        }
        return track;
      })
    );
    results.push(...chunkResults);
  }
  
  const end = performance.now();
  console.log(`[Stage 4A] Last.fm enrichment completed in ${(end - start).toFixed(2)}ms`);
  
  return results;
}
