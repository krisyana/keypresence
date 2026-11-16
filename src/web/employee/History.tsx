import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { isoToZonedInput, zonedInputToIso } from '../tz';
import { Alert, Badge, Button, Empty, Field, Modal, Page, Spinner, flagLabel, fmtDateTime, fmtMinutes, fmtTime } from '../ui';

interface Rec {
  id: string; kind: string; subject_ref: string | null; day: string; status: string; check_in_at: string; check_out_at: string | null;
  in_flags: string[]; out_flags: string[] | null; review_status: string; late_minutes: number | null; overtime_minutes: number | null;
  work_minutes: number | null; closed_by: string | null; site_name: string; correction_pending: boolean;
}
interface Corr {
  id: string; checkin_id: string; status: string; reason: string; created_at: string;
  proposed_check_in_at: string | null; proposed_check_out_at: string | null;
}

const KIND_LABEL: Record<string, string> = { attendance: 'Attendance', visitor: 'Visitor', event: 'Event', asset: 'Asset', task: 'Task' };
const CORR_BADGE: Record<string, 'info' | 'ok' | 'bad'> = { pending: 'info', approved: 'ok', rejected: 'bad' };
const CORR_TEXT: Record<string, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };

export default function History() {
  const { me } = useAuth();
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

  return (
    <Page title="History">
      {error && <Alert kind="bad">{error}</Alert>}
      {!items && !error && <Spinner label="Loading history" />}
      {items && items.length === 0 && <Empty>No check-ins yet.</Empty>}
      {items && items.length > 0 && (
        <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((r) => {
            const flags = [...(r.in_flags ?? []), ...(r.out_flags ?? [])].filter((f, i, a) => a.indexOf(f) === i);
            return (
              <li key={r.id} className="card stack-sm">
                <div className="row between">
                  <strong>{r.site_name}</strong>
                  <span className="small muted">{r.day}</span>
                </div>
                <div className="small">
                  {KIND_LABEL[r.kind] ?? r.kind}{r.subject_ref ? ` · ${r.subject_ref}` : ''}
                </div>
                <div>
                  In {fmtTime(r.check_in_at, tz)} · Out {r.check_out_at ? fmtTime(r.check_out_at, tz) : 'still open'}
                  {r.check_out_at && <> · Worked {fmtMinutes(r.work_minutes)}</>}
                </div>
                <div className="row">
                  {!!r.late_minutes && <Badge kind="warn">Late {r.late_minutes} min</Badge>}
                  {!!r.overtime_minutes && <Badge kind="info">Overtime {r.overtime_minutes} min</Badge>}
                  {flags.map((f) => <Badge key={f} kind="warn">{flagLabel(f)}</Badge>)}
                  {r.review_status === 'pending' && <Badge kind="warn">Needs review</Badge>}
                  {r.correction_pending && <Badge kind="info">Correction requested</Badge>}
                </div>
                {r.closed_by === 'auto' && <p className="small muted" style={{ margin: 0 }}>Auto-closed by the system. You can request a correction.</p>}
                {!r.correction_pending && (
                  <div><Button size="sm" onClick={() => setTarget(r)} aria-label={`Request correction for ${r.site_name} on ${r.day}`}>Request correction</Button></div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <h2 style={{ marginBottom: 0 }}>My correction requests</h2>
      {corrs && corrs.length === 0 && <Empty>You have not requested any corrections.</Empty>}
      {corrs && corrs.length > 0 && (
        <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {corrs.map((c) => (
            <li key={c.id} className="card stack-sm">
              <div className="row between">
                <span className="small muted">Requested {fmtDateTime(c.created_at, tz)}</span>
                <Badge kind={CORR_BADGE[c.status] ?? ''}>{CORR_TEXT[c.status] ?? c.status}</Badge>
              </div>
              {(c.proposed_check_in_at || c.proposed_check_out_at) && (
                <div className="small">
                  {c.proposed_check_in_at && <>Proposed in: {fmtDateTime(c.proposed_check_in_at, tz)}. </>}
                  {c.proposed_check_out_at && <>Proposed out: {fmtDateTime(c.proposed_check_out_at, tz)}.</>}
                </div>
              )}
              <div>{c.reason}</div>
            </li>
          ))}
        </ul>
      )}

      <CorrectionModal rec={target} tz={tz} onClose={() => setTarget(null)} onDone={() => { setTarget(null); void load(); }} />
    </Page>
  );
}

function CorrectionModal({ rec, tz, onClose, onDone }: { rec: Rec | null; tz: string; onClose: () => void; onDone: () => void }) {
  return (
    <Modal title="Request a correction" open={!!rec} onClose={onClose}>
      {rec && <CorrectionForm key={rec.id} rec={rec} tz={tz} onClose={onClose} onDone={onDone} />}
    </Modal>
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
  const reasonError = reason.length > 0 && reason.trim().length < 5 ? 'Please give at least 5 characters.' : undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const proposedCheckInAt = inV && inV !== origIn ? zonedInputToIso(inV, tz) : undefined;
    const proposedCheckOutAt = outV && outV !== origOut ? zonedInputToIso(outV, tz) : undefined;
    if (!proposedCheckInAt && !proposedCheckOutAt) return setError('Change the check-in or check-out time first.');
    if (reason.trim().length < 5) return setError('Please explain the reason (at least 5 characters).');
    setBusy(true);
    try {
      await api('/api/corrections', { body: { checkinId: rec.id, proposedCheckInAt, proposedCheckOutAt, reason: reason.trim() } });
      onDone();
    } catch (err: any) {
      setError(err.message ?? 'Could not send the request.');
    } finally { setBusy(false); }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <p className="small muted" style={{ margin: 0 }}>{rec.site_name} · times are in {tz}</p>
      <Field label="Check-in time">{(p) => <input type="datetime-local" value={inV} onChange={(e) => setInV(e.target.value)} {...p} />}</Field>
      <Field label="Check-out time" hint="Leave as is if it is correct.">{(p) => <input type="datetime-local" value={outV} onChange={(e) => setOutV(e.target.value)} {...p} />}</Field>
      <Field label="Reason (required)" error={reasonError}>
        {(p) => <textarea rows={3} required minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} {...p} />}
      </Field>
      {error && <Alert kind="bad">{error}</Alert>}
      <div className="row">
        <Button type="submit" variant="primary" busy={busy}>Send request</Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}
