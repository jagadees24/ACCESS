import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';

// In development Vite proxies /api to the local server. In a deployment, set
// VITE_API_URL only when the API intentionally lives on a separate origin.
const API_URL = import.meta.env.VITE_API_URL || '';

function getStoredToken() {
  return localStorage.getItem('adminToken') || '';
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

function timeLeft(ms) {
  if (ms <= 0) return 'Expired';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

const api = axios.create({
  baseURL: API_URL,
});

api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

function ProtectedRoute({ children }) {
  const token = getStoredToken();
  const location = useLocation();

  if (!token) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

function Header() {
  const navigate = useNavigate();
  const [admin, setAdmin] = useState(null);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;

    api.get('/api/admin/me')
      .then((response) => setAdmin(response.data.admin))
      .catch(() => {
        localStorage.removeItem('adminToken');
      });
  }, []);

  const logout = () => {
    localStorage.removeItem('adminToken');
    navigate('/admin/login');
  };

  return (
    <header className="topbar">
      <div className="brand-block">
        <Link to="/admin/dashboard" className="brand-link">Guest WiFi Access</Link>
      </div>
      <nav className="nav-links">
        <Link to="/admin/dashboard">Dashboard</Link>
        <Link to="/admin/qr">Generate QR</Link>
        <Link to="/admin/qr/list">Active Codes</Link>
        <Link to="/admin/logs">Logs</Link>
      </nav>
      <div className="admin-meta">
        {admin ? <span>{admin.name}</span> : <span>Admin</span>}
        <button className="button danger" onClick={logout}>Logout</button>
      </div>
    </header>
  );
}

function AdminLoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: 'admin@wifi.local', password: 'admin123' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await api.post('/api/admin/login', form);
      localStorage.setItem('adminToken', response.data.token);
      navigate('/admin/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-shell login-page">
      <div className="card auth-card">
        <h1>Admin Login</h1>
        <p className="muted">Temporary WiFi access console</p>
        {error && <div className="error-box">{error}</div>}
        <form onSubmit={handleSubmit} className="stack-form">
          <label>
            Email
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label>
            Password
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          <button type="submit" disabled={loading} className="button primary">
            {loading ? 'Signing in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}

function AdminDashboardPage() {
  const [stats, setStats] = useState({ totalGuestsToday: 0, currentlyActiveSessions: 0, mostUsedAccessType: 'time_based' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/admin/dashboard')
      .then((response) => setStats(response.data.stats))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page-shell">
      <Header />
      <div className="content-wrap">
        <h1>Dashboard</h1>
        {loading ? (
          <p>Loading stats...</p>
        ) : (
          <div className="stats-grid">
            <div className="stat-card">
              <span>Guests today</span>
              <strong>{stats.totalGuestsToday}</strong>
            </div>
            <div className="stat-card">
              <span>Active sessions</span>
              <strong>{stats.currentlyActiveSessions}</strong>
            </div>
            <div className="stat-card">
              <span>Most used type</span>
              <strong>{stats.mostUsedAccessType}</strong>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GenerateQrPage() {
  const [form, setForm] = useState({ access_type: 'time_based', duration_minutes: 60 });
  const [generated, setGenerated] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await api.post('/api/admin/qr/generate', form);
      setGenerated(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to generate QR');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-shell">
      <Header />
      <div className="content-wrap generate-wrap">
        <div className="card">
          <h2>Generate new QR code</h2>
          <form onSubmit={handleGenerate} className="stack-form">
            <label>
              Access type
              <select value={form.access_type} onChange={(e) => setForm({ ...form, access_type: e.target.value })}>
                <option value="time_based">Time-based</option>
                <option value="one_time">One-time</option>
              </select>
            </label>
            <label>
              Duration (minutes)
              <input
                type="number"
                min="5"
                value={form.duration_minutes}
                onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })}
              />
            </label>
            <button type="submit" className="button primary" disabled={loading}>
              {loading ? 'Generating...' : 'Generate QR'}
            </button>
          </form>
        </div>

        {error && <div className="error-box">{error}</div>}

        {generated && (
          <div className="card qr-card">
            <h3>Generated access link</h3>
            <div className="qr-box">
              {generated.qrCodeImage ? (
                <img src={generated.qrCodeImage} alt="QR code for guest WiFi access" />
              ) : (
                <p className="error-box">The QR image could not be generated. You can still open or copy the access link below.</p>
              )}
            </div>
            <p className="break-word">
              <a href={generated.qrCodeUrl} target="_blank" rel="noreferrer">{generated.qrCodeUrl}</a>
            </p>
            <p><strong>Token:</strong> {generated.token}</p>
            <p><strong>Access type:</strong> {generated.access_type}</p>
            <p><strong>Duration:</strong> {formatDuration(generated.duration_minutes)}</p>
            {generated.qrCodeImage && (
              <a className="button secondary" href={generated.qrCodeImage} download="wifi-access-qr.png">Download PNG</a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function QrListPage() {
  const [qrCodes, setQrCodes] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadCodes = async () => {
    try {
      const response = await api.get('/api/admin/qr');
      setQrCodes(response.data.qrCodes);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCodes();
  }, []);

  const revokeCode = async (id) => {
    try {
      await api.post(`/api/admin/qr/${id}/revoke`);
      loadCodes();
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="page-shell">
      <Header />
      <div className="content-wrap">
        <h1>Access codes</h1>
        {loading ? <p>Loading codes...</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Type</th>
                  <th>Duration</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {qrCodes.map((code) => (
                  <tr key={code.id}>
                    <td>{code.id}</td>
                    <td>{code.access_type}</td>
                    <td>{formatDuration(code.duration_minutes)}</td>
                    <td>{new Date(code.expires_at).toLocaleString()}</td>
                    <td><span className={`status-badge ${code.status}`}>{code.status}</span></td>
                    <td>
                      {code.status === 'active' || code.status === 'used' ? (
                        <button className="button danger small" onClick={() => revokeCode(code.id)}>Revoke</button>
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function LogsPage() {
  const [logs, setLogs] = useState([]);
  const [filters, setFilters] = useState({ startDate: '', endDate: '', guest: '', status: '' });

  const loadLogs = async () => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });

    const response = await api.get(`/api/admin/logs?${params.toString()}`);
    setLogs(response.data.logs || []);
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const applyFilters = async (event) => {
    event.preventDefault();
    loadLogs();
  };

  return (
    <div className="page-shell">
      <Header />
      <div className="content-wrap">
        <h1>Access logs</h1>
        <form className="filter-row" onSubmit={applyFilters}>
          <input type="date" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} />
          <input type="date" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} />
          <input placeholder="Guest" value={filters.guest} onChange={(e) => setFilters({ ...filters, guest: e.target.value })} />
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All actions</option>
            <option value="granted">Granted</option>
            <option value="denied">Denied</option>
            <option value="expired">Expired</option>
            <option value="revoked">Revoked</option>
          </select>
          <button type="submit" className="button primary small">Filter</button>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Guest</th>
                <th>Action</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.timestamp).toLocaleString()}</td>
                  <td>{entry.guest_identifier}</td>
                  <td>{entry.action}</td>
                  <td>{entry.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function GuestAccessPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [state, setState] = useState({ status: 'loading', reason: '', remainingMs: 0, expiresAt: null, accessType: 'time_based' });

  useEffect(() => {
    if (!token) {
      setState({ status: 'denied', reason: 'Missing access token', remainingMs: 0, expiresAt: null, accessType: 'time_based' });
      return;
    }

    const guestId = localStorage.getItem('guestId') || `guest-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem('guestId', guestId);

    const validateToken = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/access/validate`, {
          params: { token, guest_id: guestId },
        });

        if (response.data.valid) {
          setState({
            status: 'granted',
            reason: response.data.reason,
            remainingMs: response.data.remainingMs,
            expiresAt: response.data.expiresAt,
            accessType: response.data.accessType,
          });
          return;
        }

        setState({
          status: response.data.status || 'denied',
          reason: response.data.reason || 'Access denied',
          remainingMs: 0,
          expiresAt: null,
          accessType: 'time_based',
        });
      } catch (error) {
        const data = error.response?.data || {};
        setState({
          status: data.status || 'denied',
          reason: data.reason || 'Access denied',
          remainingMs: 0,
          expiresAt: null,
          accessType: 'time_based',
        });
      }
    };

    validateToken();
  }, [token]);

  useEffect(() => {
    if (state.status !== 'granted') return;

    const timer = setInterval(async () => {
      try {
        const response = await axios.get(`${API_URL}/api/access/status`, {
          params: { token },
        });

        if (response.data.valid) {
          setState((current) => ({
            ...current,
            remainingMs: response.data.remainingMs,
            expiresAt: response.data.expiresAt,
            accessType: response.data.accessType,
          }));
        } else {
          setState({
            status: response.data.status || 'expired',
            reason: response.data.reason || 'Access expired',
            remainingMs: 0,
            expiresAt: null,
            accessType: response.data.accessType || 'time_based',
          });
        }
      } catch (error) {
        const data = error.response?.data || {};
        setState({
          status: data.status || 'expired',
          reason: data.reason || 'Access expired',
          remainingMs: 0,
          expiresAt: null,
          accessType: 'time_based',
        });
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [state.status, token]);

  if (state.status === 'loading') {
    return <div className="page-shell guest-shell"><div className="card guest-card"><h1>Checking access...</h1><p>Validating your QR code.</p></div></div>;
  }

  if (state.status === 'granted') {
    return (
      <div className="page-shell guest-shell">
        <div className="card guest-card success-card">
          <h1>Access granted</h1>
          <p className="lead">You have temporary access to the guest WiFi network.</p>
          <div className="countdown-box">{timeLeft(state.remainingMs)}</div>
          <p className="muted">Access type: {state.accessType}</p>
          <p className="muted">Expires: {state.expiresAt ? new Date(state.expiresAt).toLocaleString() : '—'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell guest-shell">
      <div className="card guest-card danger-card">
        <h1>Access {state.status}</h1>
        <p className="lead">{state.reason}</p>
        <p className="muted">Please contact the venue host for a fresh QR code.</p>
      </div>
    </div>
  );
}

function AppLayout() {
  const location = useLocation();
  const showHeader = location.pathname.startsWith('/admin');

  return (
    <>
      {showHeader ? null : null}
      <Routes>
        <Route path="/" element={<Navigate to="/admin/login" replace />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin/dashboard" element={<ProtectedRoute><AdminDashboardPage /></ProtectedRoute>} />
        <Route path="/admin/qr" element={<ProtectedRoute><GenerateQrPage /></ProtectedRoute>} />
        <Route path="/admin/qr/list" element={<ProtectedRoute><QrListPage /></ProtectedRoute>} />
        <Route path="/admin/logs" element={<ProtectedRoute><LogsPage /></ProtectedRoute>} />
        <Route path="/access" element={<GuestAccessPage />} />
      </Routes>
    </>
  );
}

export default function App() {
  return <AppLayout />;
}
