import { useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Badge, Button, Card, Empty, Field, Icon, Modal, Page, Alert, fmtDateTime, useToast } from '../ui';
import { A, Async, PersonCell, Segmented, errMsg, fieldErrors, useLoad, useOrgTz, type Employee, type Shift } from './shared';

type Editing = { mode: 'create' } | { mode: 'edit'; emp: Employee } | null;

function EmployeeForm({ editing, shifts, onClose, onSaved }: { editing: NonNullable<Editing>; shifts: Shift[]; onClose: () => void; onSaved: (name: string, created: boolean) => void }) {
  const emp = editing.mode === 'edit' ? editing.emp : null;
  const [email, setEmail] = useState('');
  const [name, setName] = useState(emp?.name ?? '');
  const [role, setRole] = useState<'admin' | 'employee'>(emp?.role ?? 'employee');
  const [active, setActive] = useState(emp?.active ?? true);
  const [shiftId, setShiftId] = useState(emp?.shift_id ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null); setFe({});
    if (password && password.length < 10) { setFe({ password: 'Use at least 10 characters.' }); return; }
    setBusy(true);
    try {
      if (emp) {
        await api(`${A}/employees/${emp.id}`, { method: 'PATCH', body: { name, role, active, shiftId: shiftId || null, ...(password ? { password } : {}) } });
      } else {
        await api(`${A}/employees`, { method: 'POST', body: { email, name, role, shiftId: shiftId || null, password } });
      }
      onSaved(name, !emp);
    } catch (x) { const f = fieldErrors(x); setFe(f); setErr(Object.keys(f).length ? null : errMsg(x)); } finally { setBusy(false); }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      {err && <Alert kind="bad">{err}</Alert>}
      {!emp && <Field label="Email" error={fe.email}>{(p) => <input {...p} type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>}
      <Field label="Full name" error={fe.name}>{(p) => <input {...p} required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <div className="form-grid">
        <Field label="Role" error={fe.role}>{(p) => <select {...p} value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'employee')}><option value="employee">Employee</option><option value="admin">Admin</option></select>}</Field>
        <Field label="Shift" error={fe.shiftId}>{(p) => <select {...p} value={shiftId} onChange={(e) => setShiftId(e.target.value)}><option value="">No shift</option>{shifts.filter((s) => s.active || s.id === shiftId).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.startTime}-{s.endTime})</option>)}</select>}</Field>
      </div>
      {emp && <p className="small muted">Shown to the AI assistant as <span className="mono">{emp.alias}</span>. Consent {emp.location_consent_at ? 'given' : 'not given yet'}.</p>}
      {emp && <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>}
      <Field label={emp ? 'New password' : 'Password'} hint={emp ? 'Optional. Changing it signs the person out everywhere.' : 'At least 10 characters.'} error={fe.password}>
        {(p) => <input {...p} type="password" autoComplete="new-password" minLength={10} maxLength={200} required={!emp} value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <div className="confirm-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={busy}>{emp ? 'Save changes' : 'Create person'}</Button>
      </div>
    </form>
  );
}

export default function Employees() {
  const tz = useOrgTz();
  const toast = useToast();
  const list = useLoad<{ items: Employee[] }>(`${A}/employees`);
  const shifts = useLoad<{ items: Shift[] }>(`${A}/shifts`);
  const [editing, setEditing] = useState<Editing>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data?.items ?? []).filter((e) => (!q || e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q)) && (!status || (status === 'active') === e.active));
  }, [list.data, search, status]);

  const all = list.data?.items ?? [];
  const noConsent = all.filter((e) => e.active && e.role === 'employee' && !e.location_consent_at).length;
  const subtitle = all.length === 0 ? 'Everyone who can check in, and their shifts.' : `${all.filter((e) => e.active).length} active of ${all.length}. ${noConsent === 0 ? 'Everyone has agreed to location use.' : `${noConsent} ${noConsent === 1 ? 'has' : 'have'} not agreed to location use yet.`}`;

  return (
    <Page title="People" subtitle={subtitle} actions={<Button variant="primary" onClick={() => setEditing({ mode: 'create' })}><Icon name="plus" size={16} />Add person</Button>}>
      <Async loading={list.loading} error={list.error} hasData={!!list.data}>
        {list.data && (list.data.items.length === 0 ? (
          <Card><Empty icon="users" title="No people yet" action={<Button variant="primary" onClick={() => setEditing({ mode: 'create' })}>Add person</Button>}>Add your team so they can check in.</Empty></Card>
        ) : (
          <>
            <div className="list-controls" role="search" aria-label="Filter people">
              <Field label="Search">{(p) => <input {...p} type="search" placeholder="Name or email" value={search} onChange={(e) => setSearch(e.target.value)} />}</Field>
              <Segmented label="Status" value={status as '' | 'active' | 'inactive'} onChange={setStatus} options={[{ value: '', label: 'Everyone' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
            </div>
            <Card flush>
              {rows.length === 0 ? <Empty icon="users" title="No matches">Try a different search.</Empty> : (
                <div className="table-wrap"><table className="responsive">
                  <caption className="sr-only">People</caption>
                  <thead><tr><th scope="col">Person</th><th scope="col">Shift</th><th scope="col">Needs attention</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>{rows.map((e) => (
                    <tr key={e.id}>
                      <td><PersonCell name={e.name} sub={e.email} /></td>
                      <td>{e.shift_name ?? <span className="muted">No shift</span>}</td>
                      <td><div className="badges">
                        {e.role === 'admin' && <Badge kind="info">Admin</Badge>}
                        {!e.active && <Badge kind="">Inactive</Badge>}
                        {e.active && e.role === 'employee' && !e.location_consent_at && <Badge dot kind="warn">No location consent</Badge>}
                      </div></td>
                      <td><Button size="sm" variant="ghost" onClick={() => setEditing({ mode: 'edit', emp: e })} aria-label={`Edit ${e.name}`}>Edit<Icon name="chevron" size={14} /></Button></td>
                    </tr>))}</tbody>
                </table></div>
              )}
            </Card>
          </>
        ))}
      </Async>
      <Modal title={editing?.mode === 'edit' ? 'Edit person' : 'Add person'} open={!!editing} onClose={() => setEditing(null)}>
        {editing && <EmployeeForm editing={editing} shifts={shifts.data?.items ?? []} onClose={() => setEditing(null)} onSaved={(n, created) => { setEditing(null); toast(created ? `Person "${n}" created` : `Changes to "${n}" saved`); list.reload(); }} />}
      </Modal>
    </Page>
  );
}
