// Curated list of high quality royalty-free music streams
export const DEFAULT_TRACKS = [
  {
    id: 'track-1',
    title: 'Midnight Chill Lofi',
    artist: 'Lofi Beats Co.',
    album: 'Nightowl Sessions',
    duration: 164, // seconds
    cover: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=600&auto=format&fit=crop&q=80',
    src: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112191.mp3',
    genre: 'Lofi / Chill'
  },
  {
    id: 'track-2',
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
    title: 'Deep House Sunset',
    artist: 'Ibiza Club Grooves',
    album: 'Summer Horizon',
    duration: 188,
    cover: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80',
    src: 'https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3?filename=tropical-house-113337.mp3',
    genre: 'Electronic'
  },
  {
    id: 'track-5',
    title: 'Starlight Ambient Dreams',
    artist: 'Celestial Echoes',
    album: 'Cosmic Drift',
    duration: 240,
    cover: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?w=600&auto=format&fit=crop&q=80',
    src: 'https://cdn.pixabay.com/download/audio/2022/02/07/audio_82335198d0.mp3?filename=relaxing-ambient-116198.mp3',
    genre: 'Ambient'
  },
  {
    id: 'track-6',
    title: 'Tokyo Rain Alley',
    artist: 'Shibuya Beats',
    album: 'Midnight City Walk',
    duration: 175,
    cover: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80',
    src: 'https://cdn.pixabay.com/download/audio/2022/05/16/audio_db6591201e.mp3?filename=japanese-lofi-hip-hop-111624.mp3',
    genre: 'Lofi / Jazz'
  }
];

export function createCustomTrack(url, title = 'Custom Audio Stream', artist = 'Web Audio Source') {
  return {
    id: 'custom-' + Date.now(),
    title: title,
    artist: artist,
    album: 'Custom Link',
    duration: 0, // Will be set on metadata load
    cover: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=600&auto=format&fit=crop&q=80',
    src: url,
    genre: 'Custom Stream'
  };
}

export function createLocalFileTrack(file) {
  const objectUrl = URL.createObjectURL(file);
  return {
    id: 'file-' + Date.now(),
    title: file.name.replace(/\.[^/.]+$/, ""),
    artist: 'Local File',
    album: 'Uploaded Track',
    duration: 0,
    cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
    src: objectUrl,
    genre: 'Local Audio'
  };
}
