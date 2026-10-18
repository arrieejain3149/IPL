import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import './index.css';
import ManagerDashboard from './components/ManagerDashboard';
import TeamLeaderDashboard from './components/TeamLeaderDashboard';
import AuctioneerDashboard from './components/AuctioneerDashboard';
import ViewerDashboard from './components/ViewerDashboard';
import Login from './components/Login';
import LandingPage from './components/LandingPage';
import ThemedTeamDashboard from './components/ThemedTeamDashboard';
import IntroOverlay from './components/IntroOverlay';
import { useAuth } from './AuthContext';

const ProtectedRoute = ({ children, requiredRole }) => {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to={`/login${location.search}`} />;
  }
  if (requiredRole && user.role !== requiredRole && user.role !== 'ADMIN') {
    return <Navigate to="/" />;
  }
  return children;
};

const NavigationBar = () => {
  const { user, logout } = useAuth();
  const location = useLocation();

  // Hide the navbar on public landing, viewer, and public modal routes
  if (['/', '/room', '/teams', '/login', '/management', '/viewer'].includes(location.pathname)) {
    return null;
  }

  const isAuctioneerPortal = location.pathname === '/auctioneer' || user?.role === 'AUCTIONEER';

  const getRoleBadge = (role) => {
    switch (role) {
      case 'ADMIN': return 'ADMIN';
      case 'AUCTIONEER': return '';
      case 'TEAM_LEADER': return 'FRANCHISE DESK';
      default: return 'OPERATOR';
    }
  };

  const getBadgeLabel = () => {
    if (!user) return '';
    if (user.role === 'ADMIN') return 'ADMIN';
    if (user.role === 'AUCTIONEER') return user.username;
    const roleBadge = getRoleBadge(user.role);
    return roleBadge ? `${roleBadge}: ${user.username}` : user.username;
  };

  return (
    <header className="navbar">
      <Link to="/" className="nav-brand-wrap" title="Back to Home">
        <span className="nav-brand" style={{ textTransform: 'none' }}>
          IPL Auction
        </span>
      </Link>

      <div className="nav-links">
        <Link to="/" className="nav-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: '700' }}>
          <span>&larr;</span> Return to Home
        </Link>
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span className="badge badge-gold">
              {getBadgeLabel()}
            </span>
            <button 
              onClick={logout} 
              className="btn btn-secondary" 
              style={{ padding: '0.4rem 0.9rem', fontSize: '0.75rem' }}
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

function App() {
  return (
    <Router>
      <div className="app-container">
        <IntroOverlay />
        <NavigationBar />
        
        <main className="main-content">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/room" element={<ViewerDashboard />} />
            <Route path="/teams" element={<LandingPage initialSection="teams" />} />
            <Route path="/how-to-play" element={<Navigate to="/" replace />} />
            <Route path="/login" element={<Login portalName="Franchise War Room Access" />} />
            <Route path="/management" element={<Login portalName="Operations Command Authentication" />} />
            <Route path="/manager" element={
              <ProtectedRoute requiredRole="ADMIN"><ManagerDashboard /></ProtectedRoute>
            } />
            <Route path="/auctioneer" element={
              <ProtectedRoute requiredRole="AUCTIONEER"><AuctioneerDashboard /></ProtectedRoute>
            } />
            <Route path="/team-leader" element={
              <ProtectedRoute requiredRole="TEAM_LEADER"><TeamLeaderDashboard /></ProtectedRoute>
            } />
            <Route path="/team" element={
              <ProtectedRoute requiredRole="TEAM_LEADER"><ThemedTeamDashboard forcedTeamId="dc" /></ProtectedRoute>
            } />
            <Route path="/team/:teamId" element={
              <ProtectedRoute requiredRole="TEAM_LEADER"><ThemedTeamDashboard /></ProtectedRoute>
            } />
            <Route path="/viewer" element={<ViewerDashboard />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
