import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import socket from '../socket';
import playerImageMap from '../playerImageMap.json';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function LandingPage({ initialSection }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login, logout } = useAuth();

  // Real-time Auction State from Firebase / Socket
  const [livePlayer, setLivePlayer] = useState(null);
  const [currentBid, setCurrentBid] = useState(null);
  const [timerState, setTimerState] = useState({ deadlineMs: null, remainingSec: 0, paused: false });
  const [teams, setTeams] = useState([]);

  // Fetch initial teams and active player, subscribe to socket & Firebase events
  useEffect(() => {
    // 1. Fetch teams
    fetch(API_URL + '/api/teams')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setTeams(data);
      })
      .catch(err => console.error('LandingPage: Failed to load teams', err));

    // 2. Fetch current live player on main_arena
    fetch(API_URL + '/api/locations/main_arena/players')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          const active = data.find(p => p.status === 'LIVE');
          if (active) {
            setLivePlayer(active);
            if (active.timerDeadlineMs) {
              setTimerState({
                deadlineMs: active.timerDeadlineMs,
                remainingSec: Math.max(0, Math.ceil((active.timerDeadlineMs - Date.now()) / 1000)),
                paused: false
              });
            }
          } else {
            setLivePlayer(null);
          }
        }
      })
      .catch(err => console.error('LandingPage: Failed to load players', err));

    // 3. Join main arena room
    socket.emit('joinLocation', 'main_arena');

    // 4. Socket listeners for real-time instant propagation
    const handleLivePlayerUpdated = (player) => {
      setLivePlayer(player || null);
      if (player && player.timerDeadlineMs) {
        setTimerState({
          deadlineMs: player.timerDeadlineMs,
          remainingSec: Math.max(0, Math.ceil((player.timerDeadlineMs - Date.now()) / 1000)),
          paused: false
        });
      } else if (!player) {
        setCurrentBid(null);
        setTimerState({ deadlineMs: null, remainingSec: 0, paused: false });
      }
    };

    const handleNewBid = (bidData) => {
      setCurrentBid(bidData);
      setLivePlayer(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          currentBid: bidData.amount,
          currentBidder: bidData.teamId,
          lastBidTeamId: bidData.teamId,
          leadingBidder: bidData.teamId
        };
      });
    };

    const handleTimerUpdated = (data) => {
      const remaining = data.deadlineMs
        ? Math.max(0, Math.ceil((data.deadlineMs - Date.now()) / 1000))
        : (data.remainingMs ? Math.max(0, Math.ceil(data.remainingMs / 1000)) : 0);
      setTimerState({
        deadlineMs: data.deadlineMs || null,
        remainingSec: remaining,
        paused: Boolean(data.paused)
      });
    };

    const handlePlayerSold = () => {
      setLivePlayer(null);
      setCurrentBid(null);
      setTimerState({ deadlineMs: null, remainingSec: 0, paused: false });
    };

    const handlePlayerUnsold = () => {
      setLivePlayer(null);
      setCurrentBid(null);
      setTimerState({ deadlineMs: null, remainingSec: 0, paused: false });
    };

    const handlePlayerReopened = (reopenedPlayer) => {
      setLivePlayer(reopenedPlayer);
    };

    const handleAuctionReset = () => {
      setLivePlayer(null);
      setCurrentBid(null);
      setTimerState({ deadlineMs: null, remainingSec: 0, paused: false });
    };

    socket.on('livePlayerUpdated', handleLivePlayerUpdated);
    socket.on('newBid', handleNewBid);
    socket.on('timerUpdated', handleTimerUpdated);
    socket.on('playerSold', handlePlayerSold);
    socket.on('playerUnsold', handlePlayerUnsold);
    socket.on('playerReopened', handlePlayerReopened);
    socket.on('auctionReset', handleAuctionReset);

    return () => {
      socket.off('livePlayerUpdated', handleLivePlayerUpdated);
      socket.off('newBid', handleNewBid);
      socket.off('timerUpdated', handleTimerUpdated);
      socket.off('playerSold', handlePlayerSold);
      socket.off('playerUnsold', handlePlayerUnsold);
      socket.off('playerReopened', handlePlayerReopened);
      socket.off('auctionReset', handleAuctionReset);
    };
  }, []);

  // Timer ticker for 1000ms authoritative countdown
  useEffect(() => {
    if (!timerState.deadlineMs || timerState.paused) return;
    const interval = setInterval(() => {
      setTimerState(prev => {
        if (!prev.deadlineMs || prev.paused) return prev;
        const sec = Math.max(0, Math.ceil((prev.deadlineMs - Date.now()) / 1000));
        if (sec !== prev.remainingSec) {
          return { ...prev, remainingSec: sec };
        }
        return prev;
      });
    }, 250);
    return () => clearInterval(interval);
  }, [timerState.deadlineMs, timerState.paused]);

  const handleFranchiseEnter = (teamCode) => {
    const code = teamCode.toLowerCase();
    if (user) {
      const userTeam = user.username?.toLowerCase().replace(/^owner_/, '');
      if (user.role === 'ADMIN' || (user.role === 'TEAM_LEADER' && userTeam === code)) {
        navigate('/team-leader?team=' + code);
        return;
      }
    }
    navigate('/login?team=' + code);
  };

  // Active navigation tab highlight: 'auction' | 'teams'
  const [activeTab, setActiveTab] = useState(() => {
    if (initialSection === 'teams' || location.pathname === '/teams') return 'teams';
    return 'auction';
  });

  // Modals for deep-linked routes
  const [modalOpen, setModalOpen] = useState(() => {
    if (initialSection === 'teams' || location.pathname === '/teams') return 'teams';
    return null;
  });

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (location.pathname === '/teams' || initialSection === 'teams') {
      setActiveTab('teams');
      setModalOpen('teams');
    } else {
      setActiveTab('auction');
      setModalOpen(null);
    }
  }, [location.pathname, initialSection]);

  const handleNavClick = (tab) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
    if (tab === 'auction') {
      setModalOpen(null);
      navigate('/');
    } else if (tab === 'teams') {
      setModalOpen('teams');
      navigate('/teams');
    }
  };

  const closeModal = () => {
    setModalOpen(null);
    setActiveTab('auction');
    navigate('/');
  };

  // 10 Official Franchises Metadata
  const franchiseList = [
    { code: 'CSK', name: 'Chennai Super Kings', city: 'Chennai', color: '#f9cd05', venue: 'M. A. Chidambaram Stadium' },
    { code: 'MI', name: 'Mumbai Indians', city: 'Mumbai', color: '#004ba0', venue: 'Wankhede Stadium' },
    { code: 'RCB', name: 'Royal Challengers Bengaluru', city: 'Bengaluru', color: '#d32f2f', venue: 'M. Chinnaswamy Stadium' },
    { code: 'DC', name: 'Delhi Capitals', city: 'Delhi', color: '#2563eb', venue: 'Arun Jaitley Stadium' },
    { code: 'KKR', name: 'Kolkata Knight Riders', city: 'Kolkata', color: '#3a225d', venue: 'Eden Gardens' },
    { code: 'PBKS', name: 'Punjab Kings', city: 'Mohali', color: '#ed1b24', venue: 'PCA Stadium Mullanpur' },
    { code: 'RR', name: 'Rajasthan Royals', city: 'Jaipur', color: '#eb178b', venue: 'Sawai Mansingh Stadium' },
    { code: 'SRH', name: 'Sunrisers Hyderabad', city: 'Hyderabad', color: '#ff6200', venue: 'Rajiv Gandhi Intl Stadium' },
    { code: 'LSG', name: 'Lucknow Super Giants', city: 'Lucknow', color: '#00a3e0', venue: 'BRSABV Ekana Stadium' },
    { code: 'GT', name: 'Gujarat Titans', city: 'Ahmedabad', color: '#1b2133', venue: 'Narendra Modi Stadium' }
  ];

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: 'var(--navy-midnight, #03101F)',
      color: 'var(--white-main, #F5F7FA)',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      position: 'relative',
      overflowX: 'hidden'
    }}>

      {/* =====================================================================
          2. TOP NAVIGATION BAR (SLIM, FULL-WIDTH, DEEP NAVY, AUTHENTIC IPL LOGO)
          ===================================================================== */}
      <nav style={{
        width: '100%',
        backgroundColor: '#03101F',
        borderBottom: '1px solid rgba(0, 168, 255, 0.2)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: '0 4px 25px rgba(0, 0, 0, 0.5)'
      }}>
        <div style={{
          maxWidth: '1240px',
          margin: '0 auto',
          padding: '0 1.25rem',
          height: '62px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1.5rem'
        }}>

          {/* Left: Real IPL Logo Asset */}
          <div 
            onClick={() => handleNavClick('auction')}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              cursor: 'pointer',
              userSelect: 'none'
            }}
          >
            <img 
              src="/ipl_logo.svg" 
              alt="Indian Premier League Official Logo"
              style={{
                height: '42px',
                width: 'auto',
                maxWidth: '92px',
                objectFit: 'contain',
                display: 'block'
              }}
              onError={(e) => {
                // Fallback graceful logo badge
                e.currentTarget.style.display = 'none';
              }}
            />
            <span style={{
              marginLeft: '0.85rem',
              paddingLeft: '0.85rem',
              borderLeft: '1px solid rgba(255, 255, 255, 0.15)',
              fontFamily: "'Outfit', sans-serif",
              fontSize: '0.78rem',
              fontWeight: '800',
              letterSpacing: '0.14em',
              color: '#FFC928',
              textTransform: 'uppercase'
            }}>
              BIDDING BEFORE WICKET
            </span>
          </div>

          {/* Right Side: LOGIN or Authenticated User Badge + LOGOUT */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            {user ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                {/* User Role / Franchise Portal Button */}
                <button
                  onClick={() => {
                    if (user.role === 'ADMIN') navigate('/manager');
                    else if (user.role === 'AUCTIONEER') navigate('/auctioneer');
                    else if (user.role === 'TEAM_LEADER') navigate(`/team-leader?team=${user.username || ''}`);
                    else navigate('/viewer');
                  }}
                  title={user.role === 'ADMIN' ? 'Go to Admin Command Center' : 'Go to Franchise Room'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    padding: '0.46rem 0.95rem',
                    backgroundColor: user.role === 'ADMIN' ? 'rgba(255, 201, 40, 0.12)' : 'rgba(0, 168, 255, 0.12)',
                    border: user.role === 'ADMIN' ? '1px solid #FFC928' : '1px solid rgba(0, 168, 255, 0.5)',
                    borderRadius: '5px',
                    color: user.role === 'ADMIN' ? '#FFC928' : '#FFFFFF',
                    fontFamily: "'Outfit', sans-serif",
                    fontSize: '0.78rem',
                    fontWeight: '800',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    boxShadow: user.role === 'ADMIN' ? '0 0 12px rgba(255, 201, 40, 0.2)' : '0 0 12px rgba(0, 168, 255, 0.2)'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = user.role === 'ADMIN' ? 'rgba(255, 201, 40, 0.22)' : 'rgba(0, 168, 255, 0.25)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = user.role === 'ADMIN' ? 'rgba(255, 201, 40, 0.12)' : 'rgba(0, 168, 255, 0.12)';
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                  <span>
                    {user.role === 'ADMIN' 
                      ? 'ADMIN' 
                      : user.role === 'TEAM_LEADER' 
                        ? `${user.username.toUpperCase()} ROOM` 
                        : user.role === 'AUCTIONEER' 
                          ? 'AUCTIONEER' 
                          : user.username.toUpperCase()}
                  </span>
                </button>

                {/* LOGOUT Button */}
                <button
                  onClick={logout}
                  title="Log out of session"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.46rem 0.8rem',
                    backgroundColor: 'rgba(255, 59, 48, 0.08)',
                    border: '1px solid rgba(255, 59, 48, 0.35)',
                    borderRadius: '5px',
                    color: '#FF6B6B',
                    fontFamily: "'Outfit', sans-serif",
                    fontSize: '0.74rem',
                    fontWeight: '700',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 59, 48, 0.2)';
                    e.currentTarget.style.borderColor = '#FF3B30';
                    e.currentTarget.style.color = '#FFFFFF';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 59, 48, 0.08)';
                    e.currentTarget.style.borderColor = 'rgba(255, 59, 48, 0.35)';
                    e.currentTarget.style.color = '#FF6B6B';
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                  </svg>
                  <span>LOGOUT</span>
                </button>
              </div>
            ) : (
              /* When not logged in: Clean LOGIN button */
              <button
                onClick={() => navigate('/login')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  padding: '0.48rem 1.15rem',
                  backgroundColor: 'rgba(0, 168, 255, 0.1)',
                  border: '1px solid rgba(0, 168, 255, 0.4)',
                  borderRadius: '5px',
                  color: '#FFFFFF',
                  fontFamily: "'Outfit', sans-serif",
                  fontSize: '0.78rem',
                  fontWeight: '700',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = '#00A8FF';
                  e.currentTarget.style.backgroundColor = 'rgba(0, 168, 255, 0.22)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(0, 168, 255, 0.4)';
                  e.currentTarget.style.backgroundColor = 'rgba(0, 168, 255, 0.1)';
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
                <span>LOGIN</span>
              </button>
            )}
          </div>

        </div>
      </nav>

      {/* =====================================================================
          3. MAIN CINEMATIC HERO SECTION (~360–390px tall, Wankhede night photo)
          ===================================================================== */}
      <section style={{
        position: 'relative',
        width: '100%',
        minHeight: '460px',
        height: 'clamp(460px, 40vw, 620px)',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        backgroundColor: '#03101F'
      }}>
        {/* Genuine Stadium & Auction Stage Background Photo */}
        <img 
          src="/image.png" 
          alt="IPL Auction Arena Stage in Stadium"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center center',
            zIndex: 1
          }}
        />

        {/* Subtle, Smooth Gradient Overlay (keeps stadium, stage, and flags visible) */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(90deg, rgba(3, 16, 31, 0.62) 0%, rgba(3, 16, 31, 0.44) 24%, rgba(3, 16, 31, 0.18) 48%, rgba(3, 16, 31, 0.04) 72%, transparent 100%)',
          zIndex: 2,
          pointerEvents: 'none'
        }}></div>

        {/* Hero Content (Vertically centered, grouped on left half) */}
        <div style={{
          position: 'relative',
          zIndex: 4,
          maxWidth: '1240px',
          width: '100%',
          margin: '0 auto',
          padding: '2.5rem 1.5rem',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center'
        }}>
          <div style={{ maxWidth: '560px' }}>
            
            {/* Small Gold Eyebrow */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              color: '#FFC928',
              fontFamily: "'Outfit', sans-serif",
              fontSize: '0.76rem',
              fontWeight: '800',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              marginBottom: '0.85rem',
              textShadow: '0 2px 8px rgba(0, 0, 0, 0.9)'
            }}>
              <span style={{ width: '16px', height: '2px', backgroundColor: '#FFC928', boxShadow: '0 0 6px rgba(255, 201, 40, 0.6)' }}></span>
              THE ULTIMATE CRICKET AUCTION EXPERIENCE
            </div>

            {/* Main Heading (White + Gold sports condensed typography) */}
            <h1 style={{
              fontFamily: "'Outfit', sans-serif",
              fontSize: 'clamp(2.4rem, 4.5vw, 3.8rem)',
              fontWeight: '900',
              lineHeight: 1.04,
              letterSpacing: '-0.02em',
              textTransform: 'uppercase',
              margin: '0 0 1rem 0'
            }}>
              <span style={{ 
                color: '#F5F7FA', 
                display: 'block',
                textShadow: '0 3px 12px rgba(0, 0, 0, 0.95), 0 1px 3px rgba(0, 0, 0, 0.9)'
              }}>
                BUILD YOUR
              </span>
              <span style={{ 
                color: '#FFC928', 
                display: 'block',
                textShadow: '0 3px 14px rgba(0, 0, 0, 0.95), 0 0 24px rgba(255, 201, 40, 0.35)'
              }}>
                DREAM SQUAD.
              </span>
            </h1>

            {/* Sports Description */}
            <p style={{
              color: '#E2E8F0',
              fontSize: 'clamp(0.92rem, 1.15vw, 1.05rem)',
              lineHeight: 1.55,
              fontWeight: '400',
              marginBottom: '1.75rem',
              textShadow: '0 2px 8px rgba(0, 0, 0, 0.9)'
            }}>
              Strategic bidding. Real-time auctions. Ten franchises.<br />
              One winning squad.
            </p>

            {/* Hero Action Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              
              {/* Primary: ENTER AUCTION */}
              <button
                onClick={() => navigate('/viewer')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                  padding: '0.75rem 1.6rem',
                  backgroundColor: '#FFC928',
                  color: '#03101F',
                  fontFamily: "'Outfit', sans-serif",
                  fontSize: '0.88rem',
                  fontWeight: '800',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  boxShadow: '0 8px 24px rgba(255, 201, 40, 0.35)',
                  transition: 'all 0.2s ease'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#FFE072';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 12px 28px rgba(255, 201, 40, 0.5)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = '#FFC928';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 8px 24px rgba(255, 201, 40, 0.35)';
                }}
              >
                {/* Gavel icon */}
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m14 13-7.5 7.5a2.12 2.12 0 1 1-3-3L11 10"></path>
                  <path d="m16 16 6-6"></path>
                  <path d="m8 8 6-6"></path>
                  <path d="m9 7 8 8"></path>
                  <path d="m21 11-8-8"></path>
                </svg>
                <span>ENTER AUCTION &rarr;</span>
              </button>

            </div>

          </div>
        </div>
      </section>

      {/* =====================================================================
          MAIN BODY CONTAINER: PANEL C + PANEL B & PANEL A
          ===================================================================== */}
      <main style={{
        maxWidth: '1240px',
        width: '100%',
        margin: '0 auto',
        padding: '2rem 1.25rem 4rem 1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.75rem',
        flexGrow: 1
      }}>

        {/* ===================================================================
            5. PANEL C — LIVE AUCTION ARENA (WIDE FULL-WIDTH FEATURE PANEL)
            =================================================================== */}
        {(() => {
          const isPlayerActive = Boolean(livePlayer && livePlayer.status === 'LIVE');
          const isPlayerSold = Boolean(livePlayer && livePlayer.status === 'SOLD');
          const leadingTeam = livePlayer?.leadingBidder || livePlayer?.lastBidTeamId || livePlayer?.currentBidder || livePlayer?.teamId;
          const currentBidAmount = livePlayer?.currentBid || currentBid?.amount || livePlayer?.basePrice || 0;
          const cleanName = (livePlayer?.name || '').toLowerCase().replace(/[^a-z]/g, '');
          const playerImgSrc = isPlayerActive
            ? ((livePlayer?.imageUrl && !livePlayer.imageUrl.includes('ui-avatars.com'))
                ? livePlayer.imageUrl
                : (playerImageMap[cleanName] && !playerImageMap[cleanName].includes('ui-avatars.com')
                    ? playerImageMap[cleanName]
                    : `/players/${(livePlayer?.name || '').toLowerCase().replace(/ /g, '_')}.png`))
            : '/gavel.jpg';

          return (
            <div
              onClick={() => navigate('/viewer')}
              style={{
                cursor: 'pointer',
                backgroundColor: '#061827',
                border: isPlayerActive ? '1px solid rgba(0, 230, 160, 0.65)' : '1px solid rgba(255, 201, 40, 0.35)',
                borderRadius: '8px',
                overflow: 'hidden',
                display: 'grid',
                gridTemplateColumns: '320px 1fr',
                boxShadow: isPlayerActive 
                  ? '0 16px 40px rgba(0, 230, 160, 0.15), 0 16px 36px rgba(0, 0, 0, 0.7), inset 0 0 0 1px rgba(0, 230, 160, 0.2)'
                  : '0 16px 36px rgba(0, 0, 0, 0.7), inset 0 0 0 1px rgba(255, 201, 40, 0.08)',
                transition: 'all 0.25s ease',
                position: 'relative'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = isPlayerActive ? '#00E6A0' : '#FFC928';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = isPlayerActive
                  ? '0 20px 48px rgba(0, 0, 0, 0.85), 0 0 25px rgba(0, 230, 160, 0.3)'
                  : '0 20px 48px rgba(0, 0, 0, 0.85), 0 0 20px rgba(255, 201, 40, 0.2)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = isPlayerActive ? 'rgba(0, 230, 160, 0.65)' : 'rgba(255, 201, 40, 0.35)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = isPlayerActive
                  ? '0 16px 40px rgba(0, 230, 160, 0.15), 0 16px 36px rgba(0, 0, 0, 0.7), inset 0 0 0 1px rgba(0, 230, 160, 0.2)'
                  : '0 16px 36px rgba(0, 0, 0, 0.7), inset 0 0 0 1px rgba(255, 201, 40, 0.08)';
              }}
            >
              {/* Left Column: Player Photo or Panoramic Gavel Image */}
              <div style={{
                position: 'relative',
                minHeight: '220px',
                height: '100%',
                backgroundColor: '#03101F',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden'
              }}>
                <img 
                  src={playerImgSrc} 
                  alt={livePlayer?.name || "Official Auction Arena"}
                  onError={(e) => {
                    e.currentTarget.src = '/gavel.jpg';
                  }}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: isPlayerActive ? 'contain' : 'cover',
                    padding: isPlayerActive ? '0.75rem' : '0',
                    display: 'block'
                  }}
                />
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'linear-gradient(90deg, rgba(3, 16, 31, 0.1) 0%, rgba(6, 24, 39, 0.8) 85%, #061827 100%)',
                  pointerEvents: 'none'
                }}></div>

                {/* Pool Badge on Player Photo */}
                {isPlayerActive && livePlayer?.pool && (
                  <div style={{
                    position: 'absolute',
                    top: '0.85rem',
                    left: '0.85rem',
                    padding: '0.2rem 0.6rem',
                    backgroundColor: 'rgba(0, 0, 0, 0.75)',
                    border: '1px solid rgba(255, 201, 40, 0.5)',
                    borderRadius: '4px',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.68rem',
                    fontWeight: '700',
                    color: '#FFC928',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    backdropFilter: 'blur(4px)'
                  }}>
                    {livePlayer.pool}
                  </div>
                )}
              </div>

              {/* Right Column: Content details & dynamic lot information */}
              <div style={{
                padding: '1.75rem 2.25rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '1rem'
              }}>
                <div>
                  {/* Header row: Status Badge & Timer & Public Access Tag */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.65rem',
                    flexWrap: 'wrap',
                    gap: '0.5rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span className={isPlayerActive ? "live-dot-green" : "live-dot-gold"}></span>
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '0.74rem',
                        letterSpacing: '0.14em',
                        color: isPlayerActive ? '#00E6A0' : '#00A8FF',
                        fontWeight: '700',
                        textTransform: 'uppercase'
                      }}>
                        {isPlayerActive ? '● ON STAGE NOW (LIVE)' : '● AUCTION STANDBY • AWAITING AUCTIONEER'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {isPlayerActive && timerState.remainingSec !== undefined && (
                        <span style={{
                          padding: '0.22rem 0.65rem',
                          backgroundColor: timerState.remainingSec <= 5 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(0, 230, 160, 0.15)',
                          border: timerState.remainingSec <= 5 ? '1px solid rgba(239, 68, 68, 0.6)' : '1px solid rgba(0, 230, 160, 0.4)',
                          borderRadius: '4px',
                          color: timerState.remainingSec <= 5 ? '#EF4444' : '#00E6A0',
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: '0.72rem',
                          fontWeight: '800',
                          letterSpacing: '0.08em'
                        }}>
                          ⏱ {timerState.remainingSec}s {timerState.paused ? '(PAUSED)' : ''}
                        </span>
                      )}

                      <span style={{
                        padding: '0.25rem 0.65rem',
                        backgroundColor: 'rgba(255, 201, 40, 0.08)',
                        border: '1px solid rgba(255, 201, 40, 0.3)',
                        borderRadius: '3px',
                        color: '#FFC928',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '0.68rem',
                        fontWeight: '700',
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase'
                      }}>
                        NO LOGIN REQUIRED
                      </span>
                    </div>
                  </div>

                  {/* Player Name or Arena Title */}
                  <h2 style={{
                    fontFamily: "'Outfit', sans-serif",
                    fontSize: '1.85rem',
                    fontWeight: '800',
                    color: '#F5F7FA',
                    letterSpacing: '-0.02em',
                    margin: '0 0 0.5rem 0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    flexWrap: 'wrap'
                  }}>
                    {isPlayerActive ? livePlayer.name : 'Panel C — Live Auction Arena'}
                    {isPlayerActive && livePlayer?.role && (
                      <span style={{
                        fontSize: '0.8rem',
                        padding: '0.2rem 0.55rem',
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        borderRadius: '3px',
                        color: '#91A6BE',
                        fontWeight: '600',
                        letterSpacing: '0.04em'
                      }}>
                        {livePlayer.role}
                      </span>
                    )}
                  </h2>

                  {/* Player Live Bidding Statistics or Description */}
                  {isPlayerActive ? (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                      gap: '0.75rem',
                      marginTop: '0.75rem',
                      marginBottom: '0.5rem'
                    }}>
                      <div style={{
                        backgroundColor: 'rgba(3, 16, 31, 0.65)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '6px',
                        padding: '0.6rem 0.85rem'
                      }}>
                        <div style={{ fontSize: '0.65rem', color: '#91A6BE', fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase' }}>
                          Current Bid
                        </div>
                        <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#00E6A0', fontFamily: "'JetBrains Mono', monospace", marginTop: '0.15rem' }}>
                          ₹{((currentBidAmount || 0) / 10000000).toFixed(2)} Cr
                        </div>
                      </div>

                      <div style={{
                        backgroundColor: 'rgba(3, 16, 31, 0.65)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '6px',
                        padding: '0.6rem 0.85rem'
                      }}>
                        <div style={{ fontSize: '0.65rem', color: '#91A6BE', fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase' }}>
                          {isPlayerSold ? 'Purchased By' : 'Leading Bidder'}
                        </div>
                        <div style={{ fontSize: '1.05rem', fontWeight: '800', color: '#FFC928', fontFamily: "'Outfit', sans-serif", marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          {leadingTeam ? (
                            <>
                              <img 
                                src={`/teams/${leadingTeam.toLowerCase()}.svg`} 
                                alt={leadingTeam} 
                                style={{ width: '18px', height: '18px', objectFit: 'contain' }}
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                              <span>{leadingTeam.toUpperCase()}</span>
                            </>
                          ) : (
                            <span style={{ color: '#91A6BE', fontWeight: '500', fontSize: '0.85rem' }}>No Bids Yet</span>
                          )}
                        </div>
                      </div>

                      <div style={{
                        backgroundColor: 'rgba(3, 16, 31, 0.65)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '6px',
                        padding: '0.6rem 0.85rem'
                      }}>
                        <div style={{ fontSize: '0.65rem', color: '#91A6BE', fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase' }}>
                          Base Price
                        </div>
                        <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#F5F7FA', fontFamily: "'JetBrains Mono', monospace", marginTop: '0.15rem' }}>
                          ₹{((livePlayer?.basePrice || 0) / 10000000).toFixed(2)} Cr
                        </div>
                      </div>

                      {livePlayer?.points !== undefined && (
                        <div style={{
                          backgroundColor: 'rgba(3, 16, 31, 0.65)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          borderRadius: '6px',
                          padding: '0.6rem 0.85rem'
                        }}>
                          <div style={{ fontSize: '0.65rem', color: '#91A6BE', fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase' }}>
                            Player Points
                          </div>
                          <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#00A8FF', fontFamily: "'JetBrains Mono', monospace", marginTop: '0.15rem' }}>
                            {livePlayer.points} PTS
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p style={{
                      color: '#91A6BE',
                      fontSize: '0.94rem',
                      lineHeight: 1.55,
                      margin: 0,
                      maxWidth: '750px'
                    }}>
                      Watch the auction, live bids, team competition, and player sales unfold in real time. Read-only global telecast optimized for arena projectors, desktops, and mobile devices.
                    </p>
                  )}
                </div>

                {/* Bottom metadata & CTA */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: '0.85rem',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  flexWrap: 'wrap',
                  gap: '0.75rem'
                }}>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.76rem',
                    color: '#91A6BE',
                    letterSpacing: '0.06em'
                  }}>
                    {isPlayerActive ? `LOT #${livePlayer.id || 1} IN PROGRESS • REAL-TIME FEED ACTIVE` : 'GLOBAL FEED • 10 FRANCHISES • 220 PLAYERS'}
                  </span>

                  <span style={{
                    fontFamily: "'Outfit', sans-serif",
                    fontSize: '0.86rem',
                    color: '#FFC928',
                    fontWeight: '800',
                    letterSpacing: '0.08em',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem'
                  }}>
                    WATCH LIVE FEED &rarr;
                  </span>
                </div>

              </div>
            </div>
          );
        })()}

        {/* ===================================================================
            6. TWO SUPPORTING PANELS BENEATH (PANEL B & PANEL A)
            =================================================================== */}
        <div className="supporting-panels-grid" style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '1.75rem'
        }}>

          {/* -----------------------------------------------------------------
              LEFT PANEL: PANEL B — FRANCHISE WAR ROOM
              ----------------------------------------------------------------- */}
          {(() => {
            const isPlayerActive = Boolean(livePlayer && livePlayer.status === 'LIVE');
            const leadingTeamCode = isPlayerActive ? (livePlayer?.leadingBidder || livePlayer?.lastBidTeamId || livePlayer?.currentBidder || '').toUpperCase() : '';
            const currentBidAmount = isPlayerActive ? (livePlayer?.currentBid || currentBid?.amount || livePlayer?.basePrice || 0) : 0;

            return (
              <div style={{
                backgroundColor: '#061827',
                border: '1px solid rgba(0, 168, 255, 0.35)',
                borderRadius: '8px',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: '0 14px 32px rgba(0, 0, 0, 0.65)',
                position: 'relative'
              }}>
                {/* Integrated Stadium Graphic Element Header */}
                <div style={{
                  position: 'relative',
                  height: '110px',
                  overflow: 'hidden',
                  backgroundColor: '#03101F'
                }}>
                  <img 
                    src="/war_room_stadium.jpg" 
                    alt="IPL Stadium Night Atmosphere"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      opacity: 0.38
                    }}
                  />
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(180deg, rgba(6, 24, 39, 0.2) 0%, #061827 95%)'
                  }}></div>
                  
                  <div style={{
                    position: 'absolute',
                    top: '1rem',
                    left: '1.5rem',
                    right: '1.5rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span style={{
                      padding: '0.22rem 0.6rem',
                      backgroundColor: 'rgba(0, 168, 255, 0.15)',
                      border: '1px solid rgba(0, 168, 255, 0.45)',
                      borderRadius: '3px',
                      color: '#00A8FF',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.68rem',
                      fontWeight: '700',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase'
                    }}>
                      FRANCHISE SECURITY CLEARANCE
                    </span>

                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.72rem',
                      color: isPlayerActive ? '#00E6A0' : '#91A6BE',
                      fontWeight: isPlayerActive ? '700' : '400'
                    }}>
                      {isPlayerActive ? '● LOT IN PROGRESS' : '10 TEAMS'}
                    </span>
                  </div>
                </div>

                {/* Panel B Content */}
                <div style={{ padding: '0 1.75rem 1.5rem 1.75rem', flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <h3 style={{
                      fontFamily: "'Outfit', sans-serif",
                      fontSize: '1.45rem',
                      fontWeight: '800',
                      color: '#F5F7FA',
                      margin: '0 0 0.5rem 0'
                    }}>
                      Panel B — Franchise Room
                    </h3>

                    <p style={{
                      color: '#91A6BE',
                      fontSize: '0.86rem',
                      lineHeight: 1.5,
                      margin: '0 0 1.25rem 0'
                    }}>
                      Authorized team managers enter their own workspace to participate in live bidding, manage available purse, and monitor squad composition.
                    </p>

                    {/* Live lot information banner inside Panel B */}
                    {isPlayerActive ? (
                      <div style={{
                        padding: '0.85rem 1rem',
                        backgroundColor: 'rgba(0, 230, 160, 0.06)',
                        border: '1px solid rgba(0, 230, 160, 0.35)',
                        borderRadius: '5px',
                        marginBottom: '1.25rem'
                      }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between'
                        }}>
                          <span style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: '0.75rem',
                            color: '#00E6A0',
                            fontWeight: '700',
                            letterSpacing: '0.08em'
                          }}>
                            ● LIVE ON GAVEL STAGE
                          </span>
                          <span style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: '0.75rem',
                            color: '#FFC928',
                            fontWeight: '700'
                          }}>
                            ₹{((currentBidAmount || 0) / 10000000).toFixed(2)} Cr
                          </span>
                        </div>
                        <div style={{
                          fontFamily: "'Outfit', sans-serif",
                          fontSize: '1rem',
                          fontWeight: '800',
                          color: '#FFFFFF',
                          marginTop: '0.25rem'
                        }}>
                          {livePlayer.name} ({livePlayer.pool || 'LOT'})
                        </div>
                        <div style={{
                          fontSize: '0.76rem',
                          color: '#91A6BE',
                          marginTop: '0.2rem'
                        }}>
                          {leadingTeamCode ? `Leading Bidder: ${leadingTeamCode}` : 'Waiting for opening bid...'}
                        </div>
                      </div>
                    ) : (
                      <div style={{
                        padding: '0.75rem 1rem',
                        backgroundColor: 'rgba(0, 168, 255, 0.04)',
                        border: '1px dashed rgba(0, 168, 255, 0.25)',
                        borderRadius: '5px',
                        marginBottom: '1.25rem'
                      }}>
                        <span style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: '0.72rem',
                          color: '#00A8FF',
                          letterSpacing: '0.06em'
                        }}>
                          STANDBY &bull; READY FOR NEXT LOT
                        </span>
                      </div>
                    )}

                    {/* Grid of 10 Franchise Logos (CSK, MI, RCB, DC, KKR, PBKS, RR, SRH, LSG, GT) */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(5, 1fr)',
                      gap: '0.55rem',
                      marginBottom: '1.25rem'
                    }}>
                      {franchiseList.map((team) => (
                        <button
                          key={team.code}
                          onClick={() => handleFranchiseEnter(team.code)}
                          title={`${team.name} — Click to enter Room`}
                          style={{
                            padding: '0.55rem 0.35rem',
                            backgroundColor: 'rgba(3, 16, 31, 0.85)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '5px',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.35rem',
                            transition: 'all 0.2s ease',
                            outline: 'none'
                          }}
                          onMouseOver={(e) => {
                            e.currentTarget.style.borderColor = team.color;
                            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
                            e.currentTarget.style.transform = 'translateY(-2px)';
                          }}
                          onMouseOut={(e) => {
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                            e.currentTarget.style.backgroundColor = 'rgba(3, 16, 31, 0.85)';
                            e.currentTarget.style.transform = 'translateY(0)';
                          }}
                        >
                          <img 
                            src={`/teams/${team.code.toLowerCase()}.svg`} 
                            alt={`${team.code} logo`}
                            style={{
                              height: '28px',
                              width: '28px',
                              objectFit: 'contain'
                            }}
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                          <span style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: '0.74rem',
                            fontWeight: '700',
                            color: '#F5F7FA'
                          }}>
                            {team.code}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Bottom Action */}
                  <div 
                    onClick={() => navigate('/login')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      paddingTop: '0.85rem',
                      borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                      cursor: 'pointer'
                    }}
                  >
                    <span style={{
                      fontFamily: "'Outfit', sans-serif",
                      fontSize: '0.82rem',
                      fontWeight: '700',
                      color: '#00A8FF',
                      letterSpacing: '0.06em'
                    }}>
                      WAR ROOM LOGIN &rarr;
                    </span>
                  </div>

                </div>
              </div>
            );
          })()}

          {/* -----------------------------------------------------------------
              RIGHT PANEL: PANEL A — OPERATIONS COMMAND
              ----------------------------------------------------------------- */}
          {(() => {
            const isLotActive = livePlayer && livePlayer.status === 'LIVE';

            return (
              <div style={{
                backgroundColor: '#061827',
                border: isLotActive ? '1px solid rgba(0, 230, 160, 0.45)' : '1px solid rgba(255, 201, 40, 0.35)',
                borderRadius: '8px',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: '0 14px 32px rgba(0, 0, 0, 0.65)',
                position: 'relative'
              }}>
                {/* Integrated Control Room Graphic Header */}
                <div style={{
                  position: 'relative',
                  height: '110px',
                  overflow: 'hidden',
                  backgroundColor: '#03101F'
                }}>
                  <img 
                    src="/control_room.jpg" 
                    alt="Command Control Center Monitors"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      opacity: 0.38
                    }}
                  />
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(180deg, rgba(6, 24, 39, 0.2) 0%, #061827 95%)'
                  }}></div>
                  
                  <div style={{
                    position: 'absolute',
                    top: '1rem',
                    left: '1.5rem',
                    right: '1.5rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span style={{
                      padding: '0.22rem 0.6rem',
                      backgroundColor: 'rgba(255, 201, 40, 0.12)',
                      border: '1px solid rgba(255, 201, 40, 0.4)',
                      borderRadius: '3px',
                      color: '#FFC928',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.68rem',
                      fontWeight: '700',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase'
                    }}>
                      CONTROL ROOM ACCESS
                    </span>

                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.72rem',
                      color: isLotActive ? '#00E6A0' : '#FFC928',
                      fontWeight: isLotActive ? '700' : '400'
                    }}>
                      {isLotActive ? '● LOT IN PROGRESS' : 'RESTRICTED'}
                    </span>
                  </div>
                </div>

                {/* Panel A Content */}
                <div style={{ padding: '0 1.75rem 1.5rem 1.75rem', flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <h3 style={{
                      fontFamily: "'Outfit', sans-serif",
                      fontSize: '1.45rem',
                      fontWeight: '800',
                      color: '#F5F7FA',
                      margin: '0 0 0.5rem 0'
                    }}>
                      Panel A — Operations Command
                    </h3>

                    <p style={{
                      color: '#91A6BE',
                      fontSize: '0.86rem',
                      lineHeight: 1.5,
                      margin: '0 0 1.25rem 0'
                    }}>
                      Authorized auction operators can initialize an authenticated session and control the entire auction: global timer, countdowns, player queues, emergency pauses, and financial settlements.
                    </p>

                    {/* Outlined Information Area */}
                    <div style={{
                      padding: '0.85rem 1rem',
                      backgroundColor: isLotActive ? 'rgba(0, 230, 160, 0.05)' : 'rgba(255, 201, 40, 0.04)',
                      border: isLotActive ? '1px dashed rgba(0, 230, 160, 0.4)' : '1px dashed rgba(255, 201, 40, 0.3)',
                      borderRadius: '5px',
                      marginBottom: '1.25rem'
                    }}>
                      <div style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '0.75rem',
                        color: isLotActive ? '#00E6A0' : '#FFC928',
                        fontWeight: '700',
                        letterSpacing: '0.08em'
                      }}>
                        {isLotActive ? `ACTIVE LOT: ${livePlayer.name.toUpperCase()} (₹${((livePlayer.currentBid || livePlayer.basePrice) / 10000000).toFixed(2)} Cr)` : 'ROLE: AUCTIONEER • DIRECTOR'}
                      </div>
                      <div style={{
                        fontSize: '0.76rem',
                        color: '#91A6BE',
                        marginTop: '0.35rem',
                        lineHeight: 1.4
                      }}>
                        {isLotActive 
                          ? `Timer: ${timerState.remainingSec}s remaining • Authoritative clock sync • Audit active`
                          : 'Authoritative server timer • Single global live player • Audit trail'}
                      </div>
                    </div>
                  </div>

                  {/* Bottom Action */}
                  <div 
                    onClick={() => {
                      if (user && user.role === 'ADMIN') {
                        navigate('/manager');
                      } else if (user && user.role === 'AUCTIONEER') {
                        navigate('/auctioneer');
                      } else {
                        navigate('/management');
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingTop: '0.85rem',
                      borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                      cursor: 'pointer'
                    }}
                  >
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.72rem',
                      color: '#91A6BE',
                      letterSpacing: '0.06em'
                    }}>
                      DIRECTOR CREDENTIALS
                    </span>
                    <span style={{
                      fontFamily: "'Outfit', sans-serif",
                      fontSize: '0.82rem',
                      fontWeight: '700',
                      color: '#FFC928',
                      letterSpacing: '0.06em'
                    }}>
                      OPERATIONS LOGIN &rarr;
                    </span>
                  </div>

                </div>
              </div>
            );
          })()}

        </div>

      </main>

      {/* =====================================================================
          AUTHENTIC MODAL: TEAM FRANCHISE DIRECTORY (/teams)
          ===================================================================== */}
      {modalOpen === 'teams' && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(3, 16, 31, 0.88)',
          backdropFilter: 'blur(8px)',
          zIndex: 200,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem'
        }}>
          <div style={{
            maxWidth: '900px',
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            backgroundColor: '#061827',
            border: '1px solid #FFC928',
            borderRadius: '10px',
            padding: '2rem',
            position: 'relative',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9)'
          }}>
            <button
              onClick={closeModal}
              style={{
                position: 'absolute',
                top: '1.25rem',
                right: '1.25rem',
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                color: '#F5F7FA',
                cursor: 'pointer',
                fontSize: '1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ✕
            </button>

            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.75rem',
                color: '#00A8FF',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                marginBottom: '0.35rem'
              }}>
                IPL 2026 OFFICIAL FRANCHISES
              </div>
              <h2 style={{
                fontFamily: "'Outfit', sans-serif",
                fontSize: '1.8rem',
                fontWeight: '900',
                color: '#F5F7FA',
                margin: 0
              }}>
                Ten Franchises. One Trophy.
              </h2>
              <p style={{ color: '#91A6BE', fontSize: '0.9rem', marginTop: '0.35rem' }}>
                Select your franchise to authenticate your credentials and monitor squad quotas.
              </p>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: '1rem'
            }}>
              {franchiseList.map(team => (
                <div
                  key={team.code}
                  onClick={() => {
                    closeModal();
                    handleFranchiseEnter(team.code);
                  }}
                  style={{
                    backgroundColor: 'rgba(3, 16, 31, 0.85)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    padding: '1.25rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.borderColor = team.color;
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                    e.currentTarget.style.backgroundColor = 'rgba(3, 16, 31, 0.85)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <img 
                    src={`/teams/${team.code.toLowerCase()}.svg`} 
                    alt={team.name}
                    style={{ width: '42px', height: '42px', objectFit: 'contain' }}
                  />
                  <div style={{ flexGrow: 1 }}>
                    <div style={{ fontWeight: '800', fontSize: '0.95rem', color: '#FFFFFF' }}>{team.name}</div>
                    <div style={{ fontSize: '0.78rem', color: '#91A6BE', marginTop: '0.2rem' }}>{team.venue}</div>
                    <div style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.72rem',
                      color: '#FFC928',
                      marginTop: '0.4rem',
                      fontWeight: '700'
                    }}>
                      PURSE: ₹90.00 Cr
                    </div>
                  </div>
                </div>
              ))}
            </div>

          </div>
        </div>
      )}

      {/* =====================================================================
          FOOTER (AUTHENTIC DISCLAIMER & BROADCAST SPONSOR)
          ===================================================================== */}
      <footer style={{
        backgroundColor: '#03101F',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        padding: '1.75rem 2rem',
        marginTop: 'auto'
      }}>
        <div style={{
          maxWidth: '1240px',
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem'
        }}>
          <div>
            <div style={{
              fontFamily: "'Outfit', sans-serif",
              fontSize: '0.86rem',
              fontWeight: '800',
              color: '#F5F7FA',
              letterSpacing: '0.06em'
            }}>
              BIDDING BEFORE WICKET &bull; INDEPENDENT AUCTION SIMULATOR
            </div>
            <div style={{
              color: '#91A6BE',
              fontSize: '0.74rem',
              marginTop: '0.35rem',
              lineHeight: 1.4,
              maxWidth: '680px'
            }}>
              This application is an independent cricket auction simulator engineered for esports and academic tournaments. Not affiliated with, endorsed by, or sponsored by the Board of Control for Cricket in India (BCCI) or the Indian Premier League. All team trademarks belong to their respective owners.
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <img 
              src="/sabrang_logo.png" 
              alt="Sabrang"
              title="Sabrang"
              style={{
                height: '42px',
                width: 'auto',
                maxWidth: '160px',
                objectFit: 'contain',
                opacity: 0.95,
                transition: 'opacity 0.2s ease, transform 0.2s ease'
              }}
              onError={(e) => { 
                e.currentTarget.src = '/aarambh_logo.png';
              }}
            />
          </div>
        </div>
      </footer>

      {/* Responsive adjustments style block */}
      <style>{`
        @media (max-width: 900px) {
          .desktop-nav-links {
            display: none !important;
          }
          .mobile-menu-btn {
            display: block !important;
          }
          div[style*="gridTemplateColumns: '320px 1fr'"],
          div[style*="grid-template-columns: 320px 1fr"] {
            grid-template-columns: 1fr !important;
          }
          .supporting-panels-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>

    </div>
  );
}
