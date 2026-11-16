import { useState } from 'react';
import { api, qs } from '../api';
import { Alert, Badge, Button, Empty, Field, Page, fmtDateTime } from '../ui';
import { A, Async, errMsg, useLoad, useOrgTz } from './shared';

interface Correction {
  id: string; status: 'pending' | 'approved' | 'rejected'; reason: string; user_name: string; site_name: string; kind: string; created_at: string;
  current_check_in_at: string; current_check_out_at: string | null; proposed_check_in_at: string | null; proposed_check_out_at: string | null; decision_note: string | null;
}

function Item({ c, tz, onDone }: { c: Correction; tz: string; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'a' | 'r' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function decide(approve: boolean) {
    setBusy(approve ? 'a' : 'r'); setErr(null);
    try { await api(`${A}/corrections/${c.id}/decide`, { body: { approve, note: note || undefined } }); onDone(); }
    catch (e) { setErr(errMsg(e)); setBusy(null); }
  }
  const change = (cur: string | null, prop: string | null) => prop
    ? <>{fmtDateTime(cur, tz)} → <strong>{fmtDateTime(prop, tz)}</strong></> : <>{fmtDateTime(cur, tz)} <span className="muted">(unchanged)</span></>;
  return (
    <li className="card stack-sm" style={{ listStyle: 'none' }}>
      <div className="row between">
        <strong>{c.user_name}</strong>
        <Badge kind={c.status === 'pending' ? 'warn' : c.status === 'approved' ? 'ok' : 'bad'}>{c.status === 'pending' ? 'Pending' : c.status === 'approved' ? 'Approved' : 'Rejected'}</Badge>
      </div>
      <div className="small muted">{c.kind} at {c.site_name}, requested {fmtDateTime(c.created_at, tz)}</div>
      <div>Check-in: {change(c.current_check_in_at, c.proposed_check_in_at)}</div>
      <div>Check-out: {c.current_check_out_at || c.proposed_check_out_at ? change(c.current_check_out_at, c.proposed_check_out_at) : 'still open'}</div>
      <div>Reason: {c.reason}</div>
      {c.status !== 'pending' && c.decision_note && <div className="small">Decision note: {c.decision_note}</div>}
      {c.status === 'pending' && (
        <div className="stack-sm">
          {err && <Alert kind="bad">{err}</Alert>}
          <Field label="Note to employee (optional)">{(p) => <input {...p} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <div className="row">
            <Button variant="primary" busy={busy === 'a'} disabled={busy !== null} onClick={() => void decide(true)} aria-label={`Approve correction from ${c.user_name}`}>Approve</Button>
            <Button variant="danger" busy={busy === 'r'} disabled={busy !== null} onClick={() => void decide(false)} aria-label={`Reject correction from ${c.user_name}`}>Reject</Button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function Corrections() {
  const tz = useOrgTz();
  const [status, setStatus] = useState('pending');
  const list = useLoad<{ items: Correction[] }>(`${A}/corrections${qs({ status })}`);
  return (
    <Page title="Corrections">
      <div style={{ maxWidth: 260 }}>
        <Field label="Status">{(p) => <select {...p} value={status} onChange={(e) => setStatus(e.target.value)}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All</option></select>}</Field>
      </div>
      <Async loading={list.loading} error={list.error} hasData={!!list.data}>
        {list.data && (list.data.items.length === 0
          ? <Empty>{status === 'pending' ? 'No corrections waiting for a decision.' : 'No corrections with this status.'}</Empty>
          : <ul className="stack" style={{ margin: 0, padding: 0 }} aria-label="Correction requests">{list.data.items.map((c) => <Item key={c.id} c={c} tz={tz} onDone={list.reload} />)}</ul>)}
      </Async>
    </Page>
  );
}
