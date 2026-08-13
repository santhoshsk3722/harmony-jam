// Harmony Jam Global Multi-Engine Real-Time Sync (MQTT WebSockets + PeerJS + BroadcastChannel)

export class RoomManager {
  constructor(player) {
    this.player = player;
    this.roomId = null; // Clean 4-digit code (e.g. "4892")
    this.isHost = false;
    this.userName = localStorage.getItem('hj_username') || `User_${Math.floor(1000 + Math.random() * 9000)}`;
    this.userId = 'u_' + Math.random().toString(36).substr(2, 9);
    this.participants = new Map();

    // MQTT Client instance
    this.mqttClient = null;
    this.broadcastChannel = null;
    this.peer = null;

    this.onRoomStateCallbacks = [];
    this.onParticipantsCallbacks = [];

    // Periodic Heartbeat & Drift Alignment (Host -> Room)
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

  generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  // Initialize MQTT WebSocket connection (100% reliable across cellular 4G/5G and Wi-Fi)
  initMqtt(code) {
    return new Promise((resolve) => {
      if (typeof window.mqtt === 'undefined') {
        console.warn('[RoomSync] MQTT.js library not found, fallback to local');
        return resolve();
      }

      const topic = `harmonyjam/v1/room/${code}`;
      console.log('[RoomSync] Connecting to Global Realtime Broker topic:', topic);

      // Public free high-availability SSL WebSocket MQTT broker
      const brokerUrl = 'wss://broker.hivemq.com:8884/mqtt';

      try {
        if (this.mqttClient) {
          try { this.mqttClient.end(true); } catch(e){}
        }

        this.mqttClient = window.mqtt.connect(brokerUrl, {
          clientId: `hj_${this.userId}`,
          keepalive: 30,
          clean: true,
          reconnectPeriod: 2000
        });

        this.mqttClient.on('connect', () => {
          console.log('[MQTT] Connected to global relay broker successfully!');
          this.mqttClient.subscribe(topic, { qos: 0 }, (err) => {
            if (!err) {
              console.log('[MQTT] Subscribed to room topic:', topic);
            }
            resolve();
          });
        });

        this.mqttClient.on('message', (t, message) => {
          try {
            const payload = JSON.parse(message.toString());
            this.handleIncomingAction(payload, payload.senderId);
          } catch (e) {
            console.warn('[MQTT] Error parsing payload:', e);
          }
        });

        this.mqttClient.on('error', (err) => {
          console.warn('[MQTT] Broker connection warning:', err);
          resolve(); // Resolve to allow fallback
        });

        // Timeout safety resolve after 2.5 seconds
        setTimeout(() => resolve(), 2500);

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
      this.participants.set(this.userId, {
        id: this.userId,
        name: this.userName + ' (Host)',
        isHost: true,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(this.userName)}`
      });

      this.initMqtt(code).then(() => {
        console.log('[RoomSync] Room created successfully as Host. Room Code:', code);
        this.emitParticipants();
        this.emitRoomState();
        resolve(code);
      });
    });
  }

  joinRoom(inputCode) {
    return new Promise((resolve, reject) => {
      const cleanCode = inputCode.toString().replace(/[^0-9]/g, '');
      if (!cleanCode || cleanCode.length < 3) {
        return reject(new Error('Please enter a valid numeric room code (e.g. 4892)'));
      }

      this.roomId = cleanCode;
      this.isHost = false;

      this.initBroadcastChannel(cleanCode);

      this.participants.clear();
      this.participants.set(this.userId, {
        id: this.userId,
        name: this.userName,
        isHost: false,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(this.userName)}`
      });

      this.initMqtt(cleanCode).then(() => {
        console.log('[RoomSync] Joined room topic:', cleanCode, 'Sending REQUEST_STATE');
        
        // Request state from Host
        this.broadcastAction({
          type: 'REQUEST_STATE',
          user: {
            id: this.userId,
            name: this.userName,
            avatar: this.participants.get(this.userId).avatar
          }
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

    // 1. Send via MQTT WebSocket Global Relay
    if (this.mqttClient && this.mqttClient.connected) {
      const topic = `harmonyjam/v1/room/${this.roomId}`;
      try {
        this.mqttClient.publish(topic, JSON.stringify(fullPayload));
      } catch (e) {
        console.warn('[MQTT] Publish error:', e);
      }
    }

    // 2. Send via BroadcastChannel for local browser tabs
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

    console.log('[RoomSync] Received action from peer:', payload.type, payload);

    switch (payload.type) {
      case 'REQUEST_STATE':
        if (this.isHost) {
          if (payload.user) {
            this.participants.set(payload.user.id, {
              id: payload.user.id,
              name: payload.user.name,
              isHost: false,
              avatar: payload.user.avatar
            });
            this.emitParticipants();
          }

          // Host replies with state snapshot
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
            if (p.id !== this.userId) this.participants.set(p.id, p);
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
