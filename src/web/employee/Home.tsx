import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alert, Badge, Button, Page, flagLabel, fmtTime } from '../ui';

const KIND_LABEL: Record<string, string> = {
  attendance: 'Attendance', visitor: 'Visitor', event: 'Event', asset: 'Asset', task: 'Task',
};

export default function Home() {
  const { me, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!me) return null;
  const consented = !!me.user.location_consent_at;
  const first = me.user.name.split(' ')[0];

  async function setConsent(consent: boolean) {
    setBusy(true); setError('');
    try {
      await api('/api/me/consent', { body: { consent } });
      await refresh();
    } catch (e: any) {
      setError(e.message ?? 'Could not save your choice.');
    } finally { setBusy(false); }
  }

  return (
    <Page title={`Hello, ${first}`}>
      <p className="muted" style={{ margin: 0 }}>
        {me.shift
          ? `Today's shift: ${me.shift.name}, ${me.shift.start_time.slice(0, 5)} to ${me.shift.end_time.slice(0, 5)}`
          : 'No shift is assigned to you.'}
      </p>
      {error && <Alert kind="bad">{error}</Alert>}

      {!consented ? (
        <div className="card stack" aria-labelledby="consent-h">
          <h2 id="consent-h" style={{ margin: 0 }}>Location consent</h2>
          <p style={{ margin: 0 }}>To check in or out, KeyPresence needs to confirm you are at the site. Before you continue, please note:</p>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            <li>Your location is read only at the moment you check in or out, never in the background.</li>
            <li>Coordinates are kept for 90 days by default, then removed. Times and review flags are kept.</li>
            <li>You can withdraw consent at any time. Check-in is then unavailable until you agree again.</li>
          </ul>
          <Button variant="primary" size="big" busy={busy} onClick={() => setConsent(true)}>I agree</Button>
        </div>
      ) : (
        <>
          <div className="card status-hero stack" aria-live="polite">
            {me.open.length === 0 ? (
              <div className="big">You are not checked in</div>
            ) : (
              <>
                <div className="big">You are checked in</div>
                {me.open.map((o) => (
                  <div key={o.id} className="stack-sm" style={{ textAlign: 'left', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                    <div><strong>{o.site_name}</strong></div>
                    <div className="small muted">
                      {KIND_LABEL[o.kind] ?? o.kind}{o.subject_ref ? ` · ${o.subject_ref}` : ''} · since {fmtTime(o.check_in_at, me.timezone)}
                    </div>
                    {o.in_flags.length > 0 && (
                      <div className="row">
                        {o.in_flags.map((f) => <Badge key={f} kind="warn">{flagLabel(f)}</Badge>)}
                      </div>
                    )}
                    <Link className="btn" to={`/scan?out=${o.id}`} aria-label={`Check out of ${o.site_name}`}>Check out</Link>
                  </div>
                ))}
              </>
            )}
          </div>
          <Link className="btn primary big" to="/scan" style={{ textDecoration: 'none' }}>Scan QR to check in</Link>

          <details className="card">
            <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>Privacy settings</summary>
            <div className="stack-sm">
              <p className="small muted" style={{ margin: 0 }}>
                Location consent given {new Date(me.user.location_consent_at!).toLocaleDateString('en-GB', { timeZone: me.timezone })}.
                If you withdraw, you will not be able to check in or out until you agree again. Ask HR if you need a manual record.
              </p>
              <div><Button size="sm" busy={busy} onClick={() => setConsent(false)}>Withdraw location consent</Button></div>
            </div>
          </details>
        </>
      )}
    </Page>
  );
}
