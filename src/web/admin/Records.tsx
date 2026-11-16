import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { isoToZonedInput, zonedInputToIso } from '../tz';
import { Alert, Badge, Button, Empty, Field, Modal, Page, flagLabel, fmtDateTime, fmtMinutes, fmtTime } from '../ui';
import { A, Async, KIND_LIST, errMsg, fmtDist, useLoad, useOrgTz, type Employee, type Site } from './shared';

interface Rec {
  id: string; user_id: string; user_name: string; user_email: string; site_name: string; kind: string; subject_ref: string | null; day: string; status: string;
  check_in_at: string; check_out_at: string | null; in_distance_m: number | null; out_distance_m: number | null; in_accuracy_m: number | null; out_accuracy_m: number | null;
  in_flags: string[]; out_flags: string[]; review_status: 'pending' | 'reviewed' | 'none'; review_note: string | null; closed_by: string | null;
  late_minutes: number | null; overtime_minutes: number | null; work_minutes: number | null; override_reason: string | null;
}
const PAGE = 50;
const FILTERS = ['from', 'to', 'siteId', 'userId', 'kind', 'flagged', 'review'] as const;

function reviewBadge(r: Rec['review_status']) {
  return r === 'pending' ? <Badge kind="warn">Review pending</Badge> : r === 'reviewed' ? <Badge kind="ok">Reviewed</Badge> : <Badge kind="">No review needed</Badge>;
}
function Flags({ r }: { r: Rec }) {
  const all = [...new Set([...r.in_flags, ...r.out_flags])];
  if (!all.length) return <span className="muted">None</span>;
  return <>{all.map((f) => <Badge key={f} kind={f === 'ADMIN_OVERRIDE' ? 'info' : 'warn'}>{flagLabel(f)}</Badge>)}</>;
}

function Details({ rec, tz, onDone }: { rec: Rec; tz: string; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [inAt, setInAt] = useState(isoToZonedInput(rec.check_in_at, tz));
  const [outAt, setOutAt] = useState(rec.check_out_at ? isoToZonedInput(rec.check_out_at, tz) : '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'review' | 'edit' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function review(e: FormEvent) {
    e.preventDefault(); setBusy('review'); setErr(null);
    try { await api(`${A}/checkins/${rec.id}/review`, { method: 'PATCH', body: { note } }); onDone(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(null); }
  }
  async function edit(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const body: Record<string, string> = { reason };
    if (inAt !== isoToZonedInput(rec.check_in_at, tz)) body.checkInAt = zonedInputToIso(inAt, tz);
    if (outAt && outAt !== (rec.check_out_at ? isoToZonedInput(rec.check_out_at, tz) : '')) body.checkOutAt = zonedInputToIso(outAt, tz);
    if (!body.checkInAt && !body.checkOutAt) { setErr('Change the check-in or check-out time first.'); return; }
    setBusy('edit');
    try { await api(`${A}/checkins/${rec.id}`, { method: 'PATCH', body }); onDone(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(null); }
  }

  const row = (k: string, v: React.ReactNode) => <tr><th scope="row" style={{ textTransform: 'none', whiteSpace: 'normal' }}>{k}</th><td>{v}</td></tr>;
  return (
    <div className="stack">
      <div className="table-wrap"><table>
        <caption className="sr-only">Record details</caption>
        <tbody>
          {row('Employee', `${rec.user_name} (${rec.user_email})`)}
          {row('Site', rec.site_name)}
          {row('Kind', rec.kind + (rec.subject_ref ? `: ${rec.subject_ref}` : ''))}
          {row('Check-in', `${fmtDateTime(rec.check_in_at, tz)}, ${fmtDist(rec.in_distance_m)} from site, accuracy ${fmtDist(rec.in_accuracy_m)}`)}
          {row('Check-out', rec.check_out_at ? `${fmtDateTime(rec.check_out_at, tz)}, ${fmtDist(rec.out_distance_m)} from site, accuracy ${fmtDist(rec.out_accuracy_m)}` : 'Still open')}
          {row('Check-in flags', rec.in_flags.length ? rec.in_flags.map((f) => <Badge key={f} kind="warn">{flagLabel(f)}</Badge>) : 'None')}
          {row('Check-out flags', rec.out_flags.length ? rec.out_flags.map((f) => <Badge key={f} kind="warn">{flagLabel(f)}</Badge>) : 'None')}
          {row('Worked / late / overtime', `${fmtMinutes(rec.work_minutes)} / ${rec.late_minutes ?? 0} min / ${rec.overtime_minutes ?? 0} min`)}
          {row('Closed by', rec.closed_by === 'auto' ? 'Automatically (employee did not check out)' : rec.closed_by === 'admin' ? 'Admin' : rec.closed_by ?? '–')}
          {row('Override reason', rec.override_reason ?? '–')}
          {row('Review', <>{reviewBadge(rec.review_status)}{rec.review_note && <div className="small">{rec.review_note}</div>}</>)}
        </tbody>
      </table></div>
      {err && <Alert kind="bad">{err}</Alert>}
      {rec.review_status === 'pending' && (
        <form className="stack-sm" onSubmit={(e) => void review(e)}>
          <h3 style={{ margin: 0 }}>Mark reviewed</h3>
          <Field label="Review note" hint="Required. Saved in the audit log.">{(p) => <input {...p} required minLength={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <div><Button type="submit" variant="primary" busy={busy === 'review'}>Mark reviewed</Button></div>
        </form>
      )}
      <form className="stack-sm" onSubmit={(e) => void edit(e)}>
        <h3 style={{ margin: 0 }}>Edit times</h3>
        <p className="small muted" style={{ margin: 0 }}>Times are in {tz}. The record gets an override badge and the change is audited.</p>
        <div className="form-grid">
          <Field label="Check-in">{(p) => <input {...p} type="datetime-local" required value={inAt} onChange={(e) => setInAt(e.target.value)} />}</Field>
          <Field label="Check-out">{(p) => <input {...p} type="datetime-local" value={outAt} onChange={(e) => setOutAt(e.target.value)} />}</Field>
        </div>
        <Field label="Reason" hint="Required, at least 5 characters.">{(p) => <input {...p} required minLength={5} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <div><Button type="submit" busy={busy === 'edit'}>Save new times</Button></div>
      </form>
    </div>
  );
}

function OverrideForm({ tz, employees, sites, onDone }: { tz: string; employees: Employee[]; sites: Site[]; onDone: () => void }) {
  const [userId, setUserId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [kind, setKind] = useState('attendance');
  const [ref, setRef] = useState('');
  const [inAt, setInAt] = useState('');
  const [outAt, setOutAt] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      await api(`${A}/checkins/override`, { method: 'POST', body: { userId, siteId, kind, subjectRef: ref || null, checkInAt: zonedInputToIso(inAt, tz), ...(outAt ? { checkOutAt: zonedInputToIso(outAt, tz) } : {}), reason } });
      onDone();
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <p className="small muted" style={{ margin: 0 }}>Overrides are audited and shown with an override badge. Times are in {tz}.</p>
      {err && <Alert kind="bad">{err}</Alert>}
      <div className="form-grid">
        <Field label="Employee">{(p) => <select {...p} required value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Choose…</option>{employees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}</Field>
        <Field label="Site">{(p) => <select {...p} required value={siteId} onChange={(e) => setSiteId(e.target.value)}><option value="">Choose…</option>{sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}</Field>
        <Field label="Kind">{(p) => <select {...p} value={kind} onChange={(e) => setKind(e.target.value)}>{KIND_LIST.map((k) => <option key={k}>{k}</option>)}</select>}</Field>
        <Field label="Reference (optional)" hint="For example a visitor name or event.">{(p) => <input {...p} maxLength={80} value={ref} onChange={(e) => setRef(e.target.value)} />}</Field>
        <Field label="Check-in">{(p) => <input {...p} type="datetime-local" required value={inAt} onChange={(e) => setInAt(e.target.value)} />}</Field>
        <Field label="Check-out (optional)">{(p) => <input {...p} type="datetime-local" value={outAt} onChange={(e) => setOutAt(e.target.value)} />}</Field>
      </div>
      <Field label="Reason" hint="Required, at least 5 characters.">{(p) => <input {...p} required minLength={5} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      <div className="row between"><Button onClick={onDone}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Create record</Button></div>
    </form>
  );
}

export default function Records() {
  const tz = useOrgTz();
  const [sp, setSp] = useSearchParams();
  const f = Object.fromEntries(FILTERS.map((k) => [k, sp.get(k) ?? ''])) as Record<(typeof FILTERS)[number], string>;
  const offset = Math.max(0, Number(sp.get('offset')) || 0);
  const set = (k: string, v: string) => setSp((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); if (k !== 'offset') n.delete('offset'); return n; }, { replace: true });

  const list = useLoad<{ items: Rec[]; total: number }>(`${A}/checkins${qs({ ...f, limit: PAGE, offset })}`);
  const emps = useLoad<{ items: Employee[] }>(`${A}/employees`);
  const sites = useLoad<{ items: Site[] }>(`${A}/sites`);
  const [sel, setSel] = useState<Rec | null>(null);
  const [creating, setCreating] = useState(false);
  const [coords, setCoords] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const total = list.data?.total ?? 0;
  const exportHref = `${A}/checkins/export.csv${qs({ ...f, coords: coords ? '1' : '' })}`;

  return (
    <Page title="Records" actions={<Button variant="primary" onClick={() => { setMsg(null); setCreating(true); }}>Create manual record (override)</Button>}>
      {msg && <Alert kind="ok">{msg}</Alert>}
      <form className="card form-grid" role="search" aria-label="Filter records" onSubmit={(e) => e.preventDefault()}>
        <Field label="From">{(p) => <input {...p} type="date" value={f.from} onChange={(e) => set('from', e.target.value)} />}</Field>
        <Field label="To">{(p) => <input {...p} type="date" value={f.to} onChange={(e) => set('to', e.target.value)} />}</Field>
        <Field label="Site">{(p) => <select {...p} value={f.siteId} onChange={(e) => set('siteId', e.target.value)}><option value="">All sites</option>{sites.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}</Field>
        <Field label="Employee">{(p) => <select {...p} value={f.userId} onChange={(e) => set('userId', e.target.value)}><option value="">Everyone</option>{emps.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}</Field>
        <Field label="Kind">{(p) => <select {...p} value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="">All kinds</option>{KIND_LIST.map((k) => <option key={k}>{k}</option>)}</select>}</Field>
        <Field label="Review status">{(p) => <select {...p} value={f.review} onChange={(e) => set('review', e.target.value)}><option value="">Any</option><option value="pending">Pending review</option><option value="reviewed">Reviewed</option><option value="none">No review needed</option></select>}</Field>
        <label className="check" style={{ alignSelf: 'end', minHeight: 44 }}><input type="checkbox" checked={f.flagged === '1'} onChange={(e) => set('flagged', e.target.checked ? '1' : '')} /> Flagged only</label>
        <div style={{ alignSelf: 'end' }}><Button onClick={() => setSp({}, { replace: true })}>Clear filters</Button></div>
      </form>

      <div className="card stack-sm">
        <div className="row">
          <a className="btn" href={exportHref} download>Export CSV</a>
          <label className="check"><input type="checkbox" checked={coords} onChange={(e) => setCoords(e.target.checked)} /> Include coordinates</label>
        </div>
        {coords && <Alert kind="warn">Coordinates are sensitive personal data. Exporting them is recorded in the audit log. Only include them when you need them.</Alert>}
        <p className="small muted" style={{ margin: 0 }}>The export uses the filters above (up to 10,000 rows).</p>
      </div>

      <Async loading={list.loading} error={list.error} hasData={!!list.data}>
        {list.data && (list.data.items.length === 0 ? <Empty>No records match these filters.</Empty> : (
          <div className="card flush">
            <div className="table-wrap"><table>
              <caption className="sr-only">Attendance and check-in records</caption>
              <thead><tr><th scope="col">Date</th><th scope="col">Employee</th><th scope="col">Site</th><th scope="col">Kind</th><th scope="col">In</th><th scope="col">Out</th><th scope="col">Worked</th><th scope="col">Late</th><th scope="col">Overtime</th><th scope="col">Distance</th><th scope="col">Flags</th><th scope="col">Review</th><th scope="col">Closed</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{list.data.items.map((r) => (
                <tr key={r.id}>
                  <td>{r.day}</td><td>{r.user_name}</td><td>{r.site_name}</td>
                  <td>{r.kind}{r.subject_ref ? <div className="small muted">{r.subject_ref}</div> : null}</td>
                  <td>{fmtTime(r.check_in_at, tz)}</td><td>{r.check_out_at ? fmtTime(r.check_out_at, tz) : <Badge kind="info">Open</Badge>}</td>
                  <td>{fmtMinutes(r.work_minutes)}</td><td>{r.late_minutes ? `${r.late_minutes} min` : '–'}</td><td>{r.overtime_minutes ? `${r.overtime_minutes} min` : '–'}</td>
                  <td>{fmtDist(r.in_distance_m)}</td>
                  <td><Flags r={r} /></td><td>{reviewBadge(r.review_status)}</td>
                  <td>{r.closed_by === 'auto' ? <Badge kind="warn">Auto</Badge> : r.closed_by === 'admin' ? <Badge kind="info">Admin</Badge> : '–'}</td>
                  <td><Button size="sm" aria-label={`Details for ${r.user_name} on ${r.day}`} onClick={() => { setMsg(null); setSel(r); }}>Details</Button></td>
                </tr>))}</tbody>
            </table></div>
            <div className="row between" style={{ padding: '0.75rem' }}>
              <span className="small muted" aria-live="polite">Showing {offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
              <div className="row">
                <Button disabled={offset === 0} onClick={() => set('offset', offset - PAGE > 0 ? String(offset - PAGE) : '')}>Previous</Button>
                <Button disabled={offset + PAGE >= total} onClick={() => set('offset', String(offset + PAGE))}>Next</Button>
              </div>
            </div>
          </div>
        ))}
      </Async>

      <Modal title="Record details" open={!!sel} onClose={() => setSel(null)}>
        {sel && <>
          <Details rec={sel} tz={tz} onDone={() => { setSel(null); setMsg('Record updated.'); list.reload(); }} />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}><Button onClick={() => setSel(null)}>Close</Button></div>
        </>}
      </Modal>
      <Modal title="Create manual record (override)" open={creating} onClose={() => setCreating(false)}>
        {creating && <OverrideForm tz={tz} employees={emps.data?.items ?? []} sites={sites.data?.items ?? []} onDone={() => { setCreating(false); list.reload(); }} />}
      </Modal>
    </Page>
  );
}
