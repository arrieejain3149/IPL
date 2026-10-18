import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket';
import playerImageMap from '../playerImageMap.json';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function ViewerDashboard() {
  const navigate = useNavigate();
  const [locations, setLocations] = useState([]);
  const [livePlayers, setLivePlayers] = useState({});
  const [currentBids, setCurrentBids] = useState({});
  const [teams, setTeams] = useState([]);
  const [venueStats, setVenueStats] = useState({});
  const [breakModes, setBreakModes] = useState({});
  const [selectedLocationId, setSelectedLocationId] = useState(null);
  const [drawerVenueId, setDrawerVenueId] = useState(null);
  const [showStatsDrawer, setShowStatsDrawer] = useState(false);
  const [poolAnimation, setPoolAnimation] = useState(null);
  const [activityFeed, setActivityFeed] = useState([]);
  const [timers, setTimers] = useState({}); // { [locationId]: { deadlineMs, remainingSec, paused } }
  const [auctionStartingCountdown, setAuctionStartingCountdown] = useState(null);
  const currentPoolsRef = useRef({});
  const lastAudioPlayRef = useRef(0);

  // 5-Second Global Auction Starting Countdown ticker
  useEffect(() => {
    if (auctionStartingCountdown === null) return;
    if (auctionStartingCountdown > 0) {
      const timer = setTimeout(() => {
        setAuctionStartingCountdown(prev => (prev > 0 ? prev - 1 : 0));
      }, 1000);
      return () => clearTimeout(timer);
    } else if (auctionStartingCountdown === 0) {
      const timer = setTimeout(() => {
        setAuctionStartingCountdown(null);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [auctionStartingCountdown]);

  // Interval ticker for real-time second updates derived from server deadline
  useEffect(() => {
    const interval = setInterval(() => {
      setTimers(prev => {
        let changed = false;
        const next = { ...prev };
        Object.keys(next).forEach(locId => {
          const t = next[locId];
          if (t && t.deadlineMs && !t.paused) {
            const sec = Math.max(0, Math.ceil((t.deadlineMs - Date.now()) / 1000));
            if (sec !== t.remainingSec) {
              next[locId] = { ...t, remainingSec: sec };
              changed = true;
            }
          }
        });
        return changed ? next : prev;
      });
    }, 250);

    return () => clearInterval(interval);
  }, []);

  const addActivity = (activity) => {
    setActivityFeed(prev => {
      const newFeed = [activity, ...prev];
      return newFeed.slice(0, 50);
    });
  };

  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.1);
    } catch (e) {
      console.log('Audio autoplay blocked', e);
    }
  };

  const playTransitionSound = () => {
    try {
      const now = Date.now();
      if (now - lastAudioPlayRef.current < 3000) return;
      lastAudioPlayRef.current = now;

      const audio = new Audio('/transition.mp3');
      audio.volume = 0.8;
      audio.play().catch(e => console.log('Audio autoplay blocked', e));
    } catch (e) {
      console.log('Audio play error', e);
    }
  };

  useEffect(() => {
    fetch(API_URL + '/api/teams')
      .then(res => res.json())
      .then(data => setTeams(data))
      .catch(console.error);

    fetch(API_URL + '/api/locations')
      .then(res => res.json())
      .then(fetchedLocs => {
        setLocations(fetchedLocs);
        if (fetchedLocs.length > 0 && !drawerVenueId) {
          setDrawerVenueId(fetchedLocs[0].id);
        }

        fetchedLocs.forEach(loc => {
          socket.emit('joinLocation', loc.id);

          fetch(`${API_URL}/api/locations/${loc.id}/players`)
            .then(res => res.json())
            .then(data => {
              const soldPlayers = data.filter(p => p.status === 'SOLD');
              const lastSold = soldPlayers.length > 0 ? soldPlayers[soldPlayers.length - 1] : null;
              const topBuys = [...soldPlayers].sort((a, b) => b.soldPrice - a.soldPrice).slice(0, 4);
              const totalSpent = soldPlayers.reduce((sum, p) => sum + (p.soldPrice || 0), 0);
              const playersSold = soldPlayers.length;
              
              setVenueStats(prev => ({
                ...prev,
                [loc.id]: { lastSold, topBuys, totalSpent, playersSold }
              }));
              
              const livePlayer = data.find(p => p.status === 'LIVE') || null;
              setLivePlayers(prev => ({ ...prev, [loc.id]: livePlayer }));
              if (!livePlayer) {
                setCurrentBids(prev => {
                  const next = { ...prev };
                  delete next[loc.id];
                  return next;
                });
                setTimers(prev => {
                  const next = { ...prev };
                  delete next[loc.id];
                  return next;
                });
              }
            })
            .catch(console.error);
        });
      })
      .catch(console.error);

    socket.on('livePlayerUpdated', (player) => {
      setLivePlayers(prev => ({ ...prev, [player.locationId]: player }));
      if (player?.timerDeadlineMs) {
        setTimers(prev => ({
          ...prev,
          [player.locationId]: {
            deadlineMs: player.timerDeadlineMs,
            remainingSec: Math.max(0, Math.ceil((player.timerDeadlineMs - Date.now()) / 1000)),
            paused: false
          }
        }));
      }
    });

    socket.on('timerUpdated', (data) => {
      setTimers(prev => ({
        ...prev,
        [data.locationId]: {
          deadlineMs: data.deadlineMs,
          remainingSec: data.deadlineMs 
            ? Math.max(0, Math.ceil((data.deadlineMs - Date.now()) / 1000))
            : (data.remainingMs ? Math.max(0, Math.ceil(data.remainingMs / 1000)) : 0),
          paused: Boolean(data.paused)
        }
      }));
    });

    socket.on('newBid', (data) => {
      playBeep();
      setCurrentBids(prev => ({ ...prev, [data.locationId]: data }));
      addActivity({
        type: 'BID',
        teamId: data.teamId,
        amount: data.amount,
        playerId: data.playerId,
        locationId: data.locationId,
        timestamp: Date.now()
      });
    });

    socket.on('playerSold', (player) => {
      setLivePlayers(prev => ({ ...prev, [player.locationId]: player }));
      setCurrentBids(prev => {
        const next = { ...prev };
        delete next[player.locationId];
        return next;
      });

      addActivity({
        type: 'SOLD',
        player,
        teamId: player.teamId,
        amount: player.soldPrice,
        locationId: player.locationId,
        timestamp: Date.now()
      });

      // Update venue stats
      setVenueStats(prev => {
        const current = prev[player.locationId] || { topBuys: [], totalSpent: 0, playersSold: 0 };
        const newBuys = [...current.topBuys, player].sort((a, b) => b.soldPrice - a.soldPrice).slice(0, 4);
        return {
          ...prev,
          [player.locationId]: {
            lastSold: player,
            topBuys: newBuys,
            totalSpent: current.totalSpent + (player.soldPrice || 0),
            playersSold: current.playersSold + 1
          }
        };
      });
    });

    socket.on('playerUnsold', (player) => {
      setLivePlayers(prev => ({ ...prev, [player.locationId]: player }));
      setCurrentBids(prev => {
        const next = { ...prev };
        delete next[player.locationId];
        return next;
      });

      addActivity({
        type: 'UNSOLD',
        player,
        locationId: player.locationId,
        timestamp: Date.now()
      });
    });

    socket.on('auctionBreakToggled', (data) => {
      setBreakModes(prev => ({ ...prev, [data.locationId]: data.show }));
    });

    socket.on('auctionStarting', (data) => {
      const remaining = data.seconds || 5;
      setAuctionStartingCountdown(remaining);
    });

    socket.on('auctionReset', (data) => {
      const locId = data?.locationId || selectedLocationId || locations[0]?.id || '1';
      setLivePlayers(prev => ({ ...prev, [locId]: null }));
      setCurrentBids(prev => {
        const next = { ...prev };
        delete next[locId];
        return next;
      });
      setTimers(prev => {
        const next = { ...prev };
        delete next[locId];
        return next;
      });
      setVenueStats(prev => ({
        ...prev,
        [locId]: { lastSold: null, topBuys: [], totalSpent: 0, playersSold: 0 }
      }));
      addActivity({
        type: 'RESET',
        locationId: locId,
        timestamp: Date.now()
      });
    });

    return () => {
      socket.off('livePlayerUpdated');
      socket.off('timerUpdated');
      socket.off('newBid');
      socket.off('playerSold');
      socket.off('playerUnsold');
      socket.off('auctionBreakToggled');
      socket.off('auctionStarting');
      socket.off('auctionReset');
    };
  }, []);

  useEffect(() => {
    if (selectedLocationId && livePlayers[selectedLocationId]) {
      const currentPlayer = livePlayers[selectedLocationId];
      if (currentPlayer.status === 'LIVE' && currentPlayer.pool) {
        const currentPool = currentPoolsRef.current[selectedLocationId];
        if (currentPool !== currentPlayer.pool) {
          playTransitionSound();
          setPoolAnimation(currentPlayer.pool);
          setTimeout(() => setPoolAnimation(null), 3500);
          currentPoolsRef.current[selectedLocationId] = currentPlayer.pool;
        }
      }
    }
  }, [livePlayers, selectedLocationId]);

  const getTeamName = (teamId) => {
    const team = teams.find(t => String(t.id) === String(teamId));
    return team ? team.name : 'Unknown Franchise';
  };

  const getTeamShortName = (teamId) => {
    const team = teams.find(t => String(t.id) === String(teamId));
    if (!team) return 'Franchise';
    return team.shortName || team.franchiseCode || team.name;
  };

  const formatPrice = (amt) => {
    if (!amt) return '₹0 Cr';
    const cr = amt / 10000000;
    return Number.isInteger(cr) ? `₹${cr} Cr` : `₹${cr.toFixed(2)} Cr`;
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.log(`Fullscreen error: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  // Reusable Top-Right Action Buttons: [ ← Back ] [ ⛶ Fullscreen ] [ Home ]
  // No home logo, professional back arrow (Requirement 3)
  const renderHeaderActions = (showBack = true) => (
    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
      {showBack && (
        <button
          onClick={() => setSelectedLocationId(null)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            background: 'rgba(20, 27, 37, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            color: '#ffffff',
            padding: '0.45rem 0.95rem',
            borderRadius: '6px',
            fontSize: '0.82rem',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            fontFamily: 'Inter, sans-serif'
          }}
          onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
          onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)'; e.currentTarget.style.background = 'rgba(20, 27, 37, 0.85)'; }}
        >
          <span style={{ fontSize: '1rem', lineHeight: 1 }}>←</span> Back
        </button>
      )}
      <button
        onClick={toggleFullScreen}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          background: 'rgba(20, 27, 37, 0.85)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          color: '#ffffff',
          padding: '0.45rem 0.95rem',
          borderRadius: '6px',
          fontSize: '0.82rem',
          fontWeight: '600',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          fontFamily: 'Inter, sans-serif'
        }}
        onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
        onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)'; e.currentTarget.style.background = 'rgba(20, 27, 37, 0.85)'; }}
      >
        <span>⛶</span> Fullscreen
      </button>
      <button
        onClick={() => navigate('/')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          background: 'rgba(20, 27, 37, 0.85)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          color: '#ffffff',
          padding: '0.45rem 0.95rem',
          borderRadius: '6px',
          fontSize: '0.82rem',
          fontWeight: '600',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          fontFamily: 'Inter, sans-serif'
        }}
        onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
        onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)'; e.currentTarget.style.background = 'rgba(20, 27, 37, 0.85)'; }}
      >
        Home
      </button>
    </div>
  );

  // Left Sidebar: Live Feed (Image 1 & 3)
  const renderSidebar = () => {
    return (
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100%', 
        background: 'rgba(16, 21, 29, 0.85)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '12px',
        padding: '1.5rem',
        boxSizing: 'border-box',
        overflow: 'hidden',
        position: 'relative'
      }}>
        {/* Header */}
        <div style={{ marginBottom: '1.25rem' }}>
          <h3 style={{ fontSize: '1.4rem', fontWeight: '800', color: '#ffffff', margin: 0, fontFamily: 'Outfit, sans-serif' }}>
            Live Feed
          </h3>
          <p style={{ color: 'var(--text-muted, #808ea3)', fontSize: '0.85rem', margin: '0.25rem 0 0 0', fontFamily: 'Inter, sans-serif' }}>
            Real-time auction activity...
          </p>
        </div>
        
        {/* Activity Stream */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingRight: '0.25rem' }}>
          {activityFeed.length === 0 ? (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              height: '100%', 
              color: 'var(--text-muted, #64748b)', 
              fontSize: '0.9rem', 
              fontStyle: 'italic',
              fontFamily: 'Inter, sans-serif'
            }}>
              Waiting for activity...
            </div>
          ) : (
            activityFeed.map((activity, idx) => (
              <div key={idx} style={{ 
                background: 'rgba(10, 13, 18, 0.75)', 
                padding: '0.75rem 0.9rem', 
                borderRadius: '6px', 
                borderLeft: activity.type === 'BID' 
                  ? '3px solid var(--gold-primary, #d4af37)' 
                  : activity.type === 'SOLD' 
                    ? '3px solid var(--emerald-live, #00e599)' 
                    : activity.type === 'RESET'
                      ? '3px solid var(--amber-warning, #f59e0b)'
                      : '3px solid var(--crimson-danger, #ef4444)',
                borderTop: '1px solid rgba(255,255,255,0.04)',
                borderRight: '1px solid rgba(255,255,255,0.04)',
                borderBottom: '1px solid rgba(255,255,255,0.04)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem', fontSize: '0.7rem', color: 'var(--text-dim, #4b586d)', fontFamily: 'JetBrains Mono, monospace' }}>
                  <span>{new Date(activity.timestamp).toLocaleTimeString()}</span>
                  <span>{locations.find(l => String(l.id) === String(activity.locationId))?.name}</span>
                </div>
                {activity.type === 'BID' && (
                  <div style={{ fontSize: '0.85rem' }}>
                    <strong style={{ color: '#ffffff' }}>{getTeamName(activity.teamId)}</strong> bid <span style={{ color: 'var(--gold-bright, #f0cc5d)', fontWeight: '700', fontFamily: 'JetBrains Mono, monospace' }}>₹{(activity.amount / 10000000).toFixed(2)} Cr</span>
                  </div>
                )}
                {activity.type === 'SOLD' && (
                  <div style={{ fontSize: '0.85rem' }}>
                    <strong style={{ color: '#ffffff' }}>{activity.player?.name}</strong> SOLD to <strong style={{ color: 'var(--emerald-live, #00e599)' }}>{getTeamName(activity.teamId)}</strong> for ₹{(activity.amount / 10000000).toFixed(2)} Cr
                  </div>
                )}
                {activity.type === 'UNSOLD' && (
                  <div style={{ fontSize: '0.85rem' }}>
                    <strong style={{ color: '#ffffff' }}>{activity.player?.name}</strong> went <span style={{ color: 'var(--crimson-danger, #ef4444)', fontWeight: '700' }}>UNSOLD</span>
                  </div>
                )}
                {activity.type === 'RESET' && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--amber-warning, #f59e0b)' }}>
                    ⚡ <strong>AUCTION SESSION RESET</strong>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer Note */}
        <div style={{ 
          paddingTop: '0.85rem', 
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          color: 'var(--text-muted, #64748b)', 
          fontSize: '0.72rem', 
          lineHeight: '1.4',
          fontFamily: 'Inter, sans-serif'
        }}>
          * Note: Sound will play on new bids if you have interacted with the page.
        </div>
      </div>
    );
  };

  // 1- Global Auction View across all venues (Image 1)
  const renderGlobalView = () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Top Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '800', color: '#ffffff', margin: 0, fontFamily: 'Outfit, sans-serif' }}>
            Global Auction View
          </h2>
          <p style={{ color: 'var(--text-muted, #808ea3)', fontSize: '0.85rem', margin: '0.2rem 0 0 0', fontFamily: 'Inter, sans-serif' }}>
            Select any venue below to enter its live lot & bidding feed
          </p>
        </div>
        {renderHeaderActions(false)}
      </div>

      {/* Venue Cards Grid */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', 
        gap: '1.25rem',
        alignContent: 'start',
        flex: 1,
        overflowY: 'auto',
        paddingRight: '0.25rem'
      }}>
        {locations.map(loc => {
          const livePlayer = livePlayers[loc.id];
          const isLive = livePlayer && livePlayer.status === 'LIVE';
          const stats = venueStats[loc.id] || { totalSpent: 0, playersSold: 0 };
          const activeBid = currentBids[loc.id];
          const isBreak = breakModes[loc.id];

          return (
            <div
              key={loc.id}
              onClick={() => {
                setSelectedLocationId(loc.id);
                setDrawerVenueId(loc.id);
              }}
              style={{
                background: 'rgba(16, 21, 29, 0.85)',
                border: isLive ? '1px solid rgba(59, 130, 246, 0.35)' : '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '1.5rem',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
                position: 'relative',
                boxShadow: isLive ? '0 10px 30px rgba(0,0,0,0.4), 0 0 15px rgba(59, 130, 246, 0.15)' : 'none',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.borderColor = isLive ? 'rgba(59, 130, 246, 0.6)' : 'rgba(255, 255, 255, 0.2)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.borderColor = isLive ? 'rgba(59, 130, 246, 0.35)' : 'rgba(255, 255, 255, 0.08)';
              }}
            >
              {isBreak && (
                <div style={{
                  position: 'absolute',
                  top: 0, left: 0, right: 0, bottom: 0,
                  background: 'rgba(6, 8, 11, 0.88)',
                  zIndex: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '12px',
                  backdropFilter: 'blur(4px)'
                }}>
                  <span className="badge badge-gold" style={{ fontSize: '0.8rem' }}>OFFICIAL RECESS</span>
                </div>
              )}

              {/* Card Header: Name + Status Badge */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ fontSize: '1.35rem', fontWeight: '700', color: '#ffffff', margin: 0, fontFamily: 'Outfit, sans-serif' }}>
                    {loc.name}
                  </h3>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-dim, #64748b)', fontFamily: 'JetBrains Mono, monospace' }}>
                    Click to Enter Feed &rarr;
                  </span>
                </div>
                {isLive ? (
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    padding: '0.3rem 0.75rem',
                    borderRadius: '50px',
                    color: '#ef4444',
                    fontSize: '0.75rem',
                    fontWeight: '700',
                    letterSpacing: '0.06em'
                  }}>
                    <span className="live-pulse-dot" style={{ width: '6px', height: '6px', background: '#ef4444' }}></span>
                    LIVE NOW
                  </div>
                ) : (
                  <div style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    padding: '0.3rem 0.75rem',
                    borderRadius: '50px',
                    color: 'var(--text-muted, #94a3b8)',
                    fontSize: '0.75rem',
                    fontWeight: '600'
                  }}>
                    Idle
                  </div>
                )}
              </div>

              {/* Card Body */}
              {isLive ? (
                <div style={{
                  background: 'rgba(10, 13, 18, 0.7)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  borderRadius: '8px',
                  padding: '1.1rem 1.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  marginTop: '1.25rem'
                }}>
                  {/* Circle avatar */}
                  <div style={{
                    width: '52px',
                    height: '52px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #1e293b, #0f172a)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <img
                      src={livePlayer.imageUrl || playerImageMap[livePlayer.name?.toLowerCase().replace(/[^a-z]/g, '')] || `https://ui-avatars.com/api/?name=${encodeURIComponent(livePlayer.name || 'Player')}&background=141b25&color=d4af37&size=128`}
                      alt={livePlayer.name}
                      style={{ width: '85%', height: '85%', objectFit: 'contain' }}
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: '1.15rem', fontWeight: '700', color: '#ffffff', fontFamily: 'Outfit, sans-serif' }}>
                      {livePlayer.name}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted, #94a3b8)', fontFamily: 'JetBrains Mono, monospace', marginTop: '0.2rem' }}>
                      {activeBid ? (
                        <span>Bid: <strong style={{ color: 'var(--gold-bright, #f0cc5d)' }}>₹{(activeBid.amount / 10000000).toFixed(2)} Cr</strong></span>
                      ) : (
                        <span>Base: ₹{((livePlayer.basePrice || 0) / 10000000).toFixed(livePlayer.basePrice % 10000000 === 0 ? 0 : 2)} Cr</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{
                  background: 'rgba(10, 13, 18, 0.6)',
                  border: '1px dashed rgba(255, 255, 255, 0.08)',
                  borderRadius: '8px',
                  padding: '1.25rem 1rem',
                  display: 'flex',
                  justifyContent: 'space-around',
                  alignItems: 'center',
                  marginTop: '1.25rem'
                }}>
                  <div style={{ textAlign: 'center', flex: 1 }}>
                    <div style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.35rem', fontFamily: 'JetBrains Mono, monospace' }}>
                      PLAYERS SOLD
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#ffffff', fontFamily: 'Outfit, sans-serif' }}>
                      {stats.playersSold || 0}
                    </div>
                  </div>
                  <div style={{ width: '1px', height: '35px', background: 'rgba(255, 255, 255, 0.08)' }}></div>
                  <div style={{ textAlign: 'center', flex: 1 }}>
                    <div style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.35rem', fontFamily: 'JetBrains Mono, monospace' }}>
                      TOTAL SPENT
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#ffffff', fontFamily: 'Outfit, sans-serif' }}>
                      ₹{((stats.totalSpent || 0) / 10000000).toFixed(2)} Cr
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  // Particular Venue Details View (Image 2: Idle or Live Lot)
  const renderDetailedView = () => {
    const loc = locations.find(l => String(l.id) === String(selectedLocationId)) || locations[0];
    if (!loc) return null;

    const player = livePlayers[loc.id];
    const activeBid = currentBids[loc.id];

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        
        {/* Recess Overlay */}
        {breakModes[loc.id] && (
          <div style={{ 
            position: 'absolute', 
            top: 0, 
            left: 0, 
            width: '100%', 
            height: '100%', 
            background: 'rgba(6, 8, 11, 0.96)', 
            zIndex: 100, 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center', 
            backdropFilter: 'blur(12px)',
            borderRadius: '12px'
          }}>
            <span className="badge badge-gold" style={{ fontSize: '1rem', padding: '0.5rem 1.5rem', marginBottom: '1.5rem', letterSpacing: '0.2em' }}>
              OFFICIAL RECESS
            </span>
            <h1 style={{ fontSize: '3.5rem', color: '#ffffff', letterSpacing: '-0.02em', textAlign: 'center', fontWeight: '900', margin: 0 }}>
              AUCTION SESSION PAUSED
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', marginTop: '0.75rem', fontFamily: 'JetBrains Mono, monospace' }}>
              PROCEEDINGS WILL RESUME MOMENTARILY
            </p>
          </div>
        )}

        {/* Live Player Lot */}
        {player && player.status === 'LIVE' ? (
          <div style={{ 
            flex: 1, 
            display: 'flex', 
            flexDirection: 'column', 
            justifyContent: 'space-between',
            padding: '2.5rem 3rem',
            background: 'radial-gradient(ellipse at 80% 20%, rgba(30, 41, 59, 0.4) 0%, rgba(16, 21, 29, 0.95) 70%, rgba(10, 13, 18, 0.98) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '14px',
            position: 'relative',
            overflow: 'hidden',
            boxSizing: 'border-box'
          }}>
            {/* Top Row: Red Accent + PLAYER PROFILE on left, and Header Actions on right */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {/* Red bracket accent */}
                <div style={{
                  width: '10px',
                  height: '24px',
                  borderLeft: '4px solid #ef4444',
                  borderTop: '4px solid #ef4444'
                }} />
                <span style={{
                  color: '#ef4444',
                  fontSize: '0.9rem',
                  fontWeight: '700',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  fontFamily: 'JetBrains Mono, monospace'
                }}>
                  PLAYER PROFILE // {loc.name}
                </span>

                {/* Deadline Timer Badge */}
                {timers[loc.id] && (
                  <div style={{
                    marginLeft: '1.5rem',
                    padding: '0.25rem 0.75rem',
                    background: timers[loc.id].paused 
                      ? 'var(--amber-surface)' 
                      : (timers[loc.id].remainingSec <= 5 ? 'var(--crimson-surface)' : 'rgba(212, 175, 55, 0.1)'),
                    border: `1px solid ${timers[loc.id].paused 
                      ? 'var(--amber-border)' 
                      : (timers[loc.id].remainingSec <= 5 ? 'var(--crimson-border)' : 'var(--gold-border)')}`,
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontFamily: 'JetBrains Mono, monospace'
                  }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>TIME:</span>
                    <span style={{
                      fontSize: '1rem',
                      fontWeight: '900',
                      color: timers[loc.id].paused 
                        ? 'var(--amber-warning)' 
                        : (timers[loc.id].remainingSec <= 5 ? 'var(--crimson-danger)' : 'var(--gold-bright)')
                    }}>
                      {timers[loc.id].paused ? 'PAUSED' : `${timers[loc.id].remainingSec}s`}
                    </span>
                  </div>
                )}
              </div>

              {renderHeaderActions(true)}
            </div>

            {/* Middle Content Row: Data on left, Player image on right */}
            <div style={{ zIndex: 20, display: 'flex', flexDirection: 'column', marginTop: '1.5rem', maxWidth: '65%' }}>
              {/* Player Name */}
              <h1 style={{
                fontSize: player.name.length > 15 ? '3.5rem' : '4.5rem',
                fontWeight: '900',
                color: '#ffffff',
                textTransform: 'uppercase',
                letterSpacing: '0.02em',
                margin: '0 0 1.5rem 0',
                fontFamily: 'Outfit, sans-serif',
                lineHeight: 1.05
              }}>
                {player.name}
              </h1>

              {/* Badges Row */}
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '2.5rem' }}>
                {/* Rating Badge */}
                <div style={{
                  background: 'rgba(20, 27, 37, 0.85)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '50px',
                  padding: '0.45rem 1.25rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.88rem',
                  fontFamily: 'Inter, sans-serif'
                }}>
                  <span style={{ color: 'var(--text-muted, #94a3b8)', fontWeight: '600', letterSpacing: '0.08em', fontSize: '0.78rem' }}>RATING</span>
                  <span style={{ color: '#ffffff', fontWeight: '800' }}>{player.points || 57}</span>
                </div>

                {/* Nation Badge */}
                <div style={{
                  background: 'rgba(20, 27, 37, 0.85)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '50px',
                  padding: '0.45rem 1.25rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.88rem',
                  fontFamily: 'Inter, sans-serif'
                }}>
                  <span style={{ color: 'var(--text-muted, #94a3b8)', fontWeight: '600', letterSpacing: '0.08em', fontSize: '0.78rem' }}>NATION</span>
                  <span style={{ color: '#ffffff', fontWeight: '800', textTransform: 'uppercase' }}>{player.country || 'INDIA'}</span>
                </div>

                {/* Category Pill */}
                <div style={{
                  background: 'rgba(30, 41, 59, 0.7)',
                  border: '1px solid rgba(96, 165, 250, 0.4)',
                  borderRadius: '50px',
                  padding: '0.45rem 1.4rem',
                  color: '#93c5fd',
                  fontWeight: '800',
                  fontSize: '0.88rem',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  fontFamily: 'Inter, sans-serif'
                }}>
                  {player.category ? `${(player.country && player.country.toLowerCase() !== 'india' ? 'OVERSEAS ' : '')}${player.category.replace('_', ' ')}` : 'OVERSEAS BOWLER'}
                </div>
              </div>

              {/* Two-Column Stats Row: IPL DEBUT & BASE PRICE */}
              <div style={{ display: 'flex', gap: '5rem', marginBottom: '3rem' }}>
                <div>
                  <div style={{
                    color: 'var(--text-muted, #94a3b8)',
                    fontSize: '0.8rem',
                    fontWeight: '700',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    marginBottom: '0.4rem',
                    fontFamily: 'JetBrains Mono, monospace'
                  }}>
                    IPL DEBUT
                  </div>
                  <div style={{
                    fontSize: '2.5rem',
                    fontWeight: '900',
                    color: '#ffffff',
                    fontFamily: 'Outfit, sans-serif'
                  }}>
                    {player.debut || 'N/A'}
                  </div>
                </div>

                <div>
                  <div style={{
                    color: 'var(--text-muted, #94a3b8)',
                    fontSize: '0.8rem',
                    fontWeight: '700',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    marginBottom: '0.4rem',
                    fontFamily: 'JetBrains Mono, monospace'
                  }}>
                    BASE PRICE
                  </div>
                  <div style={{
                    fontSize: '2.75rem',
                    fontWeight: '900',
                    color: 'var(--gold-bright, #f0cc5d)',
                    fontFamily: 'Outfit, sans-serif'
                  }}>
                    ₹{((player.basePrice || 0) / 10000000).toFixed((player.basePrice || 0) % 10000000 === 0 ? 0 : 2)} CR
                  </div>
                </div>
              </div>

              {/* Current Bid Box */}
              <div style={{
                width: '360px',
                background: 'rgba(10, 13, 18, 0.8)',
                border: activeBid ? '1px solid var(--gold-border, rgba(212,175,55,0.4))' : '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '10px',
                padding: '1.25rem 1.5rem',
                boxShadow: activeBid ? '0 0 20px rgba(212, 175, 55, 0.15)' : 'none'
              }}>
                <div style={{
                  color: 'var(--text-muted, #94a3b8)',
                  fontSize: '0.78rem',
                  fontWeight: '700',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  marginBottom: '0.5rem',
                  fontFamily: 'JetBrains Mono, monospace'
                }}>
                  CURRENT BID
                </div>

                {activeBid ? (
                  <div>
                    <div style={{
                      fontSize: '2rem',
                      fontWeight: '900',
                      color: 'var(--gold-bright, #f0cc5d)',
                      fontFamily: 'JetBrains Mono, monospace',
                      lineHeight: 1.1
                    }}>
                      ₹{(activeBid.amount / 10000000).toFixed(2)} Cr
                    </div>
                    <div style={{
                      fontSize: '1rem',
                      fontWeight: '800',
                      color: '#ffffff',
                      marginTop: '0.35rem',
                      fontFamily: 'Inter, sans-serif'
                    }}>
                      {getTeamName(activeBid.teamId)}
                    </div>
                  </div>
                ) : (
                  <div style={{
                    fontSize: '1rem',
                    color: 'var(--text-muted, #64748b)',
                    fontStyle: 'italic',
                    fontFamily: 'Inter, sans-serif'
                  }}>
                    Waiting for opening bid...
                  </div>
                )}
              </div>
            </div>

            {/* Player Image Render */}
            <img 
              src={player.imageUrl || playerImageMap[player.name?.toLowerCase().replace(/[^a-z]/g, '')] || `https://ui-avatars.com/api/?name=${encodeURIComponent(player.name || 'Player')}&background=141b25&color=d4af37&size=256`} 
              alt={player.name} 
              style={{ 
                position: 'absolute',
                bottom: 0,
                right: '6%',
                maxHeight: '92%',
                maxWidth: '45%',
                objectFit: 'contain',
                zIndex: 10,
                filter: 'drop-shadow(0 20px 40px rgba(0, 0, 0, 0.9))'
              }}
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />

            {/* Red bottom-right corner accent */}
            <div style={{
              position: 'absolute',
              bottom: '2.5rem',
              right: '2.5rem',
              width: '24px',
              height: '24px',
              borderBottom: '4px solid #ef4444',
              borderRight: '4px solid #ef4444',
              zIndex: 25
            }} />
          </div>
        ) : player && player.status === 'SOLD' ? (
          <div style={{ 
            flex: 1, 
            display: 'flex', 
            flexDirection: 'column', 
            borderRadius: '14px', 
            background: 'linear-gradient(145deg, rgba(20, 27, 37, 0.95), rgba(12, 16, 22, 0.98))',
            border: '1px solid var(--emerald-border, rgba(0, 229, 153, 0.35))',
            padding: '2.5rem',
            position: 'relative'
          }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
              {renderHeaderActions(true)}
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span className="badge badge-sold" style={{ fontSize: '1rem', padding: '0.5rem 1.5rem', marginBottom: '1.5rem', letterSpacing: '0.15em' }}>
                CONFIRMED SALE
              </span>
              <h1 style={{ color: '#ffffff', fontSize: '3.5rem', marginBottom: '0.5rem', fontWeight: '800', fontFamily: 'Outfit, sans-serif' }}>
                {player.name}
              </h1>
              <div style={{ color: 'var(--emerald-live, #00e599)', fontWeight: '900', fontSize: '3.5rem', fontFamily: 'JetBrains Mono, monospace' }}>
                ₹{(player.soldPrice / 10000000).toFixed(2)} Cr
              </div>
              <div style={{ fontSize: '1.4rem', color: 'var(--text-secondary)', marginTop: '0.75rem', fontFamily: 'Inter, sans-serif' }}>
                ACQUIRED BY: <strong style={{ color: '#ffffff' }}>{player.team?.name || getTeamName(player.teamId)}</strong>
              </div>
            </div>
          </div>
        ) : player && player.status === 'UNSOLD' ? (
          <div style={{ 
            flex: 1, 
            display: 'flex', 
            flexDirection: 'column', 
            borderRadius: '14px', 
            background: 'linear-gradient(145deg, rgba(20, 27, 37, 0.95), rgba(12, 16, 22, 0.98))',
            border: '1px solid var(--crimson-border, rgba(239, 68, 68, 0.35))',
            padding: '2.5rem',
            position: 'relative'
          }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
              {renderHeaderActions(true)}
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span className="badge badge-unsold" style={{ fontSize: '1rem', padding: '0.5rem 1.5rem', marginBottom: '1.5rem', letterSpacing: '0.15em' }}>
                PASSED UNSOLD
              </span>
              <h1 style={{ color: '#ffffff', fontSize: '3.5rem', marginBottom: '0.5rem', fontWeight: '800', fontFamily: 'Outfit, sans-serif' }}>
                {player.name}
              </h1>
              <p style={{ color: 'var(--text-muted)', fontSize: '1.2rem', fontFamily: 'JetBrains Mono, monospace' }}>
                LOT REMAINS IN RE-AUCTION REPOSITORY
              </p>
            </div>
          </div>
        ) : (
          /* Particular Venue Idle State (Image 2) */
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: '800', color: '#ffffff', margin: 0, fontFamily: 'Outfit, sans-serif' }}>
                {loc ? `${loc.name} Venue Details` : 'Venue Details'}
              </h2>
              {renderHeaderActions(true)}
            </div>

            {/* Main Stage Card with Recessed Box */}
            <div style={{
              flex: 1,
              background: 'rgba(16, 21, 29, 0.85)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              padding: '1.5rem',
              display: 'flex',
              position: 'relative',
              overflow: 'hidden'
            }}>
              <div style={{
                flex: 1,
                background: 'rgba(20, 27, 37, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.04)',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '2rem'
              }}>
                <p style={{
                  color: 'var(--text-muted, #94a3b8)',
                  fontSize: '1.1rem',
                  textAlign: 'center',
                  margin: 0,
                  fontFamily: 'Inter, sans-serif',
                  maxWidth: '600px',
                  lineHeight: 1.6
                }}>
                  No active bidding at the moment. Waiting for auctioneer to bring a player to the lot.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const isCinematic = selectedLocationId && livePlayers[selectedLocationId] && ['LIVE', 'SOLD', 'UNSOLD'].includes(livePlayers[selectedLocationId].status);

  // Determine which venue's stats to show in the drawer (Requirement 2 & 4)
  const activeStatsLocId = drawerVenueId || selectedLocationId || locations[0]?.id;
  const currentStatsVenue = locations.find(l => String(l.id) === String(activeStatsLocId)) || locations[0];
  const currentVenueStats = (currentStatsVenue && venueStats[currentStatsVenue.id]) || { lastSold: null, topBuys: [] };

  return (
    <div style={{ 
      minHeight: '100vh', 
      padding: '1.25rem', 
      boxSizing: 'border-box', 
      position: 'relative',
      background: 'var(--bg-black, #06080b)'
    }}>
      {/* 2-Column layout when idle (Global or Venue) or Full cinematic stage when player is active */}
      {isCinematic ? (
        <div style={{ height: 'calc(100vh - 2.5rem)' }}>
          {renderDetailedView()}
        </div>
      ) : (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '320px 1fr', 
          gap: '1.25rem',
          height: 'calc(100vh - 2.5rem)'
        }}>
          {renderSidebar()}
          {selectedLocationId ? renderDetailedView() : renderGlobalView()}
        </div>
      )}

      {/* Off-canvas Stats Drawer Toggle Button (Image 2 & 3) */}
      {!showStatsDrawer && (
        <button
          onClick={() => {
            if (selectedLocationId) {
              setDrawerVenueId(selectedLocationId);
            }
            setShowStatsDrawer(true);
          }}
          style={{
            position: 'fixed',
            top: '50%',
            right: 0,
            transform: 'translateY(-50%)',
            background: 'rgba(16, 21, 29, 0.95)',
            color: '#ffffff',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRight: 'none',
            padding: '1rem 0.6rem',
            borderTopLeftRadius: '6px',
            borderBottomLeftRadius: '6px',
            cursor: 'pointer',
            zIndex: 999,
            fontFamily: 'Inter, sans-serif',
            fontSize: '0.75rem',
            fontWeight: '700',
            letterSpacing: '0.1em',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            boxShadow: '-4px 0 15px rgba(0,0,0,0.6)'
          }}
        >
          <span>◀</span> STATS
        </button>
      )}

      {/* 2 & 4- Stats Drawer specifically for particular venue */}
      <div style={{
        position: 'fixed',
        top: 0,
        right: showStatsDrawer ? 0 : '-460px',
        width: '420px',
        height: '100vh',
        background: 'rgba(10, 13, 18, 0.98)',
        backdropFilter: 'blur(16px)',
        borderLeft: '1px solid var(--gold-border, rgba(212,175,55,0.28))',
        transition: 'right 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        zIndex: 1000,
        padding: '2rem',
        overflowY: 'auto',
        boxShadow: '-15px 0 40px rgba(0,0,0,0.8)',
        boxSizing: 'border-box'
      }}>
        {/* Header: Venue Stats (NO "IPL Mega Auction Arena 2026") */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1.4rem', color: '#ffffff', margin: 0, fontWeight: '800', fontFamily: 'Outfit, sans-serif' }}>
              Venue Stats
            </h2>
            {currentStatsVenue && (
              <span style={{ fontSize: '0.8rem', color: 'var(--gold-bright, #f0cc5d)', fontFamily: 'JetBrains Mono, monospace' }}>
                {currentStatsVenue.name}
              </span>
            )}
          </div>
          <button 
            onClick={() => setShowStatsDrawer(false)}
            className="btn btn-secondary"
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
          >
            CLOSE
          </button>
        </div>

        {/* Venue Switcher Pills inside Drawer if multiple venues exist */}
        {locations.length > 1 && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.75rem', flexWrap: 'wrap' }}>
            {locations.map(loc => (
              <button
                key={loc.id}
                onClick={() => setDrawerVenueId(loc.id)}
                style={{
                  background: String(activeStatsLocId) === String(loc.id) ? 'var(--gold-surface, rgba(212,175,55,0.18))' : 'rgba(255,255,255,0.04)',
                  border: String(activeStatsLocId) === String(loc.id) ? '1px solid var(--gold-border, rgba(212,175,55,0.5))' : '1px solid rgba(255,255,255,0.08)',
                  color: String(activeStatsLocId) === String(loc.id) ? 'var(--gold-bright, #f0cc5d)' : 'var(--text-muted, #94a3b8)',
                  padding: '0.35rem 0.85rem',
                  borderRadius: '50px',
                  fontSize: '0.78rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  fontFamily: 'Inter, sans-serif'
                }}
              >
                {loc.name}
              </button>
            ))}
          </div>
        )}

        {/* Section 1: LAST PLAYER SOLD */}
        <div style={{ marginBottom: '2.25rem' }}>
          <div style={{ 
            fontSize: '0.8rem', 
            color: 'var(--text-muted, #94a3b8)', 
            letterSpacing: '0.1em', 
            textTransform: 'uppercase', 
            marginBottom: '0.85rem', 
            fontFamily: 'JetBrains Mono, monospace',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontWeight: '700'
          }}>
            <span>🔨</span> LAST PLAYER SOLD
          </div>
          {currentVenueStats.lastSold ? (
            <div style={{ 
              background: 'rgba(10, 25, 20, 0.65)', 
              padding: '1.25rem 1.4rem', 
              borderRadius: '10px', 
              border: '1px solid rgba(0, 229, 153, 0.3)' 
            }}>
              <div style={{ fontWeight: '800', fontSize: '1.35rem', color: '#ffffff', marginBottom: '0.6rem', fontFamily: 'Outfit, sans-serif' }}>
                {currentVenueStats.lastSold.name}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '1rem', fontWeight: '600' }}>
                  {getTeamShortName(currentVenueStats.lastSold.teamId) || currentVenueStats.lastSold.team?.shortName || currentVenueStats.lastSold.team?.name || 'Franchise'}
                </span>
                <span style={{ color: '#00e599', fontWeight: '800', fontSize: '1.4rem', fontFamily: 'JetBrains Mono, monospace' }}>
                  {formatPrice(currentVenueStats.lastSold.soldPrice)}
                </span>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', textAlign: 'center' }}>
              No completed sales in this session.
            </div>
          )}
        </div>

        {/* Section 2: TOP VENUE PURCHASES */}
        <div>
          <div style={{ 
            fontSize: '0.8rem', 
            color: 'var(--text-muted, #94a3b8)', 
            letterSpacing: '0.1em', 
            textTransform: 'uppercase', 
            marginBottom: '0.85rem', 
            fontFamily: 'JetBrains Mono, monospace',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontWeight: '700'
          }}>
            <span>🏆</span> TOP VENUE PURCHASES
          </div>
          {currentVenueStats.topBuys && currentVenueStats.topBuys.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {currentVenueStats.topBuys.map((buy, idx) => (
                <div key={idx} style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between', 
                  background: 'rgba(16, 21, 29, 0.75)', 
                  padding: '0.85rem 1.1rem', 
                  borderRadius: '10px', 
                  border: '1px solid rgba(255,255,255,0.05)' 
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                    {/* Circular avatar */}
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #1e293b, #0f172a)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <img
                        src={buy.imageUrl || playerImageMap[buy.name?.toLowerCase().replace(/[^a-z]/g, '')] || `https://ui-avatars.com/api/?name=${encodeURIComponent(buy.name || 'Player')}&background=141b25&color=d4af37&size=128`}
                        alt={buy.name}
                        style={{ width: '85%', height: '85%', objectFit: 'contain' }}
                        onError={e => { e.target.style.display = 'none'; }}
                      />
                    </div>
                    <div>
                      <div style={{ fontWeight: '700', fontSize: '1.05rem', color: '#ffffff', fontFamily: 'Outfit, sans-serif' }}>
                        {buy.name}
                      </div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted, #94a3b8)', fontWeight: '600' }}>
                        {getTeamShortName(buy.teamId) || buy.team?.shortName || buy.team?.name || 'Franchise'}
                      </div>
                    </div>
                  </div>
                  <div style={{ color: 'var(--gold-bright, #f0cc5d)', fontWeight: '800', fontSize: '1.15rem', fontFamily: 'JetBrains Mono, monospace' }}>
                    {formatPrice(buy.soldPrice)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', textAlign: 'center' }}>
              No recorded acquisitions.
            </div>
          )}
        </div>
      </div>

      {/* Pool Transition Notification */}
      {poolAnimation && isCinematic && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(6, 8, 11, 0.95)',
          backdropFilter: 'blur(16px)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <span style={{ fontSize: '1rem', color: 'var(--gold-primary)', letterSpacing: '0.3em', textTransform: 'uppercase', marginBottom: '0.75rem', fontFamily: 'JetBrains Mono, monospace' }}>
            LOT CATEGORY TRANSITION
          </span>
          <h1 style={{ fontSize: '5rem', color: '#ffffff', fontWeight: '900', textTransform: 'uppercase', margin: 0, letterSpacing: '-0.02em' }}>
            {poolAnimation}
          </h1>
          <div style={{ width: '120px', height: '3px', background: 'var(--gold-primary)', marginTop: '1.5rem' }}></div>
        </div>
      )}

      {/* 5-Second Global Auction Commencing Overlay */}
      {auctionStartingCountdown !== null && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'radial-gradient(circle at center, rgba(16, 21, 29, 0.98), rgba(6, 9, 13, 0.99))',
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(16px)',
          padding: '2rem'
        }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.6rem',
            padding: '0.45rem 1.4rem',
            background: 'rgba(212, 175, 55, 0.15)',
            border: '1px solid var(--gold-border)',
            borderRadius: '50px',
            color: 'var(--gold-bright)',
            fontSize: '0.85rem',
            fontFamily: 'JetBrains Mono, monospace',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            marginBottom: '1.75rem',
            boxShadow: '0 0 25px rgba(212, 175, 55, 0.25)'
          }}>
            ⚡ OFFICIAL BROADCAST FEED ⚡
          </div>

          <h1 style={{
            fontSize: '3rem',
            fontWeight: '900',
            color: '#ffffff',
            letterSpacing: '-0.02em',
            textAlign: 'center',
            marginBottom: '0.75rem',
            textTransform: 'uppercase'
          }}>
            {auctionStartingCountdown > 0 ? 'AUCTION COMMENCING' : '🔥 AUCTION IS LIVE! 🔥'}
          </h1>

          <p style={{
            color: 'var(--text-secondary)',
            fontSize: '1.2rem',
            fontFamily: 'JetBrains Mono, monospace',
            marginBottom: '2.5rem',
            textAlign: 'center'
          }}>
            {auctionStartingCountdown > 0 
              ? 'Stand by for the opening lot of the IPL Mega Auction' 
              : 'Gavel stage live — Bidding paddles unlocked!'}
          </p>

          {auctionStartingCountdown > 0 ? (
            <div style={{
              width: '180px',
              height: '180px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(212, 175, 55, 0.25), rgba(12, 16, 22, 0.95))',
              border: '4px solid var(--gold-border)',
              boxShadow: '0 0 60px rgba(212, 175, 55, 0.5), inset 0 0 40px rgba(212, 175, 55, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '6rem',
              fontWeight: '900',
              color: 'var(--gold-bright)',
              fontFamily: 'JetBrains Mono, monospace'
            }}>
              {auctionStartingCountdown}
            </div>
          ) : (
            <div style={{
              padding: '1.1rem 3.5rem',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, var(--emerald-live), #059669)',
              color: '#ffffff',
              fontSize: '1.5rem',
              fontWeight: '900',
              letterSpacing: '0.1em',
              boxShadow: '0 0 40px rgba(16, 185, 129, 0.6)'
            }}>
              AUCTION SESSION ACTIVE
            </div>
          )}
        </div>
      )}
    </div>
  );
}
