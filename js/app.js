import { MusicPlayer } from './player.js';
import { RoomManager } from './room.js';
import { AppUpdater } from './updater.js';
import { DEFAULT_TRACKS, createCustomTrack, createLocalFileTrack } from './tracks.js';

class HarmonyJamApp {
  constructor() {
    this.player = new MusicPlayer();
    this.room = new RoomManager(this.player);
    this.updater = new AppUpdater();

    this.deferredPrompt = null; // PWA install prompt

    this.initUI();
    this.initSubscriptions();
    this.initUpdater();
    this.renderTracksGrid();
    this.renderQueue();

    // Init Lucide icons
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  initUI() {
    // --- TAB SWITCHING ---
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const tabId = item.getAttribute('data-tab');
        this.switchTab(tabId);
      });
    });

    // --- FULL PLAYER DRAWER EXPAND / CLOSE ---
    const expandArea = document.getElementById('expandPlayerArea');
    const closePlayerBtn = document.getElementById('closePlayerBtn');
    const fullOverlay = document.getElementById('fullPlayerOverlay');

    expandArea.addEventListener('click', () => {
      fullOverlay.classList.add('open');
      this.player.initVisualizer(document.getElementById('visualizerCanvas'));
    });

    closePlayerBtn.addEventListener('click', () => {
      fullOverlay.classList.remove('open');
    });

    // --- PLAYBACK CONTROLS (MINI & FULL) ---
    const miniPlayBtn = document.getElementById('miniPlayBtn');
    const fullPlayBtn = document.getElementById('fullPlayBtn');
    const miniNextBtn = document.getElementById('miniNextBtn');
    const fullNextBtn = document.getElementById('fullNextBtn');
    const fullPrevBtn = document.getElementById('fullPrevBtn');

    const handlePlayToggle = (e) => {
      e.stopPropagation();
      if (this.room.roomId) {
        this.room.syncTogglePlay();
      } else {
        this.player.togglePlay();
      }
    };

    miniPlayBtn.addEventListener('click', handlePlayToggle);
    fullPlayBtn.addEventListener('click', handlePlayToggle);

    miniNextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.room.roomId ? this.room.syncNextTrack() : this.player.playNext();
    });

    fullNextBtn.addEventListener('click', () => {
      this.room.roomId ? this.room.syncNextTrack() : this.player.playNext();
    });

    fullPrevBtn.addEventListener('click', () => {
      this.room.roomId ? this.room.syncPrevTrack() : this.player.playPrevious();
    });

    // --- SEEK SCRUBBER SLIDER ---
    const seekSlider = document.getElementById('seekSlider');
    seekSlider.addEventListener('input', () => {
      const duration = this.player.audio.duration || (this.player.currentTrack ? this.player.currentTrack.duration : 0);
      if (duration > 0) {
        const targetSeconds = (seekSlider.value / 100) * duration;
        if (this.room.roomId) {
          this.room.syncSeek(targetSeconds);
        } else {
          this.player.seek(targetSeconds);
        }
      }
    });

    // --- INDIVIDUAL LOCAL VOLUME SLIDER ---
    const localVolumeSlider = document.getElementById('localVolumeSlider');
    const volumeMuteBtn = document.getElementById('volumeMuteBtn');

    // Set initial volume value
    localVolumeSlider.value = Math.round(this.player.volume * 100);

    localVolumeSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value) / 100;
      this.player.setVolume(val); // Does NOT affect other users in room!
    });

    volumeMuteBtn.addEventListener('click', () => {
      this.player.toggleMute();
      this.updateVolumeIcon();
    });

    // --- CUSTOM TRACK & FILE INPUTS ---
    const addCustomUrlBtn = document.getElementById('addCustomUrlBtn');
    const customUrlInput = document.getElementById('customUrlInput');
    const localFileInput = document.getElementById('localFileInput');

    addCustomUrlBtn.addEventListener('click', () => {
      const url = customUrlInput.value.trim();
      if (url) {
        const track = createCustomTrack(url);
        if (this.room.roomId) {
          this.room.syncQueueAdd(track);
        } else {
          this.player.addToQueue(track);
        }
        customUrlInput.value = '';
        this.renderQueue();
        alert(`Track "${track.title}" added to Queue!`);
      }
    });

    localFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const track = createLocalFileTrack(file);
        if (this.room.roomId) {
          this.room.syncQueueAdd(track);
        } else {
          this.player.addToQueue(track);
        }
        alert(`Local track "${track.title}" added to Queue!`);
      }
    });

    // --- JAM ROOM UI EVENT LISTENERS ---
    const createRoomBtn = document.getElementById('createRoomBtn');
    const joinRoomBtn = document.getElementById('joinRoomBtn');
    const joinCodeInput = document.getElementById('joinCodeInput');
    const leaveRoomBtn = document.getElementById('leaveRoomBtn');
    const copyRoomLinkBtn = document.getElementById('copyRoomLinkBtn');
    const showQrBtn = document.getElementById('showQrBtn');
    const headerRoomBtn = document.getElementById('headerRoomBtn');

    headerRoomBtn.addEventListener('click', () => {
      this.switchTab('tabRoom');
    });

    createRoomBtn.addEventListener('click', async () => {
      try {
        const code = await this.room.createRoom();
        console.log('Created room code:', code);
      } catch (e) {
        alert('Could not create room: ' + e.message);
      }
    });

    joinRoomBtn.addEventListener('click', async () => {
      const code = joinCodeInput.value.trim();
      if (code) {
        try {
          await this.room.joinRoom(code);
        } catch (e) {
          alert('Could not join room: ' + e.message);
        }
      }
    });

    leaveRoomBtn.addEventListener('click', () => {
      this.room.leaveRoom();
    });

    copyRoomLinkBtn.addEventListener('click', () => {
      const link = `${window.location.origin}${window.location.pathname}?room=${this.room.roomId}`;
      navigator.clipboard.writeText(link).then(() => {
        alert(`Room Code ${this.room.roomId} & Share Link copied!`);
      });
    });

    showQrBtn.addEventListener('click', () => {
      const link = `${window.location.origin}${window.location.pathname}?room=${this.room.roomId}`;
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(link)}`;
      document.getElementById('qrImage').src = qrUrl;
      document.getElementById('qrModal').classList.add('active');
    });

    document.getElementById('closeQrModalBtn').addEventListener('click', () => {
      document.getElementById('qrModal').classList.remove('active');
    });

    // Auto Join if room in URL params
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      const cleanParam = roomParam.replace(/[^0-9]/g, '');
      if (cleanParam) {
        this.switchTab('tabRoom');
        joinCodeInput.value = cleanParam;
        this.room.joinRoom(cleanParam);
      }
    }

    // --- SLEEP TIMER MODAL ---
    const openSleepTimerBtn = document.getElementById('openSleepTimerBtn');
    const fullSleepTimerBtn = document.getElementById('fullSleepTimerBtn');
    const sleepTimerModal = document.getElementById('sleepTimerModal');
    const closeTimerModalBtn = document.getElementById('closeTimerModalBtn');
    const turnOffTimerBtn = document.getElementById('turnOffTimerBtn');

    const openTimerModal = () => sleepTimerModal.classList.add('active');
    openSleepTimerBtn.addEventListener('click', openTimerModal);
    fullSleepTimerBtn.addEventListener('click', openTimerModal);

    closeTimerModalBtn.addEventListener('click', () => sleepTimerModal.classList.remove('active'));

    const timerButtons = document.querySelectorAll('.timer-btn');
    timerButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mins = parseInt(btn.getAttribute('data-minutes'));
        if (this.room.roomId) {
          this.room.syncSleepTimer(mins);
        } else {
          this.player.setSleepTimer(mins);
        }
        sleepTimerModal.classList.remove('active');
      });
    });

    turnOffTimerBtn.addEventListener('click', () => {
      if (this.room.roomId) {
        this.room.syncSleepTimer(0);
      } else {
        this.player.setSleepTimer(0);
      }
      sleepTimerModal.classList.remove('active');
    });

    // --- QUEUE CLEAR BUTTON ---
    document.getElementById('clearQueueBtn').addEventListener('click', () => {
      this.player.clearQueue();
    });

    // --- PWA INSTALL PROMPT ---
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      const installBtn = document.getElementById('pwaInstallBtn');
      if (installBtn) installBtn.style.display = 'flex';
    });

    document.getElementById('pwaInstallBtn').addEventListener('click', () => {
      if (this.deferredPrompt) {
        this.deferredPrompt.prompt();
        this.deferredPrompt.userChoice.then((choice) => {
          if (choice.outcome === 'accepted') {
            console.log('User installed Harmony Jam PWA');
          }
          this.deferredPrompt = null;
        });
      }
    });
  }

  switchTab(tabId) {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-tab') === tabId);
    });

    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === tabId);
    });

    if (tabId === 'tabQueue') {
      this.renderQueue();
    }
  }

  initSubscriptions() {
    // Player state subscriptions
    this.player.onTrackChange((track) => this.updateTrackDisplay(track));
    this.player.onStateChange((state) => this.updatePlayerState(state));
    this.player.onTimeUpdate((timeData) => this.updateTimeDisplay(timeData));
    this.player.onQueueChange(() => this.renderQueue());
    this.player.onSleepTimer((remainingSecs) => this.updateSleepTimerUI(remainingSecs));

    // Room subscriptions
    this.room.onRoomState((data) => this.updateRoomUI(data));
    this.room.onParticipants((list) => this.renderParticipants(list));
  }

  initUpdater() {
    this.updater.init();

    const checkUpdatesBtn = document.getElementById('checkUpdatesBtn');
    const githubRepoInput = document.getElementById('githubRepoInput');
    const saveRepoBtn = document.getElementById('saveRepoBtn');

    githubRepoInput.value = this.updater.githubRepo;

    saveRepoBtn.addEventListener('click', () => {
      const repoVal = githubRepoInput.value.trim();
      if (repoVal) {
        this.updater.setGitHubRepo(repoVal);
        alert('GitHub repository updated to: ' + repoVal);
      }
    });

    checkUpdatesBtn.addEventListener('click', () => {
      this.updater.checkForGitHubUpdates(true);
    });

    this.updater.onUpdateAvailable((data) => {
      document.getElementById('currentVersionLabel').innerText = `Current: v${data.currentVersion} | Latest: v${data.latestVersion}`;
      document.getElementById('updateModalSubtitle').innerText = `v${data.latestVersion} Ready`;
      document.getElementById('updateChangelog').innerText = data.releaseNotes || data.message;
      document.getElementById('updateModal').classList.add('active');
    });

    document.getElementById('applyUpdateBtn').addEventListener('click', () => {
      this.updater.applyUpdate();
    });

    document.getElementById('dismissUpdateBtn').addEventListener('click', () => {
      document.getElementById('updateModal').classList.remove('active');
    });
  }

  renderTracksGrid() {
    const grid = document.getElementById('tracksGrid');
    grid.innerHTML = '';

    DEFAULT_TRACKS.forEach((track, index) => {
      const card = document.createElement('div');
      card.className = 'music-card';
      const isYt = track.type === 'youtube';
      card.innerHTML = `
        <div class="card-img-wrapper">
          <img src="${track.cover}" alt="${track.title}" loading="lazy">
          ${isYt ? '<span style="position:absolute; top:6px; left:6px; background:#ff0000; color:#fff; font-size:0.65rem; font-weight:800; padding:2px 6px; border-radius:4px; z-index:2;">YOUTUBE</span>' : ''}
          <button class="play-hover-btn">
            <i data-lucide="play"></i>
          </button>
        </div>
        <div class="card-title">${track.title}</div>
        <div class="card-subtitle">${track.artist}</div>
      `;

      card.addEventListener('click', () => {
        if (this.room.roomId) {
          this.room.syncTrackChange(index);
        } else {
          this.player.loadTrack(index, true);
        }
      });

      grid.appendChild(card);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  renderQueue() {
    const container = document.getElementById('queueContainer');
    container.innerHTML = '';

    if (this.player.queue.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 20px;">Queue is empty</div>`;
      return;
    }

    this.player.queue.forEach((track, idx) => {
      const isCurrent = idx === this.player.currentTrackIndex;
      const isYt = track.type === 'youtube';
      const item = document.createElement('div');
      item.className = `queue-item ${isCurrent ? 'active-track' : ''}`;
      item.innerHTML = `
        <div class="queue-item-left">
          <img src="${track.cover}" class="queue-thumb">
          <div class="queue-details">
            <div class="queue-title">${track.title} ${isCurrent ? '<span style="color: var(--accent-green-bright); font-size: 0.75rem;">(Now Playing)</span>' : ''}</div>
            <div class="queue-artist">${isYt ? '<span style="color:#ff4d4d; font-size:0.72rem; font-weight:700; margin-right:4px;">▶ YouTube</span>' : ''}${track.artist}</div>
          </div>
        </div>
        <button class="icon-btn remove-btn" style="width: 32px; height: 32px; border: none; background: transparent;" title="Remove">
          <i data-lucide="x" style="width: 16px;"></i>
        </button>
      `;

      item.querySelector('.queue-item-left').addEventListener('click', () => {
        if (this.room.roomId) {
          this.room.syncTrackChange(idx);
        } else {
          this.player.loadTrack(idx, true);
        }
      });

      item.querySelector('.remove-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.room.roomId) {
          this.room.syncQueueRemove(idx);
        } else {
          this.player.removeFromQueue(idx);
        }
      });

      container.appendChild(item);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  updateTrackDisplay(track) {
    if (!track) return;

    document.getElementById('miniCover').src = track.cover;
    document.getElementById('miniTitle').innerText = track.title;
    document.getElementById('miniArtist').innerText = track.artist;

    document.getElementById('fullCover').src = track.cover;
    document.getElementById('fullTitle').innerText = track.title;
    document.getElementById('fullArtist').innerText = track.artist;

    // Update dynamic ambient background glow
    document.getElementById('ambientGlow').style.background = `radial-gradient(circle at center, rgba(29, 185, 84, 0.25), transparent 70%)`;
  }

  updatePlayerState(state) {
    const playIconHtml = state.isPlaying ? '<i data-lucide="pause" style="fill: currentColor;"></i>' : '<i data-lucide="play" style="fill: currentColor; margin-left: 2px;"></i>';
    
    document.getElementById('miniPlayBtn').innerHTML = playIconHtml;
    document.getElementById('fullPlayBtn').innerHTML = playIconHtml;

    if (window.lucide) window.lucide.createIcons();
  }

  updateTimeDisplay(timeData) {
    const current = timeData.currentTime || 0;
    const total = timeData.duration || 0;

    const currentFormatted = this.formatTime(current);
    const totalFormatted = this.formatTime(total);

    document.getElementById('currentTimeLabel').innerText = currentFormatted;
    document.getElementById('durationLabel').innerText = totalFormatted;

    if (total > 0) {
      const percentage = (current / total) * 100;
      document.getElementById('seekSlider').value = percentage;
      document.getElementById('miniProgressBar').style.width = `${percentage}%`;
    }
  }

  updateVolumeIcon() {
    const icon = document.getElementById('volumeIcon');
    if (this.player.isMuted || this.player.volume === 0) {
      icon.setAttribute('data-lucide', 'volume-x');
    } else if (this.player.volume < 0.5) {
      icon.setAttribute('data-lucide', 'volume-1');
    } else {
      icon.setAttribute('data-lucide', 'volume-2');
    }
    if (window.lucide) window.lucide.createIcons();
  }

  updateSleepTimerUI(remainingSecs) {
    const pill = document.getElementById('sleepTimerPill');
    const countdownLabel = document.getElementById('sleepTimerCountdown');

    if (remainingSecs > 0) {
      pill.style.display = 'inline-flex';
      countdownLabel.innerText = this.formatTime(remainingSecs);
    } else {
      pill.style.display = 'none';
    }
  }

  updateRoomUI(data) {
    const notJoined = document.getElementById('roomNotJoinedState');
    const joined = document.getElementById('roomJoinedState');
    const badge = document.getElementById('headerRoomBadge');
    const activeCode = document.getElementById('activeRoomCode');
    const roleText = document.getElementById('roomRoleText');
    const headerCodeText = document.getElementById('headerRoomCodeText');

    if (data.roomId) {
      notJoined.style.display = 'none';
      joined.style.display = 'block';
      badge.style.display = 'flex';
      activeCode.innerText = data.roomId;
      headerCodeText.innerText = data.roomId;
      roleText.innerText = data.isHost ? 'Host Session (Synchronizing peers)' : 'Connected Peer';
    } else {
      notJoined.style.display = 'block';
      joined.style.display = 'none';
      badge.style.display = 'none';
    }
  }

  renderParticipants(list) {
    const container = document.getElementById('participantList');
    container.innerHTML = '';

    const countLabel = document.getElementById('roomRoleText');
    if (countLabel && this.room.roomId) {
      countLabel.innerHTML = `<i data-lucide="users" style="width:14px; display:inline-block; vertical-align:middle;"></i> ${list.length} ${list.length === 1 ? 'Person' : 'People'} Connected`;
      if (window.lucide) window.lucide.createIcons();
    }

    list.forEach(p => {
      const item = document.createElement('div');
      item.className = 'participant-item';
      item.innerHTML = `
        <div class="participant-info">
          <img src="${p.avatar}" class="participant-avatar">
          <span class="participant-name">${p.name}</span>
        </div>
        ${p.isHost ? '<span class="host-badge">HOST</span>' : '<span style="font-size:0.75rem; color:var(--accent-green-bright); font-weight:600;">🟢 Active</span>'}
      `;
      container.appendChild(item);
    });
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
}

// Instantiate App when DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new HarmonyJamApp();
});
