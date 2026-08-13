// Harmony Jam Bulletproof Real-Time Sync Engine (Google Firebase Realtime Database Engine)

export class RoomManager {
  constructor(player) {
    this.player = player;
    this.roomId = null; // Clean 4-digit code (e.g. "4892")
    this.isHost = false;

    // Persistent User ID per browser session
    let savedUserId = sessionStorage.getItem('hj_user_id');
    if (!savedUserId) {
      savedUserId = 'u_' + Math.random().toString(36).substr(2, 9);
      sessionStorage.setItem('hj_user_id', savedUserId);
    }
    this.userId = savedUserId;
    this.userName = localStorage.getItem('hj_username') || `User_${Math.floor(1000 + Math.random() * 9000)}`;

    this.participants = new Map();
    this.eventSource = null;
    this.broadcastChannel = null;

    this.onRoomStateCallbacks = [];
    this.onParticipantsCallbacks = [];
    this.onStatusCallbacks = [];

    this.firebaseBaseUrl = 'https://harmony-jam-default-rtdb.firebaseio.com/rooms';

    // Periodic Heartbeat to maintain online status & sync drift
    setInterval(() => {
      if (this.roomId) {
        this.sendHeartbeat();
      }
    }, 4000);
  }

  getSelfUserObj() {
    return {
      id: this.userId,
      name: this.isHost ? `${this.userName} (Host)` : this.userName,
      isHost: this.isHost,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(this.userName)}`,
      lastSeen: Date.now()
    };
  }

  generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  // --- FIREBASE SSE REALTIME STREAM ---
  initRealtimeStream(code) {
    if (this.eventSource) {
      try { this.eventSource.close(); } catch(e){}
    }

    const streamUrl = `${this.firebaseBaseUrl}/${code}.json`;
    console.log('[Realtime] Opening SSE Stream to Google Cloud:', streamUrl);
    this.setStatus('CONNECTING', false);

    try {
      this.eventSource = new EventSource(streamUrl);

      this.eventSource.onopen = () => {
        console.log('[Realtime] Connected to room stream successfully!');
        this.setStatus('CONNECTED', true);
      };

      this.eventSource.onerror = (err) => {
        console.warn('[Realtime] Stream error, retrying...', err);
        this.setStatus('RECONNECTING...', false);
      };

      // Listen for data updates pushed from Google Cloud
      this.eventSource.addEventListener('put', (e) => {
        try {
          const payload = JSON.parse(e.data);
          this.handleServerUpdate(payload.path, payload.data);
        } catch (err) {
          console.warn('[Realtime] Error parsing stream event:', err);
        }
      });

      this.eventSource.addEventListener('patch', (e) => {
        try {
          const payload = JSON.parse(e.data);
          this.handleServerUpdate(payload.path, payload.data);
        } catch (err) {
          console.warn('[Realtime] Error parsing patch event:', err);
        }
      });

    } catch (e) {
      console.warn('[Realtime] EventSource exception:', e);
    }
  }

  // --- CREATE ROOM (HOST) ---
  createRoom(customCode = null) {
    return new Promise(async (resolve) => {
      const code = customCode ? customCode.toString().replace(/[^0-9]/g, '') : this.generateRoomCode();
      this.roomId = code;
      this.isHost = true;

      this.initBroadcastChannel(code);
      this.initRealtimeStream(code);

      this.participants.clear();
      const selfObj = this.getSelfUserObj();
      this.participants.set(this.userId, selfObj);

      const initialRoomState = {
        code: code,
        hostId: this.userId,
        createdAt: Date.now(),
        playback: {
          trackIndex: this.player.currentTrackIndex,
          isPlaying: false,
          currentTime: 0,
          senderId: this.userId,
          updatedAt: Date.now()
        },
        queue: this.player.queue,
        participants: {
          [this.userId]: selfObj
        }
      };

      try {
        await fetch(`${this.firebaseBaseUrl}/${code}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(initialRoomState)
        });
        console.log('[Realtime] Host created room in database:', code);
      } catch (e) {
        console.warn('[Realtime] Failed to write room state:', e);
      }

      this.emitParticipants();
      this.emitRoomState();
      resolve(code);
    });
  }

  // --- JOIN ROOM (PEER / MOBILE) ---
  joinRoom(inputCode) {
    return new Promise(async (resolve, reject) => {
      const cleanCode = inputCode.toString().replace(/[^0-9]/g, '');
      if (!cleanCode || cleanCode.length < 3) {
        return reject(new Error('Please enter a valid 4-digit room code (e.g. 4892)'));
      }

      this.roomId = cleanCode;
      this.isHost = false;

      this.initBroadcastChannel(cleanCode);
      this.initRealtimeStream(cleanCode);

      this.participants.clear();
      const selfObj = this.getSelfUserObj();
      this.participants.set(this.userId, selfObj);

      // 1. Fetch current room state from database
      try {
        const res = await fetch(`${this.firebaseBaseUrl}/${cleanCode}.json`);
        if (res.ok) {
          const roomData = await res.json();
          if (roomData) {
            this.handleFullRoomSnapshot(roomData);
          }
        }
      } catch (e) {
        console.warn('[Realtime] Could not fetch room snapshot:', e);
      }

      // 2. Register participant in database
      try {
        await fetch(`${this.firebaseBaseUrl}/${cleanCode}/participants/${this.userId}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(selfObj)
        });
        console.log('[Realtime] Joined participant registered:', this.userId);
      } catch (e) {
        console.warn('[Realtime] Participant registration error:', e);
      }

      this.emitParticipants();
      this.emitRoomState();
      resolve(cleanCode);
    });
  }

  // --- HANDLE INCOMING DATABASE UPDATES ---
  handleServerUpdate(path, data) {
    if (!data) return;

    // Full Room Snapshot (path === "/")
    if (path === '/' && typeof data === 'object') {
      this.handleFullRoomSnapshot(data);
      return;
    }

    // Participants Update
    if (path.startsWith('/participants')) {
      if (path === '/participants' && typeof data === 'object') {
        this.updateParticipantsMap(data);
      } else {
        const parts = path.split('/');
        const participantId = parts[2];
        if (participantId && typeof data === 'object') {
          this.participants.set(participantId, { ...data, lastSeen: Date.now() });
          this.emitParticipants();
        }
      }
    }

    // Playback State Update
    if (path.startsWith('/playback') && typeof data === 'object') {
      this.handlePlaybackChange(data);
    }

    // Queue Update
    if (path === '/queue' && Array.isArray(data)) {
      this.player.queue = data;
      this.player.emitQueueChange();
    }

    // Live Emoji Reaction Update
    if (path.startsWith('/reaction') && typeof data === 'object') {
      if (data.emoji && data.senderId !== this.userId) {
        this.emitEmoji(data.emoji, data.senderName);
      }
    }
  }

  handleFullRoomSnapshot(roomData) {
    if (roomData.participants) {
      this.updateParticipantsMap(roomData.participants);
    }
    if (roomData.queue) {
      this.player.queue = roomData.queue;
      this.player.emitQueueChange();
    }
    if (roomData.playback) {
      this.handlePlaybackChange(roomData.playback);
    }
  }

  updateParticipantsMap(participantsObj) {
    const now = Date.now();
    Object.keys(participantsObj).forEach(id => {
      const p = participantsObj[id];
      if (p) {
        this.participants.set(id, { ...p, lastSeen: now });
      }
    });
    this.emitParticipants();
  }

  handlePlaybackChange(playback) {
    if (!playback) return;
    if (playback.senderId === this.userId) return; // Ignore self updates

    console.log('[Realtime] Playback update:', playback);

    if (playback.trackIndex !== undefined && playback.trackIndex !== this.player.currentTrackIndex) {
      this.player.loadTrack(playback.trackIndex, playback.isPlaying !== false);
    } else {
      if (playback.isPlaying !== undefined && playback.isPlaying !== this.player.isPlaying) {
        playback.isPlaying ? this.player.play() : this.player.pause();
      }
    }

    if (playback.currentTime !== undefined && playback.currentTime >= 0) {
      const current = this.player.getCurrentTime();
      const diff = Math.abs(current - playback.currentTime);
      if (diff > 1.5) {
        this.player.seek(playback.currentTime);
      }
    }
  }

  // --- ACTIONS (PLAY / PAUSE / SEEK / TRACK / QUEUE) ---
  syncPlay() {
    this.player.play();
    this.updatePlaybackState({
      trackIndex: this.player.currentTrackIndex,
      isPlaying: true,
      currentTime: this.player.getCurrentTime()
    });
  }

  syncPause() {
    this.player.pause();
    this.updatePlaybackState({
      trackIndex: this.player.currentTrackIndex,
      isPlaying: false,
      currentTime: this.player.getCurrentTime()
    });
  }

  syncTogglePlay() {
    if (this.player.isPlaying) {
      this.syncPause();
    } else {
      this.syncPlay();
    }
  }

  syncSeek(seconds) {
    this.player.seek(seconds);
    this.updatePlaybackState({
      trackIndex: this.player.currentTrackIndex,
      isPlaying: this.player.isPlaying,
      currentTime: seconds
    });
  }

  syncTrackChange(index) {
    this.player.loadTrack(index, true);
    this.updatePlaybackState({
      trackIndex: index,
      isPlaying: true,
      currentTime: 0
    });
    // Also push queue to ensure synced state
    this.updateQueueState(this.player.queue);
  }

  syncNextTrack() {
    let nextIndex = this.player.currentTrackIndex + 1;
    if (nextIndex >= this.player.queue.length) nextIndex = 0;
    this.syncTrackChange(nextIndex);
  }

  syncPrevTrack() {
    if (this.player.getCurrentTime() > 3) {
      this.syncSeek(0);
      return;
    }
    let prevIndex = this.player.currentTrackIndex - 1;
    if (prevIndex < 0) prevIndex = this.player.queue.length - 1;
    this.syncTrackChange(prevIndex);
  }

  syncQueueAdd(track) {
    this.player.addToQueue(track);
    this.updateQueueState(this.player.queue);
  }

  syncQueueRemove(index) {
    this.player.removeFromQueue(index);
    this.updateQueueState(this.player.queue);
  }

  syncSleepTimer(minutes) {
    this.player.setSleepTimer(minutes);
  }

  // --- DATABASE HELPERS ---
  async updatePlaybackState(playbackObj) {
    if (!this.roomId) return;
    const payload = {
      ...playbackObj,
      senderId: this.userId,
      updatedAt: Date.now()
    };

    // Broadcast to local tabs via BroadcastChannel
    if (this.broadcastChannel) {
      try { this.broadcastChannel.postMessage({ type: 'SYNC_PLAYBACK', playback: payload }); } catch(e){}
    }

    try {
      await fetch(`${this.firebaseBaseUrl}/${this.roomId}/playback.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.warn('[Realtime] Failed to update playback:', e);
    }
  }

  async updateQueueState(queueArray) {
    if (!this.roomId) return;
    try {
      await fetch(`${this.firebaseBaseUrl}/${this.roomId}/queue.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(queueArray)
      });
    } catch (e) {
      console.warn('[Realtime] Failed to update queue:', e);
    }
  }

  async sendHeartbeat() {
    if (!this.roomId) return;
    try {
      await fetch(`${this.firebaseBaseUrl}/${this.roomId}/participants/${this.userId}/lastSeen.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Date.now())
      });
    } catch (e) {
      // Ignore heartbeat errors
    }
  }

  initBroadcastChannel(code) {
    if (this.broadcastChannel) {
      try { this.broadcastChannel.close(); } catch(e){}
    }
    try {
      this.broadcastChannel = new BroadcastChannel(`harmony_jam_v4_${code}`);
      this.broadcastChannel.onmessage = (event) => {
        if (event.data && event.data.type === 'SYNC_PLAYBACK') {
          this.handlePlaybackChange(event.data.playback);
        }
      };
    } catch (e) {}
  }

  setStatus(text, connected) {
    this.connectionStatus = text;
    this.onStatusCallbacks.forEach(cb => cb(text, connected));
  }

  leaveRoom() {
    if (this.eventSource) {
      try { this.eventSource.close(); } catch(e){}
      this.eventSource = null;
    }
    if (this.broadcastChannel) {
      try { this.broadcastChannel.close(); } catch(e){}
      this.broadcastChannel = null;
    }
    if (this.roomId) {
      try {
        fetch(`${this.firebaseBaseUrl}/${this.roomId}/participants/${this.userId}.json`, { method: 'DELETE' });
      } catch (e) {}
    }

    this.roomId = null;
    this.isHost = false;
    this.participants.clear();
    this.setStatus('DISCONNECTED', false);
    this.emitRoomState();
    this.emitParticipants();
  }

  onRoomState(cb) { this.onRoomStateCallbacks.push(cb); }
  onParticipants(cb) { this.onParticipantsCallbacks.push(cb); }
  onStatus(cb) { this.onStatusCallbacks.push(cb); }

  emitRoomState() {
    const data = {
      roomId: this.roomId,
      isHost: this.isHost,
      userName: this.userName
    };
    this.onRoomStateCallbacks.forEach(cb => cb(data));
  }

  emitParticipants() {
    const list = Array.from(this.participants.values());
    this.onParticipantsCallbacks.forEach(cb => cb(list));
  }
}
