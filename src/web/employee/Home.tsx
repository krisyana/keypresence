import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alert, Button, Card, Empty, Icon, Skeleton, fmtMinutes, fmtTime, useToast } from '../ui';
import { EmployeeStyles, KIND_LABEL, RecBadges, RecIcon, dayLabel, timeRange, useNow, type Rec } from './bits';

export default function Home() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recent, setRecent] = useState<Rec[] | null>(null);
  const [recentErr, setRecentErr] = useState('');
  const openKey = me?.open.map((o) => o.id).join(',') ?? '';

  useEffect(() => { document.title = 'Home · KeyPresence'; }, []);
  useEffect(() => {
    let live = true;
    api<{ items: Rec[] }>('/api/checkins/mine')
      .then((r) => { if (live) { setRecent(r.items.slice(0, 5)); setRecentErr(''); } })
      .catch((e: any) => { if (live) setRecentErr(e.message ?? 'Could not load your activity.'); });
    return () => { live = false; };
  }, [openKey]);

  if (!me) return null;
  const tz = me.timezone;
  const consented = !!me.user.location_consent_at;
  const first = me.user.name.split(' ')[0];
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now).split(':');
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  const open = me.open;
  const lead = open[0];

  async function setConsent(consent: boolean) {
    setBusy(true); setError('');
    try {
      await api('/api/me/consent', { body: { consent } });
      await refresh();
      toast(consent ? 'Thanks, location consent saved' : 'Consent withdrawn', consent ? 'ok' : 'info');
    } catch (e: any) {
      setError(e.message ?? 'Could not save your choice.');
    } finally { setBusy(false); }
  }

  return (
    <section className="page">
      <EmployeeStyles />
      <h1 className="sr-only">Home</h1>
      {error && <Alert kind="bad">{error}</Alert>}

      <div className="hero">
        <div>
          <div className="small" style={{ opacity: 0.9 }}>Hello, {first}</div>
          <div className="clock num" style={{ marginTop: 8 }}>{parts[0]}:{parts[1]}<span style={{ fontSize: '1.4rem', opacity: 0.7 }}>:{parts[2]}</span></div>
          <div className="date">{date}</div>
        </div>
        <div aria-live="polite">
          <span className={`status${lead ? ' in' : ''}`}>
            <i className="dot" aria-hidden="true" />
            {lead ? `Checked in · since ${fmtTime(lead.check_in_at, tz)} · ${lead.site_name}` : 'Not checked in'}
          </span>
        </div>
        {open.length === 0 ? (
          <Link className="btn primary big" to="/scan"><Icon name="scan" size={24} />Scan QR to check in</Link>
        ) : (
          <div className="stack-sm">
            {open.map((o) => (
              <Link key={o.id} className="btn primary big" to={`/scan?out=${o.id}`} aria-label={`Check out of ${o.site_name}`}>
                <Icon name="logout" size={22} />{open.length > 1 ? `Check out · ${o.site_name}` : 'Check out'}
              </Link>
            ))}
          </div>
        )}
      </div>

      {!consented && (
        <Card title="Location consent">
          <div className="stack">
            <ul className="bullets">
              <li><Icon name="pin" size={18} />Read only when you check in or out</li>
              <li><Icon name="shield" size={18} />Never in the background</li>
              <li><Icon name="calendar" size={18} />Kept for 90 days</li>
            </ul>
            <Button variant="primary" size="big" busy={busy} onClick={() => setConsent(true)}>I agree</Button>
          </div>
        </Card>
      )}

      <Card title="Today">
        <div className="row" style={{ gap: 12 }}>
          <span className="tl-icon"><Icon name="calendar" size={20} /></span>
          <div>
            {me.shift ? (
              <><strong>{me.shift.name}</strong> <span className="muted num">· {me.shift.start_time.slice(0, 5)} – {me.shift.end_time.slice(0, 5)}</span></>
            ) : <span className="muted">No shift today</span>}
          </div>
        </div>
      </Card>

      <Card title="Recent activity" actions={recent && recent.length > 0 ? <Link to="/history" className="small">See all</Link> : undefined}>
        {recentErr && <Alert kind="bad">{recentErr}</Alert>}
        {!recent && !recentErr && <Skeleton lines={3} />}
        {recent && recent.length === 0 && (
          <Empty icon="history" title="No check-ins yet" action={open.length === 0 ? <Link to="/scan" className="btn">Scan your first QR</Link> : undefined} />
        )}
        {recent && recent.length > 0 && (
          <ul className="timeline">
            {recent.map((r) => (
              <li key={r.id}>
                <RecIcon kind={r.kind} />
                <div className="stack-xs" style={{ minWidth: 0 }}>
                  <strong>{r.site_name} · {KIND_LABEL[r.kind] ?? r.kind}</strong>
                  <span className="small muted num">{dayLabel(r.day, tz)} · {timeRange(r, (i) => fmtTime(i, tz))}</span>
                  <span className="row" style={{ gap: 6 }}><RecBadges r={r} /></span>
                </div>
                {r.check_out_at && <span className="small muted num">{fmtMinutes(r.work_minutes)}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {consented && (
        <div style={{ textAlign: 'center' }}>
          <button type="button" className="link-btn" disabled={busy} onClick={() => setConsent(false)}>Withdraw location consent</button>
        </div>
      )}
    </section>
  );
}
