import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth';
import { Avatar, Icon, Skeleton, Spinner, type IconName } from './ui';
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

type Theme = 'auto' | 'light' | 'dark';
function useTheme() {
  const [t, setT] = useState<Theme>(() => { try { return (localStorage.getItem('kp-theme') as Theme) ?? 'auto'; } catch { return 'auto'; } });
  useEffect(() => {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('kp-theme', t); } catch { /* private mode */ }
  }, [t]);
  return [t, setT] as const;
}

/** One place for theme, switching between the employee and admin views, and signing out. */
function AccountMenu({ admin }: { admin: boolean }) {
  const { me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', click); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', click); document.removeEventListener('keydown', key); };
  }, [open]);
  if (!me) return null;
  return (
    <div className="account" ref={ref}>
      <button className="account-btn" aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen(!open)}>
        <Avatar name={me.user.name} /><span className="small" style={{ fontWeight: 600 }}>{me.user.name.split(' ')[0]}</span>
      </button>
      {open && (
        <div className="popover" role="menu">
          <div className="who"><strong>{me.user.name}</strong><div className="small muted">{me.user.email}</div></div>
          <div className="seg" role="group" aria-label="Theme">
            {(['auto', 'light', 'dark'] as Theme[]).map((x) => <button key={x} aria-pressed={theme === x} onClick={() => setTheme(x)}>{x[0]!.toUpperCase() + x.slice(1)}</button>)}
          </div>
          {me.user.role === 'admin' && (
            <Link role="menuitem" className="menu-item" to={admin ? '/' : '/admin'}><Icon name="swap" />{admin ? 'Switch to employee view' : 'Switch to admin view'}</Link>
          )}
          <button role="menuitem" className="menu-item" onClick={() => void logout()}><Icon name="logout" />Sign out</button>
        </div>
      )}
    </div>
  );
}

const ADMIN_NAV: { label?: string; items: [string, string, IconName, boolean?][] }[] = [
  { items: [['/admin', 'Overview', 'dashboard', true]] },
  { label: 'Attendance', items: [['/admin/records', 'Records', 'list'], ['/admin/corrections', 'Corrections', 'inbox']] },
  { label: 'Organisation', items: [['/admin/employees', 'People', 'users'], ['/admin/sites', 'Sites', 'pin'], ['/admin/shifts', 'Shifts', 'clock']] },
  { label: 'Insights', items: [['/admin/ask', 'Ask AI', 'sparkle'], ['/admin/audit', 'Audit log', 'shield']] },
];

function AdminShell() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ reviews: number; corrections: number }>({ reviews: 0, corrections: 0 });
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    api<any>('/api/admin/summary').then((s) => setPending({ reviews: s.pendingReviews, corrections: s.pendingCorrections })).catch(() => {});
  }, [loc.pathname]);
  const count = (to: string) => (to === '/admin/records' ? pending.reviews : to === '/admin/corrections' ? pending.corrections : 0);
  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Sidebar">
        <Link to="/admin" className="brand"><img src="/icon.svg" alt="" />KeyPresence</Link>
        <nav aria-label="Admin">
          {ADMIN_NAV.map((g, i) => (
            <div className="side-group" key={i}>
              {g.label && <div className="side-label">{g.label}</div>}
              {g.items.map(([to, label, icon, end]) => (
                <NavLink key={to} to={to} end={!!end} className="side-link">
                  <Icon name={icon} />{label}{count(to) > 0 && <span className="count" aria-label={`${count(to)} pending`}>{count(to)}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-spacer" />
        <NavLink to="/admin/settings" className="side-link"><Icon name="settings" />Settings</NavLink>
      </aside>
      <div className={`scrim${open ? ' open' : ''}`} onClick={() => setOpen(false)} />
      <div className="content">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}><Icon name="menu" /></button>
          <Link to="/admin" className="brand"><img src="/icon.svg" alt="" />KeyPresence</Link>
          <span className="grow" />
          <AccountMenu admin />
        </header>
        <main id="main" className="main" tabIndex={-1}><Suspense fallback={<Skeleton />}><Outlet /></Suspense></main>
      </div>
    </div>
  );
}

function EmployeeShell() {
  const { me } = useAuth();
  const links: [string, string, IconName, boolean?][] = [['/', 'Home', 'home', true], ['/history', 'History', 'history'], ['/notifications', 'Alerts', 'bell']];
  const unread = me?.unread ?? 0;
  return (
    <div className="app no-side">
      <a className="skip" href="#main">Skip to content</a>
      <div className="content">
        <header className="topbar employee-top">
          <Link to="/" className="brand"><img src="/icon.svg" alt="" />KeyPresence</Link>
          <nav className="employee-nav" aria-label="Main">
            {links.map(([to, label, icon, end]) => <NavLink key={to} to={to} end={!!end}><Icon name={icon} size={18} />{label}{to === '/notifications' && unread > 0 ? ` (${unread})` : ''}</NavLink>)}
          </nav>
          <span className="grow" />
          <AccountMenu admin={false} />
        </header>
        <main id="main" className="main narrow" tabIndex={-1}><Suspense fallback={<Skeleton />}><Outlet /></Suspense></main>
        <nav className="tabbar" aria-label="Main">
          {links.map(([to, label, icon, end]) => (
            <NavLink key={to} to={to} end={!!end}><Icon name={icon} />{label}{to === '/notifications' && unread > 0 && <span className="count-dot" aria-label={`${unread} unread`}>{unread}</span>}</NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

function Protected({ role }: { role?: 'admin' }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="main"><Spinner /></div>;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (role && me.user.role !== role) return <Navigate to="/" replace />;
  return role === 'admin' ? <AdminShell /> : <EmployeeShell />;
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
