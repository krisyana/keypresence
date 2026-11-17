import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { isoToZonedInput, zonedInputToIso } from '../tz';
import { Alert, Badge, Button, Card, Empty, Field, Icon, Modal, Page, flagLabel, fmtDateTime, fmtMinutes, fmtTime, useToast } from '../ui';
import { A, Async, Confirm, PersonCell, Segmented, errMsg, fieldErrors, KIND_LIST, fmtDist, useLoad, useOrgTz, type Employee, type Site } from './shared';

interface Rec {
  id: string; user_id: string; user_name: string; user_email: string; site_name: string; kind: string; subject_ref: string | null; day: string; status: string;
  check_in_at: string; check_out_at: string | null; in_distance_m: number | null; out_distance_m: number | null; in_accuracy_m: number | null; out_accuracy_m: number | null;
  in_flags: string[]; out_flags: string[]; review_status: 'pending' | 'reviewed' | 'none'; review_note: string | null; closed_by: string | null;
  late_minutes: number | null; overtime_minutes: number | null; work_minutes: number | null; override_reason: string | null;
}
const PAGE = 50;
const FILTERS = ['from', 'to', 'siteId', 'userId', 'kind', 'flagged', 'review'] as const;

function reviewBadge(r: Rec['review_status']) {
  return r === 'pending' ? <Badge dot kind="warn">Review pending</Badge> : r === 'reviewed' ? <Badge dot kind="ok">Reviewed</Badge> : <span className="muted">–<span className="sr-only">No review needed</span></span>;
}
const flagKind = (f: string) => (f === 'ADMIN_OVERRIDE' ? 'info' : 'warn') as 'info' | 'warn';
function Flags({ r }: { r: Rec }) {
  const all = [...new Set([...r.in_flags, ...r.out_flags])].filter((f) => f !== 'ADMIN_OVERRIDE');
  if (!all.length) return null;
  const rest = all.slice(2);
  return <>{all.slice(0, 2).map((f) => <Badge key={f} kind={flagKind(f)}>{flagLabel(f)}</Badge>)}{rest.length > 0 && <Badge kind="" ><span title={rest.map(flagLabel).join(', ')}>+{rest.length}<span className="sr-only"> more: {rest.map(flagLabel).join(', ')}</span></span></Badge>}</>;
}
const isOverride = (r: Rec) => !!r.override_reason || r.in_flags.includes('ADMIN_OVERRIDE') || r.out_flags.includes('ADMIN_OVERRIDE');
const flagBadges = (fl: string[]) => (fl.length ? <div className="badges">{fl.map((f) => <Badge key={f} kind={flagKind(f)}>{flagLabel(f)}</Badge>)}</div> : <span className="muted">None</span>);

function Details({ rec, tz, onDone }: { rec: Rec; tz: string; onDone: (msg: string) => void }) {
  const [note, setNote] = useState('');
  const [inAt, setInAt] = useState(isoToZonedInput(rec.check_in_at, tz));
  const [outAt, setOutAt] = useState(rec.check_out_at ? isoToZonedInput(rec.check_out_at, tz) : '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'review' | 'edit' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const who = `${rec.user_name} on ${rec.day}`;
  const fail = (x: unknown) => { const f = fieldErrors(x); setFe(f); setErr(Object.keys(f).length ? null : errMsg(x)); };

  async function review(e: FormEvent) {
    e.preventDefault(); setBusy('review'); setErr(null); setFe({});
    try { await api(`${A}/checkins/${rec.id}/review`, { method: 'PATCH', body: { note } }); onDone(`Record for ${who} marked reviewed`); } catch (x) { fail(x); } finally { setBusy(null); }
  }
  function askEdit(e: FormEvent) {
    e.preventDefault(); setErr(null); setFe({});
    if (inAt === isoToZonedInput(rec.check_in_at, tz) && outAt === (rec.check_out_at ? isoToZonedInput(rec.check_out_at, tz) : '')) { setFe({ checkInAt: 'Change the check-in or check-out time first.' }); return; }
    setConfirm(true);
  }
  async function edit() {
    const body: Record<string, string> = { reason };
    if (inAt !== isoToZonedInput(rec.check_in_at, tz)) body.checkInAt = zonedInputToIso(inAt, tz);
    if (outAt && outAt !== (rec.check_out_at ? isoToZonedInput(rec.check_out_at, tz) : '')) body.checkOutAt = zonedInputToIso(outAt, tz);
    setBusy('edit');
    try { await api(`${A}/checkins/${rec.id}`, { method: 'PATCH', body }); setConfirm(false); onDone(`Times for ${who} overridden`); } catch (x) { setConfirm(false); fail(x); } finally { setBusy(null); }
  }

  return (
    <div className="stack">
      {err && <Alert kind="bad">{err}</Alert>}
      <section className="sect" aria-label="Who and where">
        <h3>Who and where</h3>
        <dl className="kv">
          <dt>Employee</dt><dd>{rec.user_name} <span className="muted small" style={{ fontWeight: 400 }}>{rec.user_email}</span></dd>
          <dt>Site</dt><dd>{rec.site_name}</dd>
          <dt>Kind</dt><dd>{rec.kind}{rec.subject_ref ? `: ${rec.subject_ref}` : ''}</dd>
        </dl>
      </section>
      <section className="sect" aria-label="Times">
        <h3>Times</h3>
        <dl className="kv">
          <dt>Check-in</dt><dd>{fmtDateTime(rec.check_in_at, tz)} <span className="muted small" style={{ fontWeight: 400 }}>{fmtDist(rec.in_distance_m)} from site, ±{fmtDist(rec.in_accuracy_m)}</span></dd>
          <dt>Check-out</dt><dd>{rec.check_out_at ? <>{fmtDateTime(rec.check_out_at, tz)} <span className="muted small" style={{ fontWeight: 400 }}>{fmtDist(rec.out_distance_m)} from site, ±{fmtDist(rec.out_accuracy_m)}</span></> : <Badge kind="info">Still open</Badge>}</dd>
          <dt>Worked</dt><dd>{fmtMinutes(rec.work_minutes)}</dd>
          <dt>Late</dt><dd>{rec.late_minutes ?? 0} min</dd>
          <dt>Overtime</dt><dd>{rec.overtime_minutes ?? 0} min</dd>
          <dt>Closed by</dt><dd>{rec.closed_by === 'auto' ? 'Automatically' : rec.closed_by === 'admin' ? 'Admin' : rec.closed_by ?? '–'}</dd>
        </dl>
      </section>
      <section className="sect" aria-label="Flags and review">
        <h3>Flags and review</h3>
        <dl className="kv">
          <dt>Check-in flags</dt><dd>{flagBadges(rec.in_flags)}</dd>
          <dt>Check-out flags</dt><dd>{flagBadges(rec.out_flags)}</dd>
          <dt>Review</dt><dd>{reviewBadge(rec.review_status)}{rec.review_note && <div className="small" style={{ fontWeight: 400 }}>{rec.review_note}</div>}</dd>
          {rec.override_reason && <><dt>Override reason</dt><dd style={{ fontWeight: 400 }}>{rec.override_reason}</dd></>}
        </dl>
      </section>
      {rec.review_status === 'pending' && (
        <form className="sect" onSubmit={(e) => void review(e)} aria-label="Mark reviewed">
          <h3>Mark reviewed</h3>
          <Field label="Review note" hint="Saved in the audit log." error={fe.note}>{(p) => <input {...p} required minLength={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <div><Button type="submit" variant="primary" busy={busy === 'review'}><Icon name="check" size={16} />Mark reviewed</Button></div>
        </form>
      )}
      <form className="sect" onSubmit={askEdit} aria-label="Edit times">
        <h3>Edit times (override)</h3>
        <div className="form-grid">
          <Field label="Check-in" hint={`Times in ${tz}.`} error={fe.checkInAt}>{(p) => <input {...p} type="datetime-local" required value={inAt} onChange={(e) => setInAt(e.target.value)} />}</Field>
          <Field label="Check-out" error={fe.checkOutAt}>{(p) => <input {...p} type="datetime-local" value={outAt} onChange={(e) => setOutAt(e.target.value)} />}</Field>
        </div>
        <Field label="Reason" error={fe.reason}>{(p) => <input {...p} required minLength={5} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <div><Button type="submit">Save new times</Button></div>
      </form>
      <Confirm open={confirm} busy={busy === 'edit'} title="Override these times?" confirmLabel="Override" onClose={() => setConfirm(false)} onConfirm={() => void edit()}>
        The record gets an override badge and the change is written to the audit log.
      </Confirm>
    </div>
  );
}

function OverrideForm({ tz, employees, sites, onDone, onClose }: { tz: string; employees: Employee[]; sites: Site[]; onDone: (msg: string) => void; onClose: () => void }) {
  const [userId, setUserId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [kind, setKind] = useState('attendance');
  const [ref, setRef] = useState('');
  const [inAt, setInAt] = useState('');
  const [outAt, setOutAt] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  async function create() {
    setErr(null); setFe({}); setBusy(true);
    try {
      await api(`${A}/checkins/override`, { method: 'POST', body: { userId, siteId, kind, subjectRef: ref || null, checkInAt: zonedInputToIso(inAt, tz), ...(outAt ? { checkOutAt: zonedInputToIso(outAt, tz) } : {}), reason } });
      onDone(`Manual record for ${employees.find((x) => x.id === userId)?.name ?? 'employee'} created`);
    } catch (x) { setConfirm(false); const f = fieldErrors(x); setFe(f); setErr(Object.keys(f).length ? null : errMsg(x)); } finally { setBusy(false); }
  }
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); setConfirm(true); }}>
      {err && <Alert kind="bad">{err}</Alert>}
      <div className="form-grid">
        <Field label="Employee" error={fe.userId}>{(p) => <select {...p} required value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Choose…</option>{employees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}</Field>
        <Field label="Site" error={fe.siteId}>{(p) => <select {...p} required value={siteId} onChange={(e) => setSiteId(e.target.value)}><option value="">Choose…</option>{sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}</Field>
        <Field label="Kind" error={fe.kind}>{(p) => <select {...p} value={kind} onChange={(e) => setKind(e.target.value)}>{KIND_LIST.map((k) => <option key={k}>{k}</option>)}</select>}</Field>
        <Field label="Reference (optional)" error={fe.subjectRef}>{(p) => <input {...p} maxLength={80} value={ref} onChange={(e) => setRef(e.target.value)} />}</Field>
        <Field label="Check-in" hint={`Times in ${tz}.`} error={fe.checkInAt}>{(p) => <input {...p} type="datetime-local" required value={inAt} onChange={(e) => setInAt(e.target.value)} />}</Field>
        <Field label="Check-out (optional)" error={fe.checkOutAt}>{(p) => <input {...p} type="datetime-local" value={outAt} onChange={(e) => setOutAt(e.target.value)} />}</Field>
      </div>
      <Field label="Reason" error={fe.reason}>{(p) => <input {...p} required minLength={5} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      <div className="confirm-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary">Create record</Button></div>
      <Confirm open={confirm} busy={busy} title="Create this manual record?" confirmLabel="Create record" onClose={() => setConfirm(false)} onConfirm={() => void create()}>
        It is shown with an override badge and written to the audit log.
      </Confirm>
    </form>
  );
}

export default function Records() {
  const tz = useOrgTz();
  const toast = useToast();
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

  const total = list.data?.total ?? 0;
  const exportHref = `${A}/checkins/export.csv${qs({ ...f, coords: coords ? '1' : '' })}`;
  const anyFilter = FILTERS.some((k) => f[k]);

  const pending = useLoad<{ total: number }>(`${A}/checkins${qs({ review: 'pending', limit: 1 })}`);
  const view: 'pending' | 'flagged' | 'all' = f.review === 'pending' && !f.flagged ? 'pending' : f.flagged === '1' && !f.review ? 'flagged' : 'all';
  const pickView = (v: 'pending' | 'flagged' | 'all') => setSp((p) => { const n = new URLSearchParams(p); n.delete('review'); n.delete('flagged'); n.delete('offset'); if (v === 'pending') n.set('review', 'pending'); if (v === 'flagged') n.set('flagged', '1'); return n; }, { replace: true });
  const detailFilters = (['from', 'to', 'siteId', 'userId', 'kind'] as const).filter((k) => f[k]).length;
  const dayHead = (day: string) => { const [y, m, d] = day.split('-').map(Number); return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(Date.UTC(y!, m! - 1, d!))); };
  const groups = (list.data?.items ?? []).reduce<{ day: string; rows: Rec[] }[]>((acc, r) => { const g = acc[acc.length - 1]; if (g && g.day === r.day) g.rows.push(r); else acc.push({ day: r.day, rows: [r] }); return acc; }, []);

  return (
    <Page title="Records" subtitle="Check-ins and check-outs across all sites." actions={<>
      <a className="btn" href={exportHref} download onClick={() => toast(coords ? 'Export started. Coordinates export is audited.' : 'Export started', 'info')}><Icon name="download" size={16} />Export CSV</a>
      <Button variant="primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} />Manual record</Button>
    </>}>
      <div className="rec-controls">
        <Segmented label="Show" value={view} onChange={pickView} options={[
          { value: 'all', label: 'All records' },
          { value: 'pending', label: pending.data ? `Needs review (${pending.data.total})` : 'Needs review' },
          { value: 'flagged', label: 'Flagged' },
        ]} />
        <details className="filters-box" open={detailFilters > 0 || coords}>
          <summary>{detailFilters > 0 ? `Filters (${detailFilters})` : 'Filters'}</summary>
          <form role="search" aria-label="Filter records" onSubmit={(e) => e.preventDefault()}>
            <div className="form-grid">
              <Field label="From">{(p) => <input {...p} type="date" value={f.from} onChange={(e) => set('from', e.target.value)} />}</Field>
              <Field label="To">{(p) => <input {...p} type="date" value={f.to} onChange={(e) => set('to', e.target.value)} />}</Field>
              <Field label="Site">{(p) => <select {...p} value={f.siteId} onChange={(e) => set('siteId', e.target.value)}><option value="">All sites</option>{sites.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}</Field>
              <Field label="Employee">{(p) => <select {...p} value={f.userId} onChange={(e) => set('userId', e.target.value)}><option value="">Everyone</option>{emps.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}</Field>
              <Field label="Kind">{(p) => <select {...p} value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="">All kinds</option>{KIND_LIST.map((k) => <option key={k}>{k}</option>)}</select>}</Field>
            </div>
            <div className="row between">
              <label className="check" style={{ minHeight: 44 }}><input type="checkbox" checked={coords} onChange={(e) => setCoords(e.target.checked)} /> Include coordinates in the CSV export</label>
              {anyFilter && <Button variant="ghost" onClick={() => setSp({}, { replace: true })}>Clear all filters</Button>}
            </div>
            {coords && <Alert kind="warn">Coordinates are personal data. This export is recorded in the audit log.</Alert>}
          </form>
        </details>
      </div>

      <Card flush>
        <Async loading={list.loading} error={list.error} hasData={!!list.data}>
          {list.data && (list.data.items.length === 0 ? <Empty icon="list" title="No records found" action={anyFilter ? <Button onClick={() => setSp({}, { replace: true })}>Clear filters</Button> : undefined}>{anyFilter ? 'No records match these filters.' : 'Check-ins will appear here.'}</Empty> : (
            <>
              <div className="table-wrap"><table className="rec-table responsive">
                <caption className="sr-only">Attendance and check-in records, grouped by day</caption>
                <thead><tr><th scope="col">Employee</th><th scope="col">In</th><th scope="col">Out</th><th scope="col">Worked</th><th scope="col">Needs attention</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                {groups.map((g) => (
                  <tbody key={g.day}>
                    <tr className="day-row"><th scope="colgroup" colSpan={6}>{dayHead(g.day)} <span className="muted">{g.rows.length}</span></th></tr>
                    {g.rows.map((r) => (
                      <tr key={r.id}>
                        <td><PersonCell name={r.user_name} sub={r.site_name + (r.kind !== 'attendance' ? `, ${r.kind}${r.subject_ref ? ` ${r.subject_ref}` : ''}` : '')} /></td>
                        <td className="num-cell" data-label="In">{fmtTime(r.check_in_at, tz)}{r.late_minutes ? <span className="cell-sub">{r.late_minutes} min late</span> : null}</td>
                        <td className="num-cell" data-label="Out">{r.check_out_at ? fmtTime(r.check_out_at, tz) : <Badge dot kind="ok">Open</Badge>}</td>
                        <td className="num-cell" data-label="Worked">{fmtMinutes(r.work_minutes)}{r.overtime_minutes ? <span className="cell-sub">+{r.overtime_minutes} min overtime</span> : null}</td>
                        <td><div className="badges">
                          {r.review_status === 'pending' && <Badge dot kind="warn">Needs review</Badge>}
                          <Flags r={r} />
                          {isOverride(r) && <Badge kind="info">Override</Badge>}
                        </div></td>
                        <td><Button size="sm" variant="ghost" aria-label={`Details for ${r.user_name} on ${r.day}`} onClick={() => setSel(r)}>Details<Icon name="chevron" size={14} /></Button></td>
                      </tr>))}
                  </tbody>
                ))}
              </table></div>
              <div className="card-foot">
                <span className="small muted" aria-live="polite">Showing {offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
                <div className="row">
                  <Button size="sm" disabled={offset === 0} onClick={() => set('offset', offset - PAGE > 0 ? String(offset - PAGE) : '')}>Previous</Button>
                  <Button size="sm" disabled={offset + PAGE >= total} onClick={() => set('offset', String(offset + PAGE))}>Next</Button>
                </div>
              </div>
            </>
          ))}
        </Async>
      </Card>

      <Modal title="Record details" open={!!sel} onClose={() => setSel(null)}>
        {sel && <Details rec={sel} tz={tz} onDone={(m) => { setSel(null); toast(m); list.reload(); }} />}
      </Modal>
      <Modal title="Manual record" open={creating} onClose={() => setCreating(false)}>
        {creating && <OverrideForm tz={tz} employees={emps.data?.items ?? []} sites={sites.data?.items ?? []} onClose={() => setCreating(false)} onDone={(m) => { setCreating(false); toast(m); list.reload(); }} />}
      </Modal>
    </Page>
  );
}
