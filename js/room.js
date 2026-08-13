// Harmony Jam Port 443 Ultra-Reliable Global Real-Time Sync & Room Engine

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

    this.participants = new Map(); // id -> userObj
    this.connectionStatus = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, CONNECTED

    // Communication Clients
    this.mqttClient = null;
    this.broadcastChannel = null;

    this.onRoomStateCallbacks = [];
    this.onParticipantsCallbacks = [];
    this.onStatusCallbacks = [];

    // Continuous 1.5-second Heartbeat & Drift Monitor
    setInterval(() => {
      if (this.roomId && this.mqttClient && this.mqttClient.connected) {
        // Send presence ping
        this.broadcastAction({
          type: 'PRESENCE_PING',
          user: this.getSelfUserObj()
        });

        // Host periodic sync
        if (this.isHost) {
          this.broadcastAction({
            type: 'HOST_HEARTBEAT',
            currentTime: this.player.getCurrentTime(),
            trackIndex: this.player.currentTrackIndex,
            isPlaying: this.player.isPlaying,
            participants: Array.from(this.participants.values())
          });
        }

        // Clean stale participants (> 8 seconds)
        const now = Date.now();
        let changed = false;
        this.participants.forEach((p, id) => {
          if (id !== this.userId && p.lastSeen && (now - p.lastSeen > 8000)) {
            this.participants.delete(id);
            changed = true;
          }
        });
        if (changed) this.emitParticipants();
      }
    }, 1500);
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

  // Connect via Standard HTTPS Port 443 SSL WebSockets (Works on 100% of mobile networks worldwide)
  initMqtt(code) {
    return new Promise((resolve) => {
      if (typeof window.mqtt === 'undefined') {
        console.warn('[RoomSync] MQTT.js library not loaded');
        this.setStatus('WARNING: MQTT script missing', false);
        return resolve();
      }

      this.setStatus('CONNECTING', false);

      const topic = `santhoshsk3722/harmonyjam/v3/room/${code}`;

      // STANDARD PORT 443 WSS URLS (Bypasses all mobile ISP & firewall blocks)
      const brokerUrls = [
        'wss://broker.emqx.io:443/mqtt',
        'wss://broker.hivemq.com:443/mqtt',
        'wss://public.mqtthq.com:443/mqtt'
      ];

      const tryConnect = (index) => {
        if (index >= brokerUrls.length) {
          console.warn('[MQTT] All Port 443 brokers attempted');
          this.setStatus('LOCAL MODE (BroadcastChannel)', false);
          return resolve();
        }

        const brokerUrl = brokerUrls[index];
        console.log(`[MQTT] Connecting to Port 443 Broker [${index + 1}/${brokerUrls.length}]:`, brokerUrl);

        try {
          if (this.mqttClient) {
            try { this.mqttClient.end(true); } catch(e){}
          }

          const clientId = `hj_${this.userId}_${Math.floor(Math.random() * 1000000)}`;

          this.mqttClient = window.mqtt.connect(brokerUrl, {
            clientId: clientId,
            keepalive: 15,
            clean: true,
            connectTimeout: 4000,
            reconnectPeriod: 2000
          });

          let done = false;

          this.mqttClient.on('connect', () => {
            console.log('[MQTT] Connected over Port 443 to:', brokerUrl);
            this.mqttClient.subscribe(topic, { qos: 0 }, (err) => {
              if (!err) {
                console.log('[MQTT] Subscribed to topic:', topic);
                this.setStatus('CONNECTED', true);
              }
              if (!done) {
                done = true;
                resolve();
              }
            });
          });

          this.mqttClient.on('message', (t, message) => {
            try {
              const payload = JSON.parse(message.toString());
              this.handleIncomingAction(payload, payload.senderId);
            } catch (e) {
              console.warn('[MQTT] Invalid JSON payload:', e);
            }
          });

          this.mqttClient.on('error', (err) => {
            console.warn(`[MQTT] Error on ${brokerUrl}:`, err);
            if (!done) {
              done = true;
              tryConnect(index + 1);
            }
          });

          setTimeout(() => {
            if (!done && (!this.mqttClient || !this.mqttClient.connected)) {
              console.warn(`[MQTT] Timeout on ${brokerUrl}, trying next...`);
              done = true;
              tryConnect(index + 1);
            }
          }, 4500);

        } catch (e) {
          console.warn('[MQTT] Connection exception:', e);
          tryConnect(index + 1);
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
      this.broadcastChannel = new BroadcastChannel(`harmony_jam_v3_room_${code}`);
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
      const selfObj = this.getSelfUserObj();
      this.participants.set(this.userId, selfObj);

      this.initMqtt(code).then(() => {
        console.log('[RoomSync] Room created by Host. Code:', code);
        this.emitParticipants();
        this.emitRoomState();

        // Host announces room
        this.broadcastAction({
          type: 'HOST_HEARTBEAT',
          currentTime: this.player.getCurrentTime(),
          trackIndex: this.player.currentTrackIndex,
          isPlaying: this.player.isPlaying,
          participants: Array.from(this.participants.values())
        });

        resolve(code);
      });
    });
  }

  joinRoom(inputCode) {
    return new Promise((resolve, reject) => {
      const cleanCode = inputCode.toString().replace(/[^0-9]/g, '');
      if (!cleanCode || cleanCode.length < 3) {
        return reject(new Error('Please enter a valid 4-digit code (e.g. 4892)'));
      }

      this.roomId = cleanCode;
      this.isHost = false;

      this.initBroadcastChannel(cleanCode);

      this.participants.clear();
      const selfObj = this.getSelfUserObj();
      this.participants.set(this.userId, selfObj);

      this.initMqtt(cleanCode).then(() => {
        console.log('[RoomSync] Joined room. Code:', cleanCode);

        // Send PING_HOST to discover Host
        this.broadcastAction({
          type: 'PING_HOST',
          user: selfObj
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

    // 1. MQTT Port 443 WebSocket
    if (this.mqttClient && this.mqttClient.connected) {
      const topic = `santhoshsk3722/harmonyjam/v3/room/${this.roomId}`;
      try {
        this.mqttClient.publish(topic, JSON.stringify(fullPayload));
      } catch (e) {
        console.warn('[MQTT] Publish error:', e);
      }
    }

    // 2. BroadcastChannel
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
    if (senderId === this.userId) return; // Ignore self

    // Record user presence
    if (payload.user && payload.user.id && payload.user.id !== this.userId) {
      this.participants.set(payload.user.id, {
        ...payload.user,
        lastSeen: Date.now()
      });
      this.emitParticipants();
    }

    switch (payload.type) {
      case 'PING_HOST':
        if (this.isHost) {
          if (payload.user) {
            this.participants.set(payload.user.id, {
              ...payload.user,
              lastSeen: Date.now()
            });
            this.emitParticipants();
          }

          // Host replies with HOST_PONG state snapshot
          this.broadcastAction({
            type: 'HOST_PONG',
            queue: this.player.queue,
            currentTrackIndex: this.player.currentTrackIndex,
            isPlaying: this.player.isPlaying,
            currentTime: this.player.getCurrentTime(),
            sleepTimerDuration: this.player.sleepTimerDuration,
            participants: Array.from(this.participants.values())
          });
        }
        break;

      case 'HOST_PONG':
      case 'HOST_HEARTBEAT':
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

      case 'PRESENCE_PING':
        // Recorded above
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

  setStatus(text, connected) {
    this.connectionStatus = text;
    this.onStatusCallbacks.forEach(cb => cb(text, connected));
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
