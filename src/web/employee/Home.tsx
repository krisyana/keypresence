import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alert, Button, Card, Empty, Icon, Skeleton, fmtMinutes, fmtTime, useToast } from '../ui';
import { todayIn } from '../tz';
import { EmployeeStyles, KIND_LABEL, RecBadges, dayLabel, timeRange, useNow, type Rec } from './bits';

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
  const finished = !lead ? recent?.find((r) => r.day === todayIn(tz) && r.check_out_at) : undefined;
  const sentence = lead ? `You have been in since ${fmtTime(lead.check_in_at, tz)}.` : finished ? `You finished at ${fmtTime(finished.check_out_at, tz)}.` : 'You are not checked in.';
  const detail = lead ? lead.site_name : finished ? `${fmtMinutes(finished.work_minutes)} at ${finished.site_name}` : '';

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

      <div className="home-panel">
        <div className="home-top">
          <span>Hello, {first}</span>
          <span className="home-clock num" aria-label={`Time now ${parts[0]}:${parts[1]}`}>{parts[0]}:{parts[1]}<span className="muted-ink">:{parts[2]}</span></span>
        </div>
        <div aria-live="polite" className="home-status">
          <p className="home-sentence">{sentence}</p>
          {detail && <p className="home-detail">{detail}</p>}
        </div>
        {open.length === 0 ? (
          <Link className="btn primary big" to="/scan"><Icon name="scan" size={24} />Scan QR to check in</Link>
        ) : (
          <div className="stack-sm">
            {open.map((o) => (
              <Link key={o.id} className="btn primary big" to={`/scan?out=${o.id}`} aria-label={`Check out of ${o.site_name}`}>
                <Icon name="logout" size={22} />{open.length > 1 ? `Check out, ${o.site_name}` : 'Check out'}
              </Link>
            ))}
          </div>
        )}
        <p className="home-shift">{me.shift ? <>{me.shift.name}, {me.shift.start_time.slice(0, 5)} to {me.shift.end_time.slice(0, 5)}. {date}.</> : <>No shift today. {date}.</>}</p>
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

      <Card title="Recent activity" actions={recent && recent.length > 0 ? <Link to="/history" className="small">See all</Link> : undefined}>
        {recentErr && <Alert kind="bad">{recentErr}</Alert>}
        {!recent && !recentErr && <Skeleton lines={3} />}
        {recent && recent.length === 0 && (
          <Empty icon="history" title="No check-ins yet" action={open.length === 0 ? <Link to="/scan" className="btn">Scan your first QR</Link> : undefined} />
        )}
        {recent && recent.length > 0 && (
          <ul className="recent">
            {recent.map((r) => (
              <li key={r.id}>
                <div className="recent-main">
                  <strong>{dayLabel(r.day, tz)}</strong>
                  <span className="small muted">{r.site_name}{r.kind !== 'attendance' ? `, ${KIND_LABEL[r.kind] ?? r.kind}` : ''}</span>
                  <span className="row" style={{ gap: 6 }}><RecBadges r={r} /></span>
                </div>
                <div className="recent-time num">
                  <span>{timeRange(r, (i) => fmtTime(i, tz))}</span>
                  {r.check_out_at && <span className="small muted">{fmtMinutes(r.work_minutes)}</span>}
                </div>
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
