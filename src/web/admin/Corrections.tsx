import { useState } from 'react';
import { api, qs } from '../api';
import { Alert, Badge, Button, Card, Empty, Field, Icon, Page, fmtDateTime, useToast } from '../ui';
import { A, Async, Confirm, PersonCell, Segmented, errMsg, useLoad, useOrgTz } from './shared';

interface Correction {
  id: string; status: 'pending' | 'approved' | 'rejected'; reason: string; user_name: string; site_name: string; kind: string; created_at: string;
  current_check_in_at: string; current_check_out_at: string | null; proposed_check_in_at: string | null; proposed_check_out_at: string | null; decision_note: string | null;
}

function BeforeAfter({ label, cur, prop, tz }: { label: string; cur: string | null; prop: string | null; tz: string }) {
  return (
    <div>
      <div className="ba-title">{label}</div>
      <div className="ba">
        <div><div className="lbl">Before</div><div className="t">{cur ? fmtDateTime(cur, tz) : 'Open'}</div></div>
        <Icon name="chevron" size={18} className="arrow" />
        <div><div className="lbl">After</div><div className="t">{prop ? fmtDateTime(prop, tz) : <span className="muted">Unchanged</span>}</div></div>
      </div>
    </div>
  );
}

function Item({ c, tz, onDone }: { c: Correction; tz: string; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'a' | 'r' | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function decide(approve: boolean) {
    setBusy(approve ? 'a' : 'r'); setErr(null);
    try {
      await api(`${A}/corrections/${c.id}/decide`, { body: { approve, note: note || undefined } });
      toast(approve ? `Correction from ${c.user_name} approved` : `Correction from ${c.user_name} rejected`);
      setConfirmReject(false); onDone();
    } catch (e) { setConfirmReject(false); setErr(errMsg(e)); setBusy(null); }
  }
  return (
    <li style={{ listStyle: 'none' }}>
      <Card>
        <div className="stack">
          <div className="row between">
            <div>
              <PersonCell name={c.user_name} sub={`${c.kind} at ${c.site_name}, requested ${fmtDateTime(c.created_at, tz)}`} />
            </div>
            <Badge dot kind={c.status === 'pending' ? 'warn' : c.status === 'approved' ? 'ok' : 'bad'}>{c.status === 'pending' ? 'Pending' : c.status === 'approved' ? 'Approved' : 'Rejected'}</Badge>
          </div>
          <div className="corr-grid">
            <BeforeAfter label="Check-in" cur={c.current_check_in_at} prop={c.proposed_check_in_at} tz={tz} />
            {(c.current_check_out_at || c.proposed_check_out_at) && <BeforeAfter label="Check-out" cur={c.current_check_out_at} prop={c.proposed_check_out_at} tz={tz} />}
          </div>
          <dl className="kv">
            <dt>Reason</dt><dd style={{ fontWeight: 400 }}>{c.reason}</dd>
            {c.status !== 'pending' && c.decision_note && <><dt>Decision note</dt><dd style={{ fontWeight: 400 }}>{c.decision_note}</dd></>}
          </dl>
          {c.status === 'pending' && (
            <div className="stack-sm">
              {err && <Alert kind="bad">{err}</Alert>}
              <Field label="Note to employee (optional)">{(p) => <input {...p} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
              <div className="row">
                <Button variant="primary" busy={busy === 'a'} disabled={busy !== null} onClick={() => void decide(true)} aria-label={`Approve correction from ${c.user_name}`}><Icon name="check" size={16} />Approve</Button>
                <Button variant="danger" disabled={busy !== null} onClick={() => setConfirmReject(true)} aria-label={`Reject correction from ${c.user_name}`}>Reject</Button>
              </div>
            </div>
          )}
        </div>
      </Card>
      <Confirm open={confirmReject} danger busy={busy === 'r'} title="Reject this correction?" confirmLabel="Reject" onClose={() => setConfirmReject(false)} onConfirm={() => void decide(false)}>
        {c.user_name} keeps the original times{note ? ' and sees your note' : ''}.
      </Confirm>
    </li>
  );
}

export default function Corrections() {
  const tz = useOrgTz();
  const [status, setStatus] = useState('pending');
  const list = useLoad<{ items: Correction[] }>(`${A}/corrections${qs({ status })}`);
  return (
    <Page title="Corrections" subtitle="Time changes requested by employees." actions={
      <Segmented label="Status" value={status} onChange={setStatus} options={[{ value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }, { value: '', label: 'All' }]} />
    }>
      <Async loading={list.loading} error={list.error} hasData={!!list.data}>
        {list.data && (list.data.items.length === 0
          ? <Card><Empty icon="inbox" title={status === 'pending' ? 'All caught up' : 'Nothing here'}>{status === 'pending' ? 'No corrections are waiting for a decision.' : 'No corrections with this status.'}</Empty></Card>
          : <ul className="stack" style={{ margin: 0, padding: 0 }} aria-label="Correction requests">{list.data.items.map((c) => <Item key={c.id} c={c} tz={tz} onDone={list.reload} />)}</ul>)}
      </Async>
    </Page>
  );
}
