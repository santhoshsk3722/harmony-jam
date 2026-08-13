// Harmony Jam YouTube Music Track Factory & Direct Search API Engine

export function extractYouTubeId(url) {
  if (!url) return null;
  // Support watch URLs, shorts, embeds, and share links
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : (url.length === 11 ? url : null);
}

export function createYouTubeTrack(urlOrId, title = 'YouTube Song', artist = 'YouTube Artist', album = 'YouTube Release') {
  const videoId = extractYouTubeId(urlOrId) || urlOrId;
  return {
    id: 'yt-' + videoId,
    type: 'youtube',
    youtubeId: videoId,
    title: title,
    artist: artist,
    album: album,
    duration: 210,
    cover: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    src: `https://www.youtube.com/watch?v=${videoId}`,
    genre: 'YouTube Music'
  };
}

// Google YouTube Search Autosuggest API
export async function fetchYouTubeSuggestions(query) {
  if (!query || query.trim().length < 2) return [];
  const cleanQuery = query.trim();

  const suggestUrl = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(cleanQuery)}`;
  try {
    const res = await fetch(suggestUrl);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[1])) {
        return data[1].slice(0, 7);
      }
    }
  } catch (e) {}

  return [
    `${cleanQuery} song`,
    `${cleanQuery} music video`,
    `${cleanQuery} lofi remix`,
    `${cleanQuery} official audio`
  ];
}

// Unlimited Multi-Proxy YouTube Video & Music Search Engine (v3.1.0)
export async function searchYouTubeSongs(query) {
  if (!query || !query.trim()) return [];
  const cleanQuery = query.trim();

  // 1. Direct YouTube URL or Video ID check
  const directId = extractYouTubeId(cleanQuery);
  if (directId) {
    return [createYouTubeTrack(directId, 'YouTube Video Track', 'Direct Link', 'YouTube Stream')];
  }

  // 2. Query High-Capacity Public YouTube Search Endpoints (No filters, return ALL videos!)
  const apis = [
    `https://yt.lemnoslife.com/noKey/search?q=${encodeURIComponent(cleanQuery)}`,
    `https://inv.tux.pizza/api/v1/search?q=${encodeURIComponent(cleanQuery)}`,
    `https://invidious.nerdvpn.de/api/v1/search?q=${encodeURIComponent(cleanQuery)}`,
    `https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(cleanQuery)}`,
    `https://api.piped.projectsegfau.lt/search?q=${encodeURIComponent(cleanQuery)}`
  ];

  for (let apiUrl of apis) {
    try {
      const res = await fetch(apiUrl, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const items = data.items || data.results || (Array.isArray(data) ? data : []);
        
        const results = [];
        for (let item of items) {
          // Parse videoId across different API payload schemas
          let videoId = null;
          if (typeof item.id === 'string' && item.id.length >= 10) videoId = item.id;
          else if (item.id && item.id.videoId) videoId = item.id.videoId;
          else if (item.url) videoId = extractYouTubeId(item.url);
          else if (item.videoId) videoId = item.videoId;

          if (videoId && typeof videoId === 'string' && videoId.length >= 10) {
            // Deduplicate
            if (!results.some(r => r.youtubeId === videoId)) {
              results.push({
                id: 'yt-' + videoId,
                type: 'youtube',
                youtubeId: videoId,
                title: item.title || item.snippet?.title || 'YouTube Music',
                artist: item.uploaderName || item.channelTitle || item.author || item.snippet?.channelTitle || 'YouTube Artist',
                album: 'YouTube Release',
                duration: item.duration || 210,
                cover: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
                src: `https://www.youtube.com/watch?v=${videoId}`,
                genre: 'YouTube Music'
              });
            }
          }
          if (results.length >= 25) break;
        }

        if (results.length > 0) return results;
      }
    } catch (e) {
      console.warn('[YouTube Search] Proxy API error:', e);
    }
  }

  // Fallback results if network is blocked
  return [
    createYouTubeTrack('jfKfPfyJRdk', `${cleanQuery} - Lofi Chill Beats`, 'Lofi Girl', 'YouTube Lofi'),
    createYouTubeTrack('5qap5aO4i9A', `${cleanQuery} - Cyberpunk Synthwave`, 'Lofi Synthwave', 'YouTube Synthwave')
  ];
}

export function createCustomTrack(url, title = 'Custom Stream', artist = 'Web Source') {
  const ytId = extractYouTubeId(url);
  if (ytId) {
    return createYouTubeTrack(ytId, title, artist, 'YouTube Link');
  }
  return {
    id: 'custom-' + Date.now(),
    type: 'audio',
    title: title,
    artist: artist,
    album: 'Custom Stream',
    duration: 0,
    cover: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=600&auto=format&fit=crop&q=80',
    src: url,
    genre: 'Custom Stream'
  };
}

export function createLocalFileTrack(file) {
  const objectUrl = URL.createObjectURL(file);
  return {
    id: 'file-' + Date.now(),
    type: 'audio',
    title: file.name.replace(/\.[^/.]+$/, ""),
    artist: 'Local Audio File',
    album: 'Device Upload',
    duration: 0,
    cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
    src: objectUrl,
    genre: 'Local Audio'
  };
}

// Curated YouTube Music Showcase Tracks categorized by Genre
export const DEFAULT_TRACKS = [
  {
    id: 'yt-jfKfPfyJRdk',
    type: 'youtube',
    youtubeId: 'jfKfPfyJRdk',
    title: 'Lofi Hip Hop Radio 📚 - Beats to Relax/Study',
    artist: 'Lofi Girl',
    album: 'Album: Lofi Study Sessions',
    duration: 240,
    cover: 'https://img.youtube.com/vi/jfKfPfyJRdk/hqdefault.jpg',
    src: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
    genre: 'lofi'
  },
  {
    id: 'yt-5qap5aO4i9A',
    type: 'youtube',
    youtubeId: '5qap5aO4i9A',
    title: 'Lofi Synthwave Radio 🚀 - Chill Synth Beats',
    artist: 'Lofi Girl Synthwave',
    album: 'Album: Cyberpunk 1984',
    duration: 220,
    cover: 'https://img.youtube.com/vi/5qap5aO4i9A/hqdefault.jpg',
    src: 'https://www.youtube.com/watch?v=5qap5aO4i9A',
    genre: 'synthwave'
  },
  {
    id: 'yt-vG2PNdI8owe',
    type: 'youtube',
    youtubeId: 'vG2PNdI8owe',
    title: 'Coldplay - Yellow (Official Music Video)',
    artist: 'Coldplay',
    album: 'Album: Parachutes',
    duration: 268,
    cover: 'https://img.youtube.com/vi/vG2PNdI8owe/hqdefault.jpg',
    src: 'https://www.youtube.com/watch?v=vG2PNdI8owe',
    genre: 'rock'
  },
  {
    id: 'yt-kffacxfA7G4',
    type: 'youtube',
    youtubeId: 'kffacxfA7G4',
    title: 'Justin Bieber - Baby ft. Ludacris',
    artist: 'Justin Bieber',
    album: 'Album: My World 2.0',
    duration: 225,
    cover: 'https://img.youtube.com/vi/kffacxfA7G4/hqdefault.jpg',
    src: 'https://www.youtube.com/watch?v=kffacxfA7G4',
    genre: 'pop'
  },
  {
    id: 'yt-fJ9rUzIMcZQ',
    type: 'youtube',
    youtubeId: 'fJ9rUzIMcZQ',
    title: 'Queen - Bohemian Rhapsody (Official Video)',
    artist: 'Queen',
    album: 'Album: A Night at the Opera',
    duration: 355,
    cover: 'https://img.youtube.com/vi/fJ9rUzIMcZQ/hqdefault.jpg',
    src: 'https://www.youtube.com/watch?v=fJ9rUzIMcZQ',
    genre: 'rock'
  },
  {
    id: 'yt-OPf0YbXqDm0',
    type: 'youtube',
    youtubeId: 'OPf0YbXqDm0',
    title: 'Mark Ronson - Uptown Funk ft. Bruno Mars',
    artist: 'Mark Ronson / Bruno Mars',
    album: 'Album: Uptown Special',
    duration: 270,
    cover: 'https://img.youtube.com/vi/OPf0YbXqDm0/hqdefault.jpg',
    src: 'https://www.youtube.com/watch?v=OPf0YbXqDm0',
    genre: 'pop'
  },
  {
    id: 'track-1',
    type: 'audio',
    title: 'Midnight Lofi Study Session',
    artist: 'Lofi Beats Co.',
    album: 'Album: Nightowl Sessions',
    duration: 164,
    cover: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=600&auto=format&fit=crop&q=80',
    src: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112191.mp3',
    genre: 'lofi'
  },
  {
    id: 'track-4',
    type: 'audio',
    title: 'Ibiza Club Deep House Sunset',
    artist: 'Ibiza Club Grooves',
    album: 'Album: Tropical Summer Hits',
    duration: 188,
    cover: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80',
    src: 'https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3?filename=tropical-house-113337.mp3',
    genre: 'electronic'
  }
];
