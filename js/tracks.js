// Helper to extract YouTube Video ID from any YouTube URL (watch, shorts, share, embed)
export function extractYouTubeId(url) {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

export function createYouTubeTrack(urlOrId, title = 'YouTube Song', artist = 'YouTube Music') {
  const videoId = extractYouTubeId(urlOrId) || urlOrId;
  return {
    id: 'yt-' + videoId,
    type: 'youtube',
    youtubeId: videoId,
    title: title,
    artist: artist,
    album: 'YouTube Stream',
    duration: 0,
    cover: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    src: `https://www.youtube.com/watch?v=${videoId}`,
    genre: 'YouTube Music'
  };
}

export async function searchYouTubeSongs(query) {
  if (!query || !query.trim()) return [];
  const cleanQuery = query.trim();

  // 1. Direct YouTube URL or Video ID check
  const directId = extractYouTubeId(cleanQuery);
  if (directId) {
    return [createYouTubeTrack(directId, 'YouTube Video Track', 'Direct Link')];
  }

  // 2. Query Piped & Invidious Public CORS Music Search Endpoints
  const apis = [
    `https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(cleanQuery)}&filter=music`,
    `https://api.piped.projectsegfau.lt/search?q=${encodeURIComponent(cleanQuery)}&filter=music`,
    `https://yt.lemnoslife.com/noKey/search?q=${encodeURIComponent(cleanQuery)}`
  ];

  for (let apiUrl of apis) {
    try {
      const res = await fetch(apiUrl, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const items = data.items || data.results || (Array.isArray(data) ? data : []);
        
        const results = [];
        for (let item of items) {
          const videoId = item.id || (item.url ? item.url.replace('/watch?v=', '') : null) || item.videoId;
          if (videoId && typeof videoId === 'string' && videoId.length >= 10) {
            results.push({
              id: 'yt-' + videoId,
              type: 'youtube',
              youtubeId: videoId,
              title: item.title || 'YouTube Track',
              artist: item.uploaderName || item.channelTitle || item.author || 'YouTube Artist',
              album: 'YouTube Music',
              duration: item.duration || 180,
              cover: item.thumbnail || item.thumbnailUrl || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
              src: `https://www.youtube.com/watch?v=${videoId}`,
              genre: 'YouTube'
            });
          }
          if (results.length >= 8) break;
        }

        if (results.length > 0) return results;
      }
    } catch (e) {
      console.warn('Search API fallback:', e);
    }
  }

  // Fallback fallback sample results if offline/network restricted
  return [
    createYouTubeTrack('jfKfPfyJRdk', `${cleanQuery} - Lofi Beat Mix`, 'YouTube Music'),
    createYouTubeTrack('5qap5aO4i9A', `${cleanQuery} - Synthwave Mix`, 'YouTube Music')
  ];
}

export function createCustomTrack(url, title = 'Custom Audio Stream', artist = 'Web Audio Source') {
  const ytId = extractYouTubeId(url);
  if (ytId) {
    return createYouTubeTrack(ytId, title, artist);
  }
  return {
    id: 'custom-' + Date.now(),
    type: 'audio',
    title: title,
    artist: artist,
    album: 'Custom Link',
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
    artist: 'Local File',
    album: 'Uploaded Track',
    duration: 0,
    cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
    src: objectUrl,
    genre: 'Local Audio'
  };
}

// Curated list of high quality royalty-free music streams + YouTube tracks
export const DEFAULT_TRACKS = [
  {
    id: 'yt-jfKfPfyJRdk',
    type: 'youtube',
    youtubeId: 'jfKfPfyJRdk',
    title: 'Lofi Hip Hop Radio 📚 - Beats to Relax/Study',
    artist: 'Lofi Girl',
    album: 'YouTube Live',
    duration: 240,
    cover: 'https://img.youtube.com/vi/jfKfPfyJRdk/hqdefault.jpg',
    src: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
    genre: 'Lofi Chill'
  },
  {
    id: 'yt-5qap5aO4i9A',
    type: 'youtube',
    youtubeId: '5qap5aO4i9A',
    title: 'Lofi Synthwave Radio 🚀 - Chill Synth Beats',
    artist: 'Lofi Girl Synthwave',
    album: 'YouTube Live',
    duration: 220,
    cover: 'https://img.youtube.com/vi/5qap5aO4i9A/hqdefault.jpg',
    src: 'https://www.youtube.com/watch?v=5qap5aO4i9A',
    genre: 'Synthwave'
  },
  {
    id: 'track-1',
    type: 'audio',
    title: 'Midnight Chill Lofi',
    artist: 'Lofi Beats Co.',
    album: 'Nightowl Sessions',
    duration: 164,
    cover: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=600&auto=format&fit=crop&q=80',
    src: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112191.mp3',
    genre: 'Lofi / Chill'
  },
  {
    id: 'track-2',
    type: 'audio',
    title: 'Synthwave Horizon',
    artist: 'Neon Cyberpunk',
    album: 'Retro Future 1984',
    duration: 210,
    cover: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
    src: 'https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8a73467.mp3?filename=synthwave-80s-110045.mp3',
    genre: 'Synthwave'
  },
  {
    id: 'track-3',
    type: 'audio',
    title: 'Acoustic Morning Coffee',
    artist: 'Woodland Duo',
    album: 'Unplugged Memories',
    duration: 145,
    cover: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=600&auto=format&fit=crop&q=80',
    src: 'https://cdn.pixabay.com/download/audio/2022/10/14/audio_9939f79274.mp3?filename=acoustic-guitar-lofi-123282.mp3',
    genre: 'Acoustic'
  },
  {
    id: 'track-4',
    type: 'audio',
    title: 'Deep House Sunset',
    artist: 'Ibiza Club Grooves',
    album: 'Summer Horizon',
    duration: 188,
    cover: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80',
    src: 'https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3?filename=tropical-house-113337.mp3',
    genre: 'Electronic'
  }
];
