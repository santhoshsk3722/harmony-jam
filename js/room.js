// Harmony Jam Bulletproof Multi-Broker Global Real-Time Sync & Presence Engine

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

    // Realtime Communication Clients
    this.mqttClient = null;
    this.broadcastChannel = null;

    this.onRoomStateCallbacks = [];
    this.onParticipantsCallbacks = [];

    // Continuous 2-second Presence Ping & Host Sync Heartbeat
    setInterval(() => {
      if (this.roomId) {
        // Send presence ping
        this.broadcastAction({
          type: 'PRESENCE_PING',
          user: this.getSelfUserObj()
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

        // Clean up inactive participants (> 12 seconds)
        const now = Date.now();
        let changed = false;
        this.participants.forEach((p, id) => {
          if (id !== this.userId && p.lastSeen && (now - p.lastSeen > 12000)) {
            this.participants.delete(id);
            changed = true;
          }
        });
        if (changed) this.emitParticipants();
      }
    }, 2000);
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

  initMqtt(code) {
    return new Promise((resolve) => {
      if (typeof window.mqtt === 'undefined') {
        console.warn('[RoomSync] MQTT library not available');
        return resolve();
      }

      const topic = `santhoshsk3722_harmonyjam_v2_room_${code}`;
      const brokers = [
        'wss://broker.emqx.io:8084/mqtt',
        'wss://broker.hivemq.com:8884/mqtt'
      ];

      const tryConnect = (brokerIndex) => {
        if (brokerIndex >= brokers.length) {
          console.warn('[MQTT] All brokers exhausted, using local fallback');
          return resolve();
        }

        const brokerUrl = brokers[brokerIndex];
        console.log(`[MQTT] Connecting to broker [${brokerIndex + 1}/${brokers.length}]:`, brokerUrl);

        try {
          if (this.mqttClient) {
            try { this.mqttClient.end(true); } catch(e){}
          }

          const randomClientId = `hj_${this.userId}_${Math.floor(Math.random() * 100000)}`;

          this.mqttClient = window.mqtt.connect(brokerUrl, {
            clientId: randomClientId,
            keepalive: 20,
            clean: true,
            connectTimeout: 4000,
            reconnectPeriod: 2000
          });

          let resolved = false;

          this.mqttClient.on('connect', () => {
            console.log('[MQTT] Connected successfully to broker:', brokerUrl);
            this.mqttClient.subscribe(topic, { qos: 0 }, (err) => {
              if (!err) {
                console.log('[MQTT] Subscribed to room topic:', topic);
              }
              if (!resolved) {
                resolved = true;
                resolve();
              }
            });
          });

          this.mqttClient.on('message', (t, message) => {
            try {
              const payload = JSON.parse(message.toString());
              this.handleIncomingAction(payload, payload.senderId);
            } catch (e) {
              console.warn('[MQTT] Parse error:', e);
            }
          });

          this.mqttClient.on('error', (err) => {
            console.warn('[MQTT] Broker error:', err);
            if (!resolved) {
              resolved = true;
              tryConnect(brokerIndex + 1);
            }
          });

          setTimeout(() => {
            if (!resolved && (!this.mqttClient || !this.mqttClient.connected)) {
              console.warn('[MQTT] Connection timeout, trying next broker...');
              resolved = true;
              tryConnect(brokerIndex + 1);
            }
          }, 4500);

        } catch (e) {
          console.warn('[MQTT] Connection exception:', e);
          tryConnect(brokerIndex + 1);
        }
      };

      tryConnect(0);
    });
  }

  initBroadcastChannel(code) {
    if (this.broadcastChannel) {
      try { this.broadcastChannel.close(); } catch(e){}
    }
    try {
      this.broadcastChannel = new BroadcastChannel(`harmony_jam_v2_room_${code}`);
      this.broadcastChannel.onmessage = (event) => {
        this.handleIncomingAction(event.data, event.data.senderId);
      };
    } catch (e) {
      console.warn('BroadcastChannel not supported');
    }
  }

  createRoom(customCode = null) {
    return new Promise((resolve) => {
      const code = customCode ? customCode.toString().replace(/[^0-9]/g, '') : this.generateRoomCode();
      this.roomId = code;
      this.isHost = true;

      this.initBroadcastChannel(code);

      this.participants.clear();
      const myObj = this.getSelfUserObj();
      this.participants.set(this.userId, myObj);

      this.initMqtt(code).then(() => {
        console.log('[RoomSync] Host initialized room code:', code);
        this.emitParticipants();
        this.emitRoomState();

        this.broadcastAction({
          type: 'PRESENCE_PING',
          user: myObj
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
      const myObj = this.getSelfUserObj();
      this.participants.set(this.userId, myObj);

      this.initMqtt(cleanCode).then(() => {
        console.log('[RoomSync] Peer joined room code:', cleanCode);

        this.broadcastAction({
          type: 'JOIN_ROOM',
          user: myObj
        });

        this.broadcastAction({
          type: 'REQUEST_STATE',
          user: myObj
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

    if (this.mqttClient && this.mqttClient.connected) {
      const topic = `santhoshsk3722_harmonyjam_v2_room_${this.roomId}`;
      try {
        this.mqttClient.publish(topic, JSON.stringify(fullPayload));
      } catch (e) {
        console.warn('[MQTT] Publish error:', e);
      }
    }

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
    if (senderId === this.userId) return;

    if (payload.user && payload.user.id && payload.user.id !== this.userId) {
      this.participants.set(payload.user.id, {
        ...payload.user,
        lastSeen: Date.now()
      });
      this.emitParticipants();
    }

    switch (payload.type) {
      case 'JOIN_ROOM':
        if (payload.user) {
          this.participants.set(payload.user.id, {
            ...payload.user,
            lastSeen: Date.now()
          });
          this.emitParticipants();
        }

        if (this.isHost) {
          this.broadcastAction({
            type: 'HOST_WELCOME',
            targetId: payload.user ? payload.user.id : null,
            queue: this.player.queue,
            currentTrackIndex: this.player.currentTrackIndex,
            isPlaying: this.player.isPlaying,
            currentTime: this.player.getCurrentTime(),
            sleepTimerDuration: this.player.sleepTimerDuration,
            participants: Array.from(this.participants.values())
          });
        }
        break;

      case 'REQUEST_STATE':
        if (this.isHost) {
          this.broadcastAction({
            type: 'HOST_WELCOME',
            queue: this.player.queue,
            currentTrackIndex: this.player.currentTrackIndex,
            isPlaying: this.player.isPlaying,
            currentTime: this.player.getCurrentTime(),
            sleepTimerDuration: this.player.sleepTimerDuration,
            participants: Array.from(this.participants.values())
          });
        }
        break;

      case 'HOST_WELCOME':
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
        if (payload.queue) {
          this.player.queue = payload.queue;
          this.player.emitQueueChange();
        }
        if (payload.trackIndex !== undefined) {
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
      track: this.player.currentTrack,
      queue: this.player.queue,
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
      track: this.player.queue[index],
      queue: this.player.queue,
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
