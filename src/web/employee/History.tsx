import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { isoToZonedInput, zonedInputToIso } from '../tz';
import { Alert, Badge, Button, Empty, Field, Icon, Modal, Page, Skeleton, fmtDateTime, fmtMinutes, fmtTime, useToast } from '../ui';
import { EmployeeStyles, KIND_LABEL, RecBadges, RecIcon, dayLabel, timeRange, type Rec } from './bits';

interface Corr {
  id: string; checkin_id: string; status: string; reason: string; created_at: string;
  proposed_check_in_at: string | null; proposed_check_out_at: string | null;
}

const CORR_BADGE: Record<string, 'info' | 'ok' | 'bad'> = { pending: 'info', approved: 'ok', rejected: 'bad' };
const CORR_TEXT: Record<string, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };

export default function History() {
  const { me } = useAuth();
  const toast = useToast();
  const tz = me?.timezone ?? 'UTC';
  const [items, setItems] = useState<Rec[] | null>(null);
  const [corrs, setCorrs] = useState<Corr[] | null>(null);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<Rec | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        api<{ items: Rec[] }>('/api/checkins/mine'),
        api<{ items: Corr[] }>('/api/corrections/mine'),
      ]);
      setItems(a.items); setCorrs(b.items); setError('');
    } catch (e: any) { setError(e.message ?? 'Could not load your history.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => {
    const g: { day: string; recs: Rec[] }[] = [];
    for (const r of items ?? []) {
      const last = g[g.length - 1];
      if (last && last.day === r.day) last.recs.push(r); else g.push({ day: r.day, recs: [r] });
    }
    return g;
  }, [items]);

  return (
    <Page title="History">
      <EmployeeStyles />
      {error && <Alert kind="bad">{error}</Alert>}
      {!items && !error && <div className="card"><Skeleton lines={4} /></div>}
      {items && items.length === 0 && (
        <div className="card"><Empty icon="history" title="No check-ins yet" action={<Link to="/scan" className="btn">Scan a QR code</Link>} /></div>
      )}
      {groups.map((g) => (
        <section key={g.day} aria-label={dayLabel(g.day, tz)}>
          <h2 className="day-label">{dayLabel(g.day, tz)}</h2>
          <ul className="plain-list">
            {g.recs.map((r) => (
              <li key={r.id} className="card rec">
                <RecIcon kind={r.kind} />
                <div className="rec-body">
                  <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="rec-title">{r.site_name}</div>
                      <div className="small muted">{KIND_LABEL[r.kind] ?? r.kind}{r.subject_ref ? ` · ${r.subject_ref}` : ''}</div>
                    </div>
                    {r.check_out_at && <strong className="num">{fmtMinutes(r.work_minutes)}</strong>}
                  </div>
                  <div className="num">{timeRange(r, (i) => fmtTime(i, tz))}</div>
                  <div className="row" style={{ gap: 6 }}><RecBadges r={r} full /></div>
                  {!r.correction_pending && (
                    <div><Button size="sm" onClick={() => setTarget(r)} aria-label={`Request correction for ${r.site_name} on ${r.day}`}>Request correction</Button></div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {corrs && corrs.length > 0 && (
        <section aria-labelledby="corr-h">
          <h2 id="corr-h" className="day-label">Correction requests</h2>
          <ul className="plain-list">
            {corrs.map((c) => (
              <li key={c.id} className="card rec">
                <span className="tl-icon"><Icon name="swap" size={20} /></span>
                <div className="rec-body">
                  <div className="row between" style={{ flexWrap: 'nowrap' }}>
                    <span className="small muted">{fmtDateTime(c.created_at, tz)}</span>
                    <Badge kind={CORR_BADGE[c.status] ?? ''}>{CORR_TEXT[c.status] ?? c.status}</Badge>
                  </div>
                  {(c.proposed_check_in_at || c.proposed_check_out_at) && (
                    <div className="num small">
                      {c.proposed_check_in_at && <>In {fmtDateTime(c.proposed_check_in_at, tz)}</>}
                      {c.proposed_check_in_at && c.proposed_check_out_at && ' · '}
                      {c.proposed_check_out_at && <>Out {fmtDateTime(c.proposed_check_out_at, tz)}</>}
                    </div>
                  )}
                  <div>{c.reason}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Modal title="Request a correction" open={!!target} onClose={() => setTarget(null)}>
        {target && (
          <CorrectionForm key={target.id} rec={target} tz={tz} onClose={() => setTarget(null)}
            onDone={() => { setTarget(null); toast('Correction request sent'); void load(); }} />
        )}
      </Modal>
    </Page>
  );
}

function CorrectionForm({ rec, tz, onClose, onDone }: { rec: Rec; tz: string; onClose: () => void; onDone: () => void }) {
  const [inV, setInV] = useState(isoToZonedInput(rec.check_in_at, tz));
  const [outV, setOutV] = useState(rec.check_out_at ? isoToZonedInput(rec.check_out_at, tz) : '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const origIn = isoToZonedInput(rec.check_in_at, tz);
  const origOut = rec.check_out_at ? isoToZonedInput(rec.check_out_at, tz) : '';
  const reasonError = reason.length > 0 && reason.trim().length < 5 ? 'At least 5 characters.' : undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const proposedCheckInAt = inV && inV !== origIn ? zonedInputToIso(inV, tz) : undefined;
    const proposedCheckOutAt = outV && outV !== origOut ? zonedInputToIso(outV, tz) : undefined;
    if (!proposedCheckInAt && !proposedCheckOutAt) return setError('Change the check-in or check-out time first.');
    if (reason.trim().length < 5) return setError('Add a reason (at least 5 characters).');
    setBusy(true);
    try {
      await api('/api/corrections', { body: { checkinId: rec.id, proposedCheckInAt, proposedCheckOutAt, reason: reason.trim() } });
      onDone();
    } catch (err: any) {
      setError(err.message ?? 'Could not send the request.');
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit}>
      <p className="small muted">{rec.site_name} · {rec.day}</p>
      <div className="form-grid">
        <Field label="Check in">{(p) => <input type="datetime-local" value={inV} onChange={(e) => setInV(e.target.value)} {...p} />}</Field>
        <Field label="Check out">{(p) => <input type="datetime-local" value={outV} onChange={(e) => setOutV(e.target.value)} {...p} />}</Field>
      </div>
      <Field label="Reason" error={reasonError}>
        {(p) => <textarea rows={2} required minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} {...p} />}
      </Field>
      {error && <Alert kind="bad">{error}</Alert>}
      <div className="row">
        <Button type="submit" variant="primary" busy={busy}>Send request</Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}
