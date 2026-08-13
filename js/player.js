import { DEFAULT_TRACKS } from './tracks.js';

export class MusicPlayer {
  constructor() {
    // HTML5 Audio Engine
    this.audio = new Audio();
    this.audio.crossOrigin = 'anonymous';

    // YouTube IFrame Player Engine
    this.ytPlayer = null;
    this.ytReady = false;
    this.ytPendingVideoId = null;

    this.tracks = [...DEFAULT_TRACKS];
    this.queue = [...DEFAULT_TRACKS];
    this.currentTrackIndex = 0;
    this.isPlaying = false;

    // Individual Local Volume (0 to 1) - Saved locally per user device
    const savedVol = localStorage.getItem('hj_individual_volume');
    this.volume = savedVol !== null ? parseFloat(savedVol) : 0.8;
    this.audio.volume = this.volume;
    this.isMuted = false;

    // Sleep Timer
    this.sleepTimerDuration = 0;
    this.sleepTimerInterval = null;
    this.sleepTimerOriginalVolume = this.volume;

    // Callbacks
    this.onTrackChangeCallbacks = [];
    this.onStateChangeCallbacks = [];
    this.onQueueChangeCallbacks = [];
    this.onTimeUpdateCallbacks = [];
    this.onSleepTimerCallbacks = [];

    // Web Audio API Visualizer setup
    this.audioCtx = null;
    this.analyser = null;
    this.sourceNode = null;

    this.initAudioEvents();
    this.initYouTubeAPI();

    // High frequency timeupdate polling interval for YouTube player & HTML5 sync
    this.progressPollInterval = setInterval(() => {
      if (this.isPlaying) {
        this.emitTimeUpdate();
      }
    }, 500);
  }

  initAudioEvents() {
    this.audio.addEventListener('ended', () => {
      this.playNext(true);
    });

    this.audio.addEventListener('timeupdate', () => {
      if (this.currentEngine === 'audio') {
        this.emitTimeUpdate();
      }
    });

    this.audio.addEventListener('loadedmetadata', () => {
      if (this.currentTrack && this.currentEngine === 'audio') {
        this.currentTrack.duration = Math.floor(this.audio.duration) || this.currentTrack.duration || 0;
        this.emitStateChange();
      }
    });
  }

  initYouTubeAPI() {
    window.onYouTubeIframeAPIReady = () => {
      console.log('[YouTube API] Ready');
      this.ytPlayer = new window.YT.Player('ytPlayerIFrame', {
        height: '100%',
        width: '100%',
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0
        },
        events: {
          onReady: (event) => {
            this.ytReady = true;
            this.ytPlayer.setVolume(Math.round(this.volume * 100));
            if (this.ytPendingVideoId) {
              this.ytPlayer.loadVideoById(this.ytPendingVideoId);
              this.ytPendingVideoId = null;
            }
          },
          onStateChange: (event) => {
            // YT.PlayerState.ENDED = 0, PLAYING = 1, PAUSED = 2
            if (event.data === window.YT.PlayerState.ENDED) {
              this.playNext(true);
            } else if (event.data === window.YT.PlayerState.PLAYING) {
              this.isPlaying = true;
              this.emitStateChange();
            } else if (event.data === window.YT.PlayerState.PAUSED) {
              this.isPlaying = false;
              this.emitStateChange();
            }
          }
        }
      });
    };

    // Load API Script if not already loaded
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }
  }

  get currentEngine() {
    const track = this.currentTrack;
    return (track && track.type === 'youtube') ? 'youtube' : 'audio';
  }

  get currentTrack() {
    return this.queue[this.currentTrackIndex] || null;
  }

  getCurrentTime() {
    if (this.currentEngine === 'youtube' && this.ytReady && this.ytPlayer && typeof this.ytPlayer.getCurrentTime === 'function') {
      return this.ytPlayer.getCurrentTime() || 0;
    }
    return this.audio.currentTime || 0;
  }

  getDuration() {
    if (this.currentEngine === 'youtube' && this.ytReady && this.ytPlayer && typeof this.ytPlayer.getDuration === 'function') {
      return this.ytPlayer.getDuration() || (this.currentTrack ? this.currentTrack.duration : 0);
    }
    return this.audio.duration || (this.currentTrack ? this.currentTrack.duration : 0);
  }

  loadTrack(index, autoPlay = true) {
    if (index < 0 || index >= this.queue.length) return;

    // Pause current playing audio before switching
    if (this.isPlaying) {
      this.pause();
    }

    this.currentTrackIndex = index;
    const track = this.currentTrack;
    if (!track) return;

    console.log('[Player] Loading track index:', index, track.title, track.type);

    if (track.type === 'youtube') {
      // Pause HTML5 audio
      this.audio.pause();
      this.audio.src = '';

      if (this.ytReady && this.ytPlayer) {
        if (autoPlay) {
          this.ytPlayer.loadVideoById(track.youtubeId);
          this.isPlaying = true;
        } else {
          this.ytPlayer.cueVideoById(track.youtubeId);
          this.isPlaying = false;
        }
      } else {
        this.ytPendingVideoId = track.youtubeId;
      }
    } else {
      // Pause YouTube player if active
      if (this.ytReady && this.ytPlayer && typeof this.ytPlayer.pauseVideo === 'function') {
        this.ytPlayer.pauseVideo();
      }

      this.audio.src = track.src;
      this.audio.load();
      if (autoPlay) {
        this.play();
      } else {
        this.pause();
      }
    }

    this.emitTrackChange(track);
    this.emitStateChange();
  }

  play() {
    const track = this.currentTrack;
    if (!track && this.queue.length > 0) {
      this.loadTrack(0, true);
      return;
    }

    if (this.currentEngine === 'youtube') {
      if (this.ytReady && this.ytPlayer && typeof this.ytPlayer.playVideo === 'function') {
        this.ytPlayer.playVideo();
        this.isPlaying = true;
        this.emitStateChange();
      }
    } else {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      this.audio.play().then(() => {
        this.isPlaying = true;
        this.emitStateChange();
      }).catch(err => {
        console.warn('HTML5 Play interrupted:', err);
        this.isPlaying = false;
        this.emitStateChange();
      });
    }
  }

  pause() {
    if (this.currentEngine === 'youtube') {
      if (this.ytReady && this.ytPlayer && typeof this.ytPlayer.pauseVideo === 'function') {
        this.ytPlayer.pauseVideo();
      }
    } else {
      this.audio.pause();
    }
    this.isPlaying = false;
    this.emitStateChange();
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  seek(seconds) {
    if (seconds < 0) seconds = 0;

    if (this.currentEngine === 'youtube') {
      if (this.ytReady && this.ytPlayer && typeof this.ytPlayer.seekTo === 'function') {
        this.ytPlayer.seekTo(seconds, true);
      }
    } else {
      if (this.audio.duration) {
        this.audio.currentTime = seconds;
      }
    }
    this.emitTimeUpdate();
  }

  playNext(isAuto = false) {
    if (this.queue.length === 0) return;
    let nextIndex = this.currentTrackIndex + 1;
    if (nextIndex >= this.queue.length) {
      nextIndex = 0;
    }
    this.loadTrack(nextIndex, true);
  }

  playPrevious() {
    if (this.queue.length === 0) return;
    if (this.getCurrentTime() > 3) {
      this.seek(0);
      return;
    }
    let prevIndex = this.currentTrackIndex - 1;
    if (prevIndex < 0) {
      prevIndex = this.queue.length - 1;
    }
    this.loadTrack(prevIndex, true);
  }

  // --- INDIVIDUAL LOCAL VOLUME CONTROL ---
  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    localStorage.setItem('hj_individual_volume', this.volume.toString());

    const effectiveVol = this.isMuted ? 0 : this.volume;
    this.audio.volume = effectiveVol;

    if (this.ytReady && this.ytPlayer && typeof this.ytPlayer.setVolume === 'function') {
      this.ytPlayer.setVolume(Math.round(effectiveVol * 100));
    }
    this.emitStateChange();
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    const effectiveVol = this.isMuted ? 0 : this.volume;
    this.audio.volume = effectiveVol;

    if (this.ytReady && this.ytPlayer && typeof this.ytPlayer.setVolume === 'function') {
      this.ytPlayer.setVolume(Math.round(effectiveVol * 100));
    }
    this.emitStateChange();
  }

  // --- QUEUE MANAGEMENT ---
  addToQueue(track) {
    this.queue.push(track);
    this.emitQueueChange();
  }

  removeFromQueue(index) {
    if (index === this.currentTrackIndex) {
      this.queue.splice(index, 1);
      if (this.queue.length === 0) {
        this.pause();
        this.audio.src = '';
      } else {
        this.loadTrack(Math.min(index, this.queue.length - 1), this.isPlaying);
      }
    } else {
      if (index < this.currentTrackIndex) {
        this.currentTrackIndex--;
      }
      this.queue.splice(index, 1);
    }
    this.emitQueueChange();
  }

  clearQueue() {
    const current = this.currentTrack;
    this.queue = current ? [current] : [];
    this.currentTrackIndex = 0;
    this.emitQueueChange();
  }

  // --- SLEEP TIMER ---
  setSleepTimer(minutes) {
    if (this.sleepTimerInterval) {
      clearInterval(this.sleepTimerInterval);
      this.sleepTimerInterval = null;
    }

    if (minutes <= 0) {
      this.sleepTimerDuration = 0;
      this.emitSleepTimer();
      return;
    }

    this.sleepTimerDuration = minutes * 60;
    this.sleepTimerOriginalVolume = this.volume;
    this.emitSleepTimer();

    this.sleepTimerInterval = setInterval(() => {
      this.sleepTimerDuration--;

      if (this.sleepTimerDuration > 0 && this.sleepTimerDuration <= 10) {
        const fadeRatio = this.sleepTimerDuration / 10;
        this.setVolume(this.sleepTimerOriginalVolume * fadeRatio);
      }

      if (this.sleepTimerDuration <= 0) {
        clearInterval(this.sleepTimerInterval);
        this.sleepTimerInterval = null;
        this.pause();
        this.setVolume(this.sleepTimerOriginalVolume);
        this.sleepTimerDuration = 0;
      }

      this.emitSleepTimer();
    }, 1000);
  }

  initVisualizer(canvasElement) {
    if (!canvasElement) return;
    this.canvas = canvasElement;
    this.canvasCtx = canvasElement.getContext('2d');

    const setupAudioCtx = () => {
      if (!this.audioCtx) {
        try {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          this.audioCtx = new AudioContext();
          this.analyser = this.audioCtx.createAnalyser();
          this.analyser.fftSize = 64;
          this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);
          this.sourceNode.connect(this.analyser);
          this.analyser.connect(this.audioCtx.destination);
          this.drawVisualizer();
        } catch (e) {
          console.warn('Web Audio API Visualizer fallback:', e);
        }
      }
    };

    window.addEventListener('click', setupAudioCtx, { once: true });
    window.addEventListener('touchstart', setupAudioCtx, { once: true });
  }

  drawVisualizer() {
    if (!this.analyser || !this.canvasCtx) return;
    requestAnimationFrame(() => this.drawVisualizer());

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);

    const width = this.canvas.width;
    const height = this.canvas.height;
    this.canvasCtx.clearRect(0, 0, width, height);

    const barWidth = (width / bufferLength) * 1.8;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * height * 0.85;
      const gradient = this.canvasCtx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, 'rgba(29, 185, 84, 0.2)');
      gradient.addColorStop(0.5, 'rgba(29, 185, 84, 0.8)');
      gradient.addColorStop(1, 'rgba(30, 215, 96, 1)');

      this.canvasCtx.fillStyle = gradient;
      this.canvasCtx.fillRect(x, height - barHeight, barWidth - 2, barHeight);
      x += barWidth;
    }
  }

  // --- CALLBACK EMITTERS ---
  onTrackChange(cb) { this.onTrackChangeCallbacks.push(cb); }
  onStateChange(cb) { this.onStateChangeCallbacks.push(cb); }
  onQueueChange(cb) { this.onQueueChangeCallbacks.push(cb); }
  onTimeUpdate(cb) { this.onTimeUpdateCallbacks.push(cb); }
  onSleepTimer(cb) { this.onSleepTimerCallbacks.push(cb); }

  emitTrackChange(track) { this.onTrackChangeCallbacks.forEach(cb => cb(track)); }
  emitStateChange() {
    const state = {
      isPlaying: this.isPlaying,
      volume: this.volume,
      isMuted: this.isMuted,
      currentTime: this.getCurrentTime(),
      duration: this.getDuration()
    };
    this.onStateChangeCallbacks.forEach(cb => cb(state));
  }
  emitQueueChange() { this.onQueueChangeCallbacks.forEach(cb => cb(this.queue, this.currentTrackIndex)); }
  emitTimeUpdate() {
    const timeData = {
      currentTime: this.getCurrentTime(),
      duration: this.getDuration()
    };
    this.onTimeUpdateCallbacks.forEach(cb => cb(timeData));
  }
  emitSleepTimer() { this.onSleepTimerCallbacks.forEach(cb => cb(this.sleepTimerDuration)); }
}
