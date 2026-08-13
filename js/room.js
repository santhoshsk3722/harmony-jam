// PeerJS P2P & BroadcastChannel Sync Engine for Harmony Jam

export class RoomManager {
  constructor(player) {
    this.player = player;
    this.peer = null;
    this.peerId = null;
    this.roomId = null;
    this.isHost = false;
    this.connections = []; // PeerJS DataConnections
    this.broadcastChannel = null;

    this.userName = localStorage.getItem('hj_username') || `User_${Math.floor(1000 + Math.random() * 9000)}`;
    this.participants = new Map(); // id -> { name, isHost, avatar }

    this.onRoomStateCallbacks = [];
    this.onParticipantsCallbacks = [];

    this.initBroadcastChannel();
  }

  initBroadcastChannel() {
    try {
      this.broadcastChannel = new BroadcastChannel('harmony_jam_channel');
      this.broadcastChannel.onmessage = (event) => {
        this.handleIncomingAction(event.data, 'broadcast');
      };
    } catch (e) {
      console.warn('BroadcastChannel not supported in this environment');
    }
  }

  // Generate clean 6-character room code (e.g. HJ-9412)
  generateRoomCode() {
    const num = Math.floor(1000 + Math.random() * 9000);
    return `HJ-${num}`;
  }

  // Create a new Jam Room as Host
  createRoom() {
    return new Promise((resolve, reject) => {
      const code = this.generateRoomCode();
      this.roomId = code;
      this.isHost = true;

      // Add self to participants
      this.participants.clear();
      this.participants.set('self', {
        id: 'self',
        name: this.userName + ' (Host)',
        isHost: true,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(this.userName)}`
      });

      this.initPeerJS(code).then(() => {
        this.emitParticipants();
        this.emitRoomState();
        resolve(code);
      }).catch(reject);
    });
  }

  // Join an existing room via Code
  joinRoom(code) {
    return new Promise((resolve, reject) => {
      const formattedCode = code.trim().toUpperCase();
      this.roomId = formattedCode;
      this.isHost = false;

      this.participants.clear();
      this.participants.set('self', {
        id: 'self',
        name: this.userName,
        isHost: false,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(this.userName)}`
      });

      // Connect via PeerJS or BroadcastChannel
      this.initPeerJS().then(() => {
        const conn = this.peer.connect(formattedCode);
        this.setupConnection(conn);

        conn.on('open', () => {
          console.log('[P2P] Connected to Host:', formattedCode);
          // Request full state from host
          conn.send({
            type: 'REQUEST_STATE',
            user: { name: this.userName, avatar: this.participants.get('self').avatar }
          });
          this.emitParticipants();
          this.emitRoomState();
          resolve(formattedCode);
        });

        conn.on('error', (err) => {
          console.warn('[P2P] Connection error:', err);
          // Fallback multi-tab join notification via BroadcastChannel
          this.sendBroadcast({
            type: 'REQUEST_STATE',
            user: { name: this.userName, avatar: this.participants.get('self').avatar }
          });
          resolve(formattedCode);
        });
      }).catch(err => {
        console.warn('PeerJS init failed, falling back to BroadcastChannel:', err);
        this.sendBroadcast({
          type: 'REQUEST_STATE',
          user: { name: this.userName, avatar: this.participants.get('self').avatar }
        });
        resolve(formattedCode);
      });
    });
  }

  initPeerJS(customId = null) {
    return new Promise((resolve, reject) => {
      if (typeof window.Peer === 'undefined') {
        console.warn('PeerJS library script not loaded, using local BroadcastChannel fallback.');
        return resolve();
      }

      try {
        this.peer = customId ? new window.Peer(customId) : new window.Peer();

        this.peer.on('open', (id) => {
          this.peerId = id;
          console.log('[P2P] PeerJS Ready with ID:', id);
          resolve();
        });

        this.peer.on('connection', (conn) => {
          console.log('[P2P] Incoming connection from peer:', conn.peer);
          this.setupConnection(conn);
        });

        this.peer.on('error', (err) => {
          console.warn('[P2P] PeerJS server error:', err.type);
          resolve(); // Resolve anyway to allow fallback local BroadcastChannel
        });
      } catch (e) {
        console.warn('[P2P] PeerJS init exception:', e);
        resolve();
      }
    });
  }

  setupConnection(conn) {
    this.connections.push(conn);

    conn.on('data', (data) => {
      this.handleIncomingAction(data, conn.peer);
    });

    conn.on('close', () => {
      this.connections = this.connections.filter(c => c !== conn);
      this.participants.delete(conn.peer);
      this.emitParticipants();
    });
  }

  // Broadcast action payload to all connected peers & local BroadcastChannel
  broadcastAction(actionPayload) {
    if (!this.roomId) return; // Not in a room

    // 1. Send via PeerJS connections
    this.connections.forEach(conn => {
      if (conn.open) {
        conn.send(actionPayload);
      }
    });

    // 2. Send via BroadcastChannel for same-device tabs
    this.sendBroadcast(actionPayload);
  }

  sendBroadcast(payload) {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({
          ...payload,
          senderRoomId: this.roomId,
          senderPeerId: this.peerId || 'tab_' + this.userName
        });
      } catch (e) {
        console.warn('BroadcastChannel send error:', e);
      }
    }
  }

  handleIncomingAction(payload, senderId) {
    if (!payload || !payload.type) return;
    if (payload.senderPeerId && payload.senderPeerId === (this.peerId || 'tab_' + this.userName)) return; // Ignore self

    console.log('[RoomSync] Received action:', payload.type, payload);

    switch (payload.type) {
      case 'REQUEST_STATE':
        if (this.isHost) {
          // Add newly joined user
          this.participants.set(senderId, {
            id: senderId,
            name: payload.user.name,
            isHost: false,
            avatar: payload.user.avatar
          });
          this.emitParticipants();

          // Send current player state snapshot to joiner
          const stateSnapshot = {
            type: 'STATE_RESPONSE',
            queue: this.player.queue,
            currentTrackIndex: this.player.currentTrackIndex,
            isPlaying: this.player.isPlaying,
            currentTime: this.player.audio.currentTime || 0,
            sleepTimerDuration: this.player.sleepTimerDuration,
            participants: Array.from(this.participants.values())
          };
          this.broadcastAction(stateSnapshot);
        }
        break;

      case 'STATE_RESPONSE':
        if (payload.queue) {
          this.player.queue = payload.queue;
          this.player.currentTrackIndex = payload.currentTrackIndex;
          this.player.loadTrack(payload.currentTrackIndex, payload.isPlaying);
          if (payload.currentTime) {
            this.player.seek(payload.currentTime);
          }
          if (payload.sleepTimerDuration) {
            this.player.setSleepTimer(Math.ceil(payload.sleepTimerDuration / 60));
          }
          this.player.emitQueueChange();
        }
        if (payload.participants) {
          payload.participants.forEach(p => {
            if (p.id !== 'self') this.participants.set(p.id, p);
          });
          this.emitParticipants();
        }
        break;

      case 'SYNC_PLAY':
        if (!this.player.isPlaying) {
          this.player.play();
        }
        if (payload.currentTime && Math.abs((this.player.audio.currentTime || 0) - payload.currentTime) > 1.5) {
          this.player.seek(payload.currentTime);
        }
        break;

      case 'SYNC_PAUSE':
        if (this.player.isPlaying) {
          this.player.pause();
        }
        if (payload.currentTime) {
          this.player.seek(payload.currentTime);
        }
        break;

      case 'SYNC_SEEK':
        if (payload.currentTime !== undefined) {
          this.player.seek(payload.currentTime);
        }
        break;

      case 'SYNC_TRACK':
        if (payload.trackIndex !== undefined && payload.trackIndex !== this.player.currentTrackIndex) {
          this.player.loadTrack(payload.trackIndex, payload.isPlaying !== false);
        }
        break;

      case 'SYNC_QUEUE':
        if (payload.queue) {
          this.player.queue = payload.queue;
          this.player.currentTrackIndex = payload.currentTrackIndex !== undefined ? payload.currentTrackIndex : this.player.currentTrackIndex;
          this.player.emitQueueChange();
        }
        break;

      case 'SYNC_SLEEP_TIMER':
        if (payload.minutes !== undefined) {
          this.player.setSleepTimer(payload.minutes);
        }
        break;
    }
  }

  // --- CONTROLLER METHODS (Triggered when user clicks Play/Pause/Skip/Seek in room) ---

  syncPlay() {
    this.player.play();
    this.broadcastAction({
      type: 'SYNC_PLAY',
      currentTime: this.player.audio.currentTime || 0
    });
  }

  syncPause() {
    this.player.pause();
    this.broadcastAction({
      type: 'SYNC_PAUSE',
      currentTime: this.player.audio.currentTime || 0
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
    this.broadcastAction({
      type: 'SYNC_SEEK',
      currentTime: seconds
    });
  }

  syncTrackChange(index) {
    this.player.loadTrack(index, true);
    this.broadcastAction({
      type: 'SYNC_TRACK',
      trackIndex: index,
      isPlaying: true
    });
  }

  syncNextTrack() {
    let nextIndex = this.player.currentTrackIndex + 1;
    if (nextIndex >= this.player.queue.length) nextIndex = 0;
    this.syncTrackChange(nextIndex);
  }

  syncPrevTrack() {
    if (this.player.audio.currentTime > 3) {
      this.syncSeek(0);
      return;
    }
    let prevIndex = this.player.currentTrackIndex - 1;
    if (prevIndex < 0) prevIndex = this.player.queue.length - 1;
    this.syncTrackChange(prevIndex);
  }

  syncQueueAdd(track) {
    this.player.addToQueue(track);
    this.broadcastAction({
      type: 'SYNC_QUEUE',
      queue: this.player.queue,
      currentTrackIndex: this.player.currentTrackIndex
    });
  }

  syncQueueRemove(index) {
    this.player.removeFromQueue(index);
    this.broadcastAction({
      type: 'SYNC_QUEUE',
      queue: this.player.queue,
      currentTrackIndex: this.player.currentTrackIndex
    });
  }

  syncSleepTimer(minutes) {
    this.player.setSleepTimer(minutes);
    this.broadcastAction({
      type: 'SYNC_SLEEP_TIMER',
      minutes: minutes
    });
  }

  leaveRoom() {
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.roomId = null;
    this.isHost = false;
    this.participants.clear();
    this.emitRoomState();
    this.emitParticipants();
  }

  onRoomState(cb) { this.onRoomStateCallbacks.push(cb); }
  onParticipants(cb) { this.onParticipantsCallbacks.push(cb); }

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
