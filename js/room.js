// PeerJS P2P & BroadcastChannel Sync Engine for Harmony Jam

export class RoomManager {
  constructor(player) {
    this.player = player;
    this.peer = null;
    this.peerId = null;
    this.roomId = null;
    this.isHost = false;
    this.connections = [];
    this.broadcastChannel = null;

    this.userName = localStorage.getItem('hj_username') || `User_${Math.floor(1000 + Math.random() * 9000)}`;
    this.participants = new Map();

    this.onRoomStateCallbacks = [];
    this.onParticipantsCallbacks = [];

    this.initBroadcastChannel();

    // Auto Periodic Drift Monitor (Host -> Peers)
    setInterval(() => {
      if (this.isHost && this.roomId && this.player.isPlaying) {
        this.broadcastAction({
          type: 'DRIFT_PULSE',
          currentTime: this.player.getCurrentTime(),
          trackIndex: this.player.currentTrackIndex
        });
      }
    }, 4000);
  }

  initBroadcastChannel() {
    try {
      this.broadcastChannel = new BroadcastChannel('harmony_jam_channel');
      this.broadcastChannel.onmessage = (event) => {
        this.handleIncomingAction(event.data, 'broadcast');
      };
    } catch (e) {
      console.warn('BroadcastChannel fallback setup');
    }
  }

  generateRoomCode() {
    const num = Math.floor(1000 + Math.random() * 9000);
    return `HJ-${num}`;
  }

  createRoom() {
    return new Promise((resolve, reject) => {
      const code = this.generateRoomCode();
      this.roomId = code;
      this.isHost = true;

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

      this.initPeerJS().then(() => {
        const conn = this.peer.connect(formattedCode);
        this.setupConnection(conn);

        conn.on('open', () => {
          conn.send({
            type: 'REQUEST_STATE',
            user: { name: this.userName, avatar: this.participants.get('self').avatar }
          });
          this.emitParticipants();
          this.emitRoomState();
          resolve(formattedCode);
        });

        conn.on('error', () => {
          this.sendBroadcast({
            type: 'REQUEST_STATE',
            user: { name: this.userName, avatar: this.participants.get('self').avatar }
          });
          resolve(formattedCode);
        });
      }).catch(() => {
        this.sendBroadcast({
          type: 'REQUEST_STATE',
          user: { name: this.userName, avatar: this.participants.get('self').avatar }
        });
        resolve(formattedCode);
      });
    });
  }

  initPeerJS(customId = null) {
    return new Promise((resolve) => {
      if (typeof window.Peer === 'undefined') {
        return resolve();
      }
      try {
        this.peer = customId ? new window.Peer(customId) : new window.Peer();

        this.peer.on('open', (id) => {
          this.peerId = id;
          resolve();
        });

        this.peer.on('connection', (conn) => {
          this.setupConnection(conn);
        });

        this.peer.on('error', () => {
          resolve();
        });
      } catch (e) {
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

  broadcastAction(actionPayload) {
    if (!this.roomId) return;

    this.connections.forEach(conn => {
      if (conn.open) {
        conn.send(actionPayload);
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

    console.log('[RoomSync] Action received:', payload.type, payload);

    switch (payload.type) {
      case 'REQUEST_STATE':
        if (this.isHost) {
          this.participants.set(senderId, {
            id: senderId,
            name: payload.user.name,
            isHost: false,
            avatar: payload.user.avatar
          });
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
        // 1. Switch track ONLY if track index changed
        if (payload.trackIndex !== undefined && payload.trackIndex !== this.player.currentTrackIndex) {
          this.player.loadTrack(payload.trackIndex, true);
        }

        // 2. Play if not playing
        if (!this.player.isPlaying) {
          this.player.play();
        }

        // 3. Align position if drift > 1.2 seconds and payload position is valid
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
            console.log('[Sync] Aligning drift:', drift, 'sec');
            this.player.seek(payload.currentTime);
          }
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
