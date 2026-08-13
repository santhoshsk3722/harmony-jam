// Harmony Jam Global Multi-Engine Real-Time Sync & Presence Engine

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

    this.participants = new Map(); // id -> { id, name, isHost, avatar, lastSeen }

    // MQTT Client & BroadcastChannel instances
    this.mqttClient = null;
    this.broadcastChannel = null;

    this.onRoomStateCallbacks = [];
    this.onParticipantsCallbacks = [];

    // Periodic Heartbeat & Presence Ping (Every 2 seconds)
    setInterval(() => {
      if (this.roomId) {
        // Send presence ping
        this.broadcastAction({
          type: 'PRESENCE_PING',
          user: {
            id: this.userId,
            name: this.isHost ? `${this.userName} (Host)` : this.userName,
            isHost: this.isHost,
            avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(this.userName)}`
          }
        });

        // Host periodic sync & heartbeat
        if (this.isHost) {
          this.broadcastAction({
            type: 'DRIFT_PULSE',
            currentTime: this.player.getCurrentTime(),
            trackIndex: this.player.currentTrackIndex,
            isPlaying: this.player.isPlaying,
            participants: Array.from(this.participants.values())
          });
        }

        // Clean up stale participants (no ping for > 10 seconds)
        const now = Date.now();
        let changed = false;
        this.participants.forEach((p, id) => {
          if (id !== this.userId && p.lastSeen && (now - p.lastSeen > 10000)) {
            this.participants.delete(id);
            changed = true;
          }
        });
        if (changed) this.emitParticipants();
      }
    }, 2000);
  }

  generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  initMqtt(code) {
    return new Promise((resolve) => {
      if (typeof window.mqtt === 'undefined') {
        console.warn('[RoomSync] MQTT.js library not found, using fallback');
        return resolve();
      }

      const topic = `harmonyjam/v1/room/${code}`;
      const brokerUrl = 'wss://broker.hivemq.com:8884/mqtt';

      try {
        if (this.mqttClient) {
          try { this.mqttClient.end(true); } catch(e){}
        }

        this.mqttClient = window.mqtt.connect(brokerUrl, {
          clientId: `hj_${this.userId}_${Math.floor(Math.random()*1000)}`,
          keepalive: 30,
          clean: true,
          reconnectPeriod: 2000
        });

        this.mqttClient.on('connect', () => {
          console.log('[MQTT] Connected to global relay broker topic:', topic);
          this.mqttClient.subscribe(topic, { qos: 0 }, (err) => {
            if (!err) console.log('[MQTT] Subscribed to topic:', topic);
            resolve();
          });
        });

        this.mqttClient.on('message', (t, message) => {
          try {
            const payload = JSON.parse(message.toString());
            this.handleIncomingAction(payload, payload.senderId);
          } catch (e) {
            console.warn('[MQTT] Parsing error:', e);
          }
        });

        this.mqttClient.on('error', (err) => {
          console.warn('[MQTT] Broker connection warning:', err);
          resolve();
        });

        setTimeout(() => resolve(), 2000);

      } catch (e) {
        console.warn('[MQTT] Exception during init:', e);
        resolve();
      }
    });
  }

  initBroadcastChannel(code) {
    if (this.broadcastChannel) {
      try { this.broadcastChannel.close(); } catch(e){}
    }
    try {
      this.broadcastChannel = new BroadcastChannel(`harmony_jam_room_${code}`);
      this.broadcastChannel.onmessage = (event) => {
        this.handleIncomingAction(event.data, event.data.senderId);
      };
    } catch (e) {
      console.warn('BroadcastChannel fallback');
    }
  }

  createRoom(customCode = null) {
    return new Promise((resolve) => {
      const code = customCode ? customCode.toString().replace(/[^0-9]/g, '') : this.generateRoomCode();
      this.roomId = code;
      this.isHost = true;

      this.initBroadcastChannel(code);

      this.participants.clear();
      this.participants.set(this.userId, {
        id: this.userId,
        name: this.userName + ' (Host)',
        isHost: true,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(this.userName)}`,
        lastSeen: Date.now()
      });

      this.initMqtt(code).then(() => {
        console.log('[RoomSync] Host created room:', code);
        this.emitParticipants();
        this.emitRoomState();
        
        // Announce presence immediately
        this.broadcastAction({
          type: 'PRESENCE_PING',
          user: this.participants.get(this.userId)
        });

        resolve(code);
      });
    });
  }

  joinRoom(inputCode) {
    return new Promise((resolve, reject) => {
      const cleanCode = inputCode.toString().replace(/[^0-9]/g, '');
      if (!cleanCode || cleanCode.length < 3) {
        return reject(new Error('Please enter a valid 4-digit room code (e.g. 4892)'));
      }

      this.roomId = cleanCode;
      this.isHost = false;

      this.initBroadcastChannel(cleanCode);

      this.participants.clear();
      const myUserObj = {
        id: this.userId,
        name: this.userName,
        isHost: false,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(this.userName)}`,
        lastSeen: Date.now()
      };
      this.participants.set(this.userId, myUserObj);

      this.initMqtt(cleanCode).then(() => {
        console.log('[RoomSync] Joined room:', cleanCode);

        // Announce presence & request full state
        this.broadcastAction({
          type: 'PRESENCE_PING',
          user: myUserObj
        });

        this.broadcastAction({
          type: 'REQUEST_STATE',
          user: myUserObj
        });

        this.emitParticipants();
        this.emitRoomState();
        resolve(cleanCode);
      });
    });
  }

  broadcastAction(actionPayload) {
    if (!this.roomId) return;

    const fullPayload = {
      ...actionPayload,
      senderId: this.userId,
      roomId: this.roomId,
      timestamp: Date.now()
    };

    // 1. MQTT WebSocket Relay
    if (this.mqttClient && this.mqttClient.connected) {
      const topic = `harmonyjam/v1/room/${this.roomId}`;
      try {
        this.mqttClient.publish(topic, JSON.stringify(fullPayload));
      } catch (e) {
        console.warn('[MQTT] Publish error:', e);
      }
    }

    // 2. BroadcastChannel Relay
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(fullPayload);
      } catch (e) {
        console.warn('[BroadcastChannel] Post error:', e);
      }
    }
  }

  handleIncomingAction(payload, senderId) {
    if (!payload || !payload.type) return;
    if (senderId === this.userId) return; // Ignore self messages

    // 1. Handle presence ping from any user in room
    if (payload.user && payload.user.id && payload.user.id !== this.userId) {
      this.participants.set(payload.user.id, {
        ...payload.user,
        lastSeen: Date.now()
      });
      this.emitParticipants();
    }

    switch (payload.type) {
      case 'PRESENCE_PING':
        // Peer/Host announced presence, already recorded above
        break;

      case 'REQUEST_STATE':
        if (this.isHost) {
          // Host replies with full state snapshot + current participants
          this.broadcastAction({
            type: 'STATE_RESPONSE',
            queue: this.player.queue,
            currentTrackIndex: this.player.currentTrackIndex,
            isPlaying: this.player.isPlaying,
            currentTime: this.player.getCurrentTime(),
            sleepTimerDuration: this.player.sleepTimerDuration,
            participants: Array.from(this.participants.values())
          });
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
            if (p.id !== this.userId) {
              this.participants.set(p.id, { ...p, lastSeen: Date.now() });
            }
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
        if (payload.participants) {
          payload.participants.forEach(p => {
            if (p.id !== this.userId) {
              this.participants.set(p.id, { ...p, lastSeen: Date.now() });
            }
          });
          this.emitParticipants();
        }
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
    if (this.mqttClient) {
      try { this.mqttClient.end(true); } catch(e){}
      this.mqttClient = null;
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
