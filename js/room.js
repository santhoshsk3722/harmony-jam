// PeerJS P2P & Multi-Layer Sync Engine for Harmony Jam

export class RoomManager {
  constructor(player) {
    this.player = player;
    this.peer = null;
    this.peerId = null;
    this.roomId = null; // Clean 4-digit code (e.g. "1234")
    this.isHost = false;
    this.connections = [];
    this.broadcastChannel = null;

    this.userName = localStorage.getItem('hj_username') || `User_${Math.floor(1000 + Math.random() * 9000)}`;
    this.participants = new Map();

    this.onRoomStateCallbacks = [];
    this.onParticipantsCallbacks = [];

    // Periodic Heartbeat & Drift Monitor (Host -> Peers)
    setInterval(() => {
      if (this.isHost && this.roomId) {
        this.broadcastAction({
          type: 'DRIFT_PULSE',
          currentTime: this.player.getCurrentTime(),
          trackIndex: this.player.currentTrackIndex,
          isPlaying: this.player.isPlaying
        });
      }
    }, 3000);
  }

  // Format clean 4-digit room code (e.g. "4892")
  generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  // Format safe PeerJS ID for WebRTC compatibility
  getPeerJsId(code) {
    const cleanCode = code.replace(/[^0-9]/g, '');
    return `harmonyjam_v1_${cleanCode}`;
  }

  initBroadcastChannel(code) {
    if (this.broadcastChannel) {
      try { this.broadcastChannel.close(); } catch(e){}
    }
    try {
      this.broadcastChannel = new BroadcastChannel(`harmony_jam_room_${code}`);
      this.broadcastChannel.onmessage = (event) => {
        this.handleIncomingAction(event.data, 'broadcast');
      };
    } catch (e) {
      console.warn('[RoomSync] BroadcastChannel fallback setup:', e);
    }
  }

  createRoom(customCode = null) {
    return new Promise((resolve, reject) => {
      const code = customCode ? customCode.trim() : this.generateRoomCode();
      this.roomId = code;
      this.isHost = true;

      this.initBroadcastChannel(code);

      this.participants.clear();
      this.participants.set('self', {
        id: 'self',
        name: this.userName + ' (Host)',
        isHost: true,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(this.userName)}`
      });

      const peerJsId = this.getPeerJsId(code);

      this.initPeerJS(peerJsId).then(() => {
        console.log('[RoomSync] Room created successfully as Host. Room Code:', code);
        this.emitParticipants();
        this.emitRoomState();
        resolve(code);
      }).catch(err => {
        console.warn('[RoomSync] PeerJS server init warning, proceeding with BroadcastChannel:', err);
        this.emitParticipants();
        this.emitRoomState();
        resolve(code);
      });
    });
  }

  joinRoom(inputCode) {
    return new Promise((resolve, reject) => {
      // Clean input (strip letters, hyphens, spaces)
      const cleanCode = inputCode.toString().replace(/[^0-9]/g, '');
      if (!cleanCode || cleanCode.length < 3) {
        return reject(new Error('Please enter a valid numeric room code (e.g. 4892)'));
      }

      this.roomId = cleanCode;
      this.isHost = false;

      this.initBroadcastChannel(cleanCode);

      this.participants.clear();
      this.participants.set('self', {
        id: 'self',
        name: this.userName,
        isHost: false,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(this.userName)}`
      });

      const hostPeerJsId = this.getPeerJsId(cleanCode);

      this.initPeerJS().then(() => {
        let connected = false;

        const attemptConnect = () => {
          if (connected) return;
          try {
            console.log('[RoomSync] Connecting to Host Peer ID:', hostPeerJsId);
            const conn = this.peer.connect(hostPeerJsId, { reliable: true });
            this.setupConnection(conn);

            conn.on('open', () => {
              connected = true;
              console.log('[RoomSync] WebRTC Connection Established with Host!');
              conn.send({
                type: 'REQUEST_STATE',
                user: { name: this.userName, avatar: this.participants.get('self').avatar }
              });
              this.emitParticipants();
              this.emitRoomState();
              resolve(cleanCode);
            });
          } catch (e) {
            console.warn('[RoomSync] Connection attempt exception:', e);
          }
        };

        attemptConnect();

        // Broadcast fallback request immediately for local/LAN peers
        this.sendBroadcast({
          type: 'REQUEST_STATE',
          user: { name: this.userName, avatar: this.participants.get('self').avatar }
        });

        // Retry connection at 1.5s if not connected yet
        setTimeout(() => {
          if (!connected) {
            console.log('[RoomSync] Retrying PeerJS connection...');
            attemptConnect();
          }
          this.emitParticipants();
          this.emitRoomState();
          resolve(cleanCode);
        }, 1500);

      }).catch(err => {
        console.warn('[RoomSync] PeerJS client init fallback:', err);
        this.sendBroadcast({
          type: 'REQUEST_STATE',
          user: { name: this.userName, avatar: this.participants.get('self').avatar }
        });
        this.emitParticipants();
        this.emitRoomState();
        resolve(cleanCode);
      });
    });
  }

  initPeerJS(customId = null) {
    return new Promise((resolve) => {
      if (typeof window.Peer === 'undefined') {
        return resolve();
      }
      try {
        if (this.peer) {
          try { this.peer.destroy(); } catch(e){}
        }

        const peerOpts = {
          debug: 1,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' }
            ]
          }
        };

        this.peer = customId ? new window.Peer(customId, peerOpts) : new window.Peer(peerOpts);

        this.peer.on('open', (id) => {
          this.peerId = id;
          console.log('[PeerJS] Online with Peer ID:', id);
          resolve();
        });

        this.peer.on('connection', (conn) => {
          console.log('[PeerJS] Incoming peer connection:', conn.peer);
          this.setupConnection(conn);
        });

        this.peer.on('error', (err) => {
          console.warn('[PeerJS] Error:', err.type);
          resolve();
        });
      } catch (e) {
        console.warn('[PeerJS] Exception:', e);
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
      if (conn.peer) this.participants.delete(conn.peer);
      this.emitParticipants();
    });
  }

  broadcastAction(actionPayload) {
    if (!this.roomId) return;

    this.connections.forEach(conn => {
      if (conn.open) {
        try { conn.send(actionPayload); } catch(e){}
      }
    });

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
        console.warn('BroadcastChannel error:', e);
      }
    }
  }

  handleIncomingAction(payload, senderId) {
    if (!payload || !payload.type) return;
    if (payload.senderPeerId && payload.senderPeerId === (this.peerId || 'tab_' + this.userName)) return;

    console.log('[RoomSync] Action received:', payload.type);

    switch (payload.type) {
      case 'REQUEST_STATE':
        if (this.isHost) {
          const participantObj = {
            id: senderId,
            name: payload.user ? payload.user.name : 'Connected Friend',
            isHost: false,
            avatar: payload.user ? payload.user.avatar : `https://api.dicebear.com/7.x/bottts/svg?seed=${senderId}`
          };
          this.participants.set(senderId, participantObj);
          this.emitParticipants();

          const stateSnapshot = {
            type: 'STATE_RESPONSE',
            queue: this.player.queue,
            currentTrackIndex: this.player.currentTrackIndex,
            isPlaying: this.player.isPlaying,
            currentTime: this.player.getCurrentTime(),
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
          if (payload.currentTime && payload.currentTime > 0) {
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
        if (payload.trackIndex !== undefined && payload.trackIndex !== this.player.currentTrackIndex) {
          this.player.loadTrack(payload.trackIndex, true);
        }
        if (!this.player.isPlaying) {
          this.player.play();
        }
        if (payload.currentTime !== undefined && payload.currentTime >= 0) {
          const diff = Math.abs(this.player.getCurrentTime() - payload.currentTime);
          if (diff > 1.2) {
            this.player.seek(payload.currentTime);
          }
        }
        break;

      case 'SYNC_PAUSE':
        if (this.player.isPlaying) {
          this.player.pause();
        }
        if (payload.currentTime !== undefined && payload.currentTime >= 0) {
          const diff = Math.abs(this.player.getCurrentTime() - payload.currentTime);
          if (diff > 1.2) {
            this.player.seek(payload.currentTime);
          }
        }
        break;

      case 'SYNC_SEEK':
        if (payload.currentTime !== undefined && payload.currentTime >= 0) {
          this.player.seek(payload.currentTime);
        }
        break;

      case 'DRIFT_PULSE':
        if (payload.trackIndex === this.player.currentTrackIndex && payload.currentTime !== undefined) {
          const drift = Math.abs(this.player.getCurrentTime() - payload.currentTime);
          if (drift > 1.5) {
            this.player.seek(payload.currentTime);
          }
          if (payload.isPlaying !== undefined && payload.isPlaying !== this.player.isPlaying) {
            payload.isPlaying ? this.player.play() : this.player.pause();
          }
        }
        break;

      case 'SYNC_QUEUE':
        if (payload.queue) {
          this.player.queue = payload.queue;
          if (payload.currentTrackIndex !== undefined) {
            this.player.currentTrackIndex = payload.currentTrackIndex;
          }
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

  syncPlay() {
    this.player.play();
    this.broadcastAction({
      type: 'SYNC_PLAY',
      trackIndex: this.player.currentTrackIndex,
      currentTime: this.player.getCurrentTime()
    });
  }

  syncPause() {
    this.player.pause();
    this.broadcastAction({
      type: 'SYNC_PAUSE',
      trackIndex: this.player.currentTrackIndex,
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
    this.broadcastAction({
      type: 'SYNC_SEEK',
      trackIndex: this.player.currentTrackIndex,
      currentTime: seconds
    });
  }

  syncTrackChange(index) {
    this.player.loadTrack(index, true);
    this.broadcastAction({
      type: 'SYNC_PLAY',
      trackIndex: index,
      currentTime: 0
    });
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
      try { this.peer.destroy(); } catch(e){}
      this.peer = null;
    }
    if (this.broadcastChannel) {
      try { this.broadcastChannel.close(); } catch(e){}
      this.broadcastChannel = null;
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
