import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Spinner } from './ui';
import Login from './Login';
import Home from './employee/Home';
import Scan from './employee/Scan';
import History from './employee/History';
import Notifications from './employee/Notifications';

const Dashboard = lazy(() => import('./admin/Dashboard'));
const Employees = lazy(() => import('./admin/Employees'));
const Sites = lazy(() => import('./admin/Sites'));
const Shifts = lazy(() => import('./admin/Shifts'));
const Records = lazy(() => import('./admin/Records'));
const Corrections = lazy(() => import('./admin/Corrections'));
const Settings = lazy(() => import('./admin/Settings'));
const Audit = lazy(() => import('./admin/Audit'));
const Ask = lazy(() => import('./admin/Ask'));

function ThemeToggle() {
  const [t, setT] = useState<string>(() => { try { return localStorage.getItem('kp-theme') ?? 'auto'; } catch { return 'auto'; } });
  useEffect(() => {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('kp-theme', t); } catch { /* private mode */ }
  }, [t]);
  return (
    <label className="row small" style={{ gap: '0.4rem' }}>
      <span className="sr-only">Theme</span>
      <select aria-label="Theme" value={t} onChange={(e) => setT(e.target.value)} style={{ minHeight: 36, width: 'auto', padding: '0.2rem 0.5rem' }}>
        <option value="auto">Auto</option><option value="light">Light</option><option value="dark">Dark</option>
      </select>
    </label>
  );
}

function Shell({ admin }: { admin: boolean }) {
  const { me, logout } = useAuth();
  const links = admin
    ? [['/admin', 'Overview', true], ['/admin/records', 'Records'], ['/admin/corrections', 'Corrections'], ['/admin/employees', 'People'], ['/admin/sites', 'Sites'], ['/admin/shifts', 'Shifts'], ['/admin/ask', 'Ask AI'], ['/admin/audit', 'Audit'], ['/admin/settings', 'Settings']] as const
    : [['/', 'Check in', true], ['/history', 'History'], ['/notifications', me?.unread ? `Alerts (${me.unread})` : 'Alerts']] as const;
  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <Link to={admin ? '/admin' : '/'} className="brand"><img src="/icon.svg" alt="" />KeyPresence</Link>
        <nav className="nav" aria-label="Main">
          {links.map(([to, label, end]) => <NavLink key={to} to={to} end={!!end}>{label}</NavLink>)}
        </nav>
        <span className="grow" />
        <ThemeToggle />
        {me?.user.role === 'admin' && <Link className="btn sm" to={admin ? '/' : '/admin'}>{admin ? 'Employee view' : 'Admin'}</Link>}
        <button className="btn sm" onClick={() => void logout()}>Sign out</button>
      </header>
      <main id="main" className={admin ? 'main' : 'main narrow'} tabIndex={-1}>
        <Suspense fallback={<Spinner />}><Outlet /></Suspense>
      </main>
      {!admin && (
        <nav className="tabbar" aria-label="Main">
          {links.map(([to, label, end]) => <NavLink key={to} to={to} end={!!end}>{label}</NavLink>)}
        </nav>
      )}
      {admin && (
        <nav className="tabbar" aria-label="Admin" style={{ overflowX: 'auto' }}>
          {links.map(([to, label, end]) => <NavLink key={to} to={to} end={!!end}>{label}</NavLink>)}
        </nav>
      )}
    </div>
  );
}

function Protected({ role }: { role?: 'admin' }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="main"><Spinner /></div>;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (role && me.user.role !== role) return <Navigate to="/" replace />;
  return <Shell admin={role === 'admin'} />;
}

export function App() {
  const { me, loading } = useAuth();
  if (loading) return <div className="main"><Spinner /></div>;
  return (
    <Routes>
      <Route path="/login" element={me ? <Navigate to={me.user.role === 'admin' ? '/admin' : '/'} replace /> : <Login />} />
      <Route element={<Protected />}>
        <Route path="/" element={<Home />} />
        <Route path="/scan" element={<Scan />} />
        <Route path="/s/:token" element={<Scan />} />
        <Route path="/history" element={<History />} />
        <Route path="/notifications" element={<Notifications />} />
      </Route>
      <Route path="/admin" element={<Protected role="admin" />}>
        <Route index element={<Dashboard />} />
        <Route path="records" element={<Records />} />
        <Route path="corrections" element={<Corrections />} />
        <Route path="employees" element={<Employees />} />
        <Route path="sites" element={<Sites />} />
        <Route path="shifts" element={<Shifts />} />
        <Route path="ask" element={<Ask />} />
        <Route path="audit" element={<Audit />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
