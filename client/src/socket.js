import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  collection,
  query,
  where,
  onSnapshot,
  getDoc,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyBFd1KdOT2_tpAmTPqJ4cYm87FDZSisRN4',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'iplauction-5c41c.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'iplauction-5c41c',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'iplauction-5c41c.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '678425148616',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:678425148616:web:1e957faa5b185b05fe39fd',
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);

const API_BASE = import.meta.env.VITE_API_URL || '';

class FirestoreAuctionRealtimeBridge {
  constructor() {
    this.listeners = new Map();
    this.subscribedLocations = new Set();
    this.locationUnsubscribers = new Map();
    this.globalUnsubscribers = [];
    this.currentActivePlayerId = null;
    this.currentLivePlayer = null;
    this.activePlayerByLocation = new Map();
    this.previousPlayerStates = new Map();
    this.previousTeamStates = new Map();
    this.previousLocationStates = new Map();
    this.isFirestoreHealthy = false;

    // Start global listeners (once)
    this.initGlobalListeners();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    if (event === 'livePlayerUpdated') {
      if (this.currentLivePlayer && !this.currentLivePlayer.isCleared && this.currentLivePlayer.id) {
        try {
          callback(this.currentLivePlayer);
        } catch (err) {}
      } else {
        try {
          callback(null);
        } catch (err) {}
      }
    }
    return this;
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      if (callback) {
        this.listeners.get(event).delete(callback);
      } else {
        this.listeners.delete(event);
      }
    }
    return this;
  }

  emitLocal(event, data) {
    if (event === 'auctionReset') {
      this.currentActivePlayerId = null;
      this.currentLivePlayer = null;
      this.activePlayerByLocation.clear();
      this.previousPlayerStates.clear();
      this.previousLocationStates.clear();
    } else if (event === 'livePlayerCleared') {
      if (data?.locationId) {
        this.activePlayerByLocation.delete(String(data.locationId));
      }
      this.currentActivePlayerId = null;
      this.currentLivePlayer = null;
    }
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((cb) => {
        try {
          cb(data);
        } catch (err) {
          console.error(`[FirestoreRealtime] Error in ${event} listener:`, err);
        }
      });
    }
  }

  async emit(event, data) {
    try {
      if (event === 'joinLocation') {
        this.subscribeToLocation(data);
        return;
      }

      // Map auctioneer/team actions to authoritative backend endpoints
      if (event === 'setLivePlayer') {
        await fetch(`${API_BASE}/api/auction/set-live`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } else if (event === 'placeBid') {
        await fetch(`${API_BASE}/api/bids`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } else if (event === 'reverseBid') {
        await fetch(`${API_BASE}/api/auction/reverse-bid`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } else if (event === 'sellPlayer') {
        await fetch(`${API_BASE}/api/auction/sell`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } else if (event === 'unsoldPlayer') {
        await fetch(`${API_BASE}/api/auction/unsold`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } else if (event === 'reopenPlayer') {
        await fetch(`${API_BASE}/api/auction/reopen`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } else if (event === 'toggleBreak') {
        this.emitLocal('auctionBreakToggled', {
          locationId: data.locationId,
          show: Boolean(data.show),
        });
        const res = await fetch(`${API_BASE}/api/auction/break`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const resData = await res.json();
        if (resData && resData.paused !== undefined) {
          this.emitLocal('timerUpdated', resData);
        }
      } else if (event === 'toggleLeaderboard') {
        await fetch(`${API_BASE}/api/auction/leaderboard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } else if (event === 'issuePenalty') {
        await fetch(`${API_BASE}/api/penalties`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } else if (event === 'reversePenalty') {
        await fetch(`${API_BASE}/api/penalties?teamId=${data.teamId}`, {
          method: 'DELETE',
        });
      } else if (event === 'startAuctionCountdown') {
        this.emitLocal('auctionStarting', {
          locationId: data.locationId,
          seconds: data.seconds || 5,
          deadlineMs: Date.now() + (data.seconds || 5) * 1000,
        });
        await fetch(`${API_BASE}/api/auction/start-countdown`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      }
    } catch (error) {
      console.error(`[FirestoreRealtime] Failed to dispatch ${event}:`, error);
    }
  }

  initGlobalListeners() {
    // 1. Direct Real-Time Listener for any LIVE players across the entire tournament
    try {
      const livePlayersQuery = query(
        collection(db, 'players'),
        where('status', '==', 'LIVE')
      );
      const unsubLive = onSnapshot(
        livePlayersQuery,
        (snapshot) => {
          this.isFirestoreHealthy = true;
          if (snapshot.empty) {
            this.currentActivePlayerId = null;
            this.currentLivePlayer = null;
            this.activePlayerByLocation.clear();
            this.emitLocal('livePlayerCleared', { locationId: 'main_arena' });
            this.emitLocal('livePlayerUpdated', null);
            return;
          }
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added' || change.type === 'modified') {
              const data = change.doc.data();
              const player = { id: change.doc.id, ...data };
              this.currentActivePlayerId = player.id;
              this.currentLivePlayer = player;
              if (player.locationId) {
                this.activePlayerByLocation.set(String(player.locationId), player.id);
              }
              this.emitLocal('livePlayerUpdated', player);
            } else if (change.type === 'removed') {
              if (this.currentActivePlayerId === change.doc.id) {
                this.currentActivePlayerId = null;
                this.currentLivePlayer = null;
                this.emitLocal('livePlayerUpdated', null);
              }
            }
          });
        },
        (error) => console.warn('[Firestore] Global live player query warning:', error)
      );
      this.globalUnsubscribers.push(unsubLive);
    } catch (err) {
      console.warn('[Firestore] Global live query setup warning:', err);
    }
  }

  subscribeToLocation(locationId) {
    if (!locationId) return;
    const locIdStr = String(locationId);

    // Support multiple locations concurrently without wiping previous ones
    if (this.subscribedLocations.has(locIdStr)) {
      const activeInLoc = this.activePlayerByLocation.get(locIdStr);
      if (activeInLoc && this.currentLivePlayer && this.currentLivePlayer.id === activeInLoc) {
        this.emitLocal('livePlayerUpdated', this.currentLivePlayer);
      }
      return;
    }
    this.subscribedLocations.add(locIdStr);

    const locationUnsubs = [];

    // 1. Authoritative Venue Document Listener (locations/{locationId})
    try {
      const locDocRef = doc(db, 'locations', locIdStr);
      const unsubLoc = onSnapshot(
        locDocRef,
        async (docSnap) => {
          if (!docSnap.exists()) return;
          this.isFirestoreHealthy = true;
          const locData = docSnap.data();

          const currentActiveInLoc = this.activePlayerByLocation.get(locIdStr);
          if (locData.activePlayerId && locData.activePlayerId !== currentActiveInLoc) {
            this.activePlayerByLocation.set(locIdStr, locData.activePlayerId);
            this.currentActivePlayerId = locData.activePlayerId;
            try {
              const pSnap = await getDoc(doc(db, 'players', locData.activePlayerId));
              if (pSnap.exists()) {
                const livePlayerData = {
                  id: pSnap.id,
                  locationId: locIdStr,
                  ...pSnap.data(),
                  timerDeadlineMs: locData.timerDeadlineMs,
                  timerDurationSeconds: locData.timerDurationSeconds,
                };
                this.currentLivePlayer = livePlayerData;
                this.emitLocal('livePlayerUpdated', livePlayerData);
              }
            } catch (err) {}
          } else if (!locData.activePlayerId) {
            this.activePlayerByLocation.delete(locIdStr);
            if (this.currentActivePlayerId === currentActiveInLoc || !this.currentActivePlayerId) {
              this.currentActivePlayerId = null;
              this.currentLivePlayer = null;
            }
            this.emitLocal('livePlayerCleared', { locationId: locIdStr });
            this.emitLocal('livePlayerUpdated', null);
          }

          const prevLoc = this.previousLocationStates.get(locIdStr);
          if (prevLoc) {
            if (locData.isOnBreak !== prevLoc.isOnBreak) {
              this.emitLocal('auctionBreakToggled', {
                locationId: locIdStr,
                show: locData.isOnBreak,
              });
            }
            if (locData.leaderboardVisible !== prevLoc.leaderboardVisible) {
              this.emitLocal('leaderboardToggled', locData.leaderboardVisible);
            }
            if (
              locData.timerPaused !== prevLoc.timerPaused ||
              locData.timerDeadlineMs !== prevLoc.timerDeadlineMs ||
              locData.timerRemainingMs !== prevLoc.timerRemainingMs
            ) {
              this.emitLocal('timerUpdated', {
                locationId: locIdStr,
                deadlineMs: locData.timerDeadlineMs,
                paused: Boolean(locData.timerPaused),
                remainingMs: locData.timerRemainingMs,
                durationSeconds: locData.timerDurationSeconds,
              });
            }
          }
          this.previousLocationStates.set(locIdStr, locData);
        },
        (error) => console.warn('[Firestore] Location snapshot warning:', error)
      );
      locationUnsubs.push(unsubLoc);
    } catch (e) {}

    // 2. Listen to Players collection for bids, sales, unsold in this location
    try {
      const playersQuery = query(
        collection(db, 'players'),
        where('locationId', '==', locIdStr)
      );
      const unsubPlayers = onSnapshot(
        playersQuery,
        (snapshot) => {
          this.isFirestoreHealthy = true;
          snapshot.docChanges().forEach((change) => {
            const data = change.doc.data();
            const player = { id: change.doc.id, locationId: data.locationId || locIdStr, ...data };
            const prev = this.previousPlayerStates.get(player.id);

            if (change.type === 'added' || change.type === 'modified') {
              // Live player transition
              if (player.status === 'LIVE' && (!prev || prev.status !== 'LIVE')) {
                this.currentActivePlayerId = player.id;
                this.currentLivePlayer = player;
                this.activePlayerByLocation.set(locIdStr, player.id);
                this.emitLocal('livePlayerUpdated', player);
              }

              // New bid placed
              if (
                player.currentBid &&
                (!prev || prev.currentBid !== player.currentBid || prev.currentBidTeamId !== player.currentBidTeamId)
              ) {
                this.emitLocal('newBid', {
                  playerId: player.id,
                  teamId: player.currentBidTeamId,
                  amount: player.currentBid,
                  locationId: locIdStr,
                });
              }

              // Player sold
              if (player.status === 'SOLD' && (!prev || prev.status !== 'SOLD')) {
                if (this.currentActivePlayerId === player.id) {
                  this.currentActivePlayerId = null;
                  this.currentLivePlayer = null;
                  this.activePlayerByLocation.delete(locIdStr);
                }
                this.emitLocal('playerSold', player);
              }

              // Player unsold
              if (player.status === 'UNSOLD' && (!prev || prev.status !== 'UNSOLD')) {
                if (this.currentActivePlayerId === player.id) {
                  this.currentActivePlayerId = null;
                  this.currentLivePlayer = null;
                  this.activePlayerByLocation.delete(locIdStr);
                }
                this.emitLocal('playerUnsold', player);
              }

              // Player reopened
              if (
                player.status === 'LIVE' &&
                prev &&
                (prev.status === 'SOLD' || prev.status === 'UNSOLD')
              ) {
                this.currentActivePlayerId = player.id;
                this.currentLivePlayer = player;
                this.activePlayerByLocation.set(locIdStr, player.id);
                this.emitLocal('playerReopened', player);
              }
            }

            this.previousPlayerStates.set(player.id, player);
          });
        },
        (error) => console.warn('[Firestore] Players snapshot warning:', error)
      );
      locationUnsubs.push(unsubPlayers);
    } catch (e) {}

    // 3. Listen to Teams for penalties and budgets
    try {
      const teamsQuery = query(
        collection(db, 'teams'),
        where('locationId', '==', locIdStr)
      );
      const unsubTeams = onSnapshot(
        teamsQuery,
        (snapshot) => {
          this.isFirestoreHealthy = true;
          snapshot.docChanges().forEach((change) => {
            const team = { id: change.doc.id, ...change.doc.data() };
            const prev = this.previousTeamStates.get(team.id);

            if (
              prev &&
              (team.mistakes !== prev.mistakes || team.isDisqualified !== prev.isDisqualified)
            ) {
              this.emitLocal('penaltyIssued', {
                teamId: team.id,
                mistakes: team.mistakes || 0,
                isDisqualified: Boolean(team.isDisqualified),
              });
            }

            this.previousTeamStates.set(team.id, team);
          });
        },
        (error) => console.warn('[Firestore] Teams snapshot warning:', error)
      );
      locationUnsubs.push(unsubTeams);
    } catch (e) {}

    // 4. SSE Real-time Stream Bridge (Guarantees immediate zero-config synchronization)
    try {
      if (typeof window !== 'undefined' && window.EventSource) {
        const es = new EventSource(`${API_BASE}/api/events?locationId=${locIdStr}`);
        const eventNames = [
          'livePlayerUpdated',
          'newBid',
          'playerSold',
          'playerUnsold',
          'playerReopened',
          'bidReversed',
          'auctionBreakToggled',
          'leaderboardToggled',
          'penaltyIssued',
          'auctionStarting',
          'timerUpdated',
          'auctionReset',
        ];

        eventNames.forEach((evName) => {
          es.addEventListener(evName, (e) => {
            try {
              const data = JSON.parse(e.data);
              if (evName === 'auctionReset') {
                this.currentActivePlayerId = null;
                this.currentLivePlayer = null;
                this.activePlayerByLocation.clear();
                this.previousPlayerStates.clear();
                this.previousLocationStates.clear();
                this.emitLocal('auctionReset', data);
                this.emitLocal('livePlayerCleared', { locationId: data?.locationId || locIdStr });
                this.emitLocal('livePlayerUpdated', null);
                return;
              }
              this.emitLocal(evName, data);
              if (evName === 'bidReversed') {
                this.emitLocal('newBid', {
                  playerId: data.playerId,
                  teamId: data.previousTeamId,
                  amount: data.previousAmount,
                  locationId: data.locationId,
                });
              }
            } catch (err) {}
          });
        });

        locationUnsubs.push(() => es.close());
      }
    } catch (err) {}

    // 5. High-Frequency Real-Time Sync Poller (800ms interval guarantees instant synchronization across all panels)
    let lastPolledBidAmount = null;
    let lastPolledPlayerId = null;
    let lastPolledStatus = null;
    const poller = setInterval(async () => {
      try {
        const locRes = await fetch(`${API_BASE}/api/locations`);
        if (!locRes.ok) return;
        const locs = await locRes.json();
        const currentLoc = Array.isArray(locs) ? locs.find(l => String(l.id) === locIdStr) : null;
        
        if (currentLoc) {
          if (!currentLoc.activePlayerId && this.currentActivePlayerId) {
            this.currentActivePlayerId = null;
            this.currentLivePlayer = null;
            lastPolledPlayerId = null;
            lastPolledBidAmount = null;
            lastPolledStatus = null;
            this.activePlayerByLocation.delete(locIdStr);
            this.emitLocal('livePlayerCleared', { locationId: locIdStr });
            this.emitLocal('livePlayerUpdated', null);
          } else if (currentLoc.activePlayerId) {
            const pRes = await fetch(`${API_BASE}/api/players?locationId=${locIdStr}`);
            if (pRes.ok) {
              const all = await pRes.json();
              const active = all.find(p => p.id === currentLoc.activePlayerId);
              if (active) {
                const activePlayerObj = {
                  locationId: locIdStr,
                  ...active,
                  timerDeadlineMs: null,
                  timerDurationSeconds: null,
                  timerPaused: Boolean(currentLoc.timerPaused)
                };

                if (active.status === 'LIVE') {
                  if (active.id !== this.currentActivePlayerId || !this.currentLivePlayer || lastPolledStatus !== 'LIVE') {
                    this.currentActivePlayerId = active.id;
                    this.currentLivePlayer = activePlayerObj;
                    lastPolledPlayerId = active.id;
                    lastPolledBidAmount = active.currentBid;
                    lastPolledStatus = 'LIVE';
                    this.activePlayerByLocation.set(locIdStr, active.id);
                    this.emitLocal('livePlayerUpdated', activePlayerObj);
                  } else if (active.currentBid && active.currentBid !== lastPolledBidAmount) {
                    lastPolledBidAmount = active.currentBid;
                    this.emitLocal('newBid', {
                      playerId: active.id,
                      teamId: active.currentBidTeamId,
                      amount: active.currentBid,
                      locationId: locIdStr
                    });
                  }
                } else if (active.status === 'SOLD' && lastPolledStatus !== 'SOLD') {
                  lastPolledStatus = 'SOLD';
                  this.currentLivePlayer = activePlayerObj;
                  this.emitLocal('playerSold', activePlayerObj);
                  this.emitLocal('livePlayerUpdated', activePlayerObj);
                } else if (active.status === 'UNSOLD' && lastPolledStatus !== 'UNSOLD') {
                  lastPolledStatus = 'UNSOLD';
                  this.currentLivePlayer = activePlayerObj;
                  this.emitLocal('playerUnsold', activePlayerObj);
                  this.emitLocal('livePlayerUpdated', activePlayerObj);
                }
              }
            }
          }
        }
      } catch (e) {}
    }, 800);
    locationUnsubs.push(() => clearInterval(poller));

    this.locationUnsubscribers.set(locIdStr, locationUnsubs);
  }
}

const socket = new FirestoreAuctionRealtimeBridge();
export default socket;
