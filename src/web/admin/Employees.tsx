import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Alert, Badge, Button, Empty, Field, Modal, Page, fmtDateTime } from '../ui';
import { A, Async, errMsg, useLoad, useOrgTz, type Employee, type Shift } from './shared';

type Editing = { mode: 'create' } | { mode: 'edit'; emp: Employee } | null;

function EmployeeForm({ editing, shifts, onClose, onSaved }: { editing: NonNullable<Editing>; shifts: Shift[]; onClose: () => void; onSaved: () => void }) {
  const emp = editing.mode === 'edit' ? editing.emp : null;
  const [email, setEmail] = useState('');
  const [name, setName] = useState(emp?.name ?? '');
  const [role, setRole] = useState<'admin' | 'employee'>(emp?.role ?? 'employee');
  const [active, setActive] = useState(emp?.active ?? true);
  const [shiftId, setShiftId] = useState(emp?.shift_id ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password && password.length < 10) { setErr('Password must be at least 10 characters.'); return; }
    setBusy(true);
    try {
      if (emp) {
        await api(`${A}/employees/${emp.id}`, { method: 'PATCH', body: { name, role, active, shiftId: shiftId || null, ...(password ? { password } : {}) } });
      } else {
        await api(`${A}/employees`, { method: 'POST', body: { email, name, role, shiftId: shiftId || null, password } });
      }
      onSaved();
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      {err && <Alert kind="bad">{err}</Alert>}
      {!emp && <Field label="Email">{(p) => <input {...p} type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>}
      <Field label="Full name">{(p) => <input {...p} required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <div className="form-grid">
        <Field label="Role">{(p) => <select {...p} value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'employee')}><option value="employee">Employee</option><option value="admin">Admin</option></select>}</Field>
        <Field label="Shift">{(p) => <select {...p} value={shiftId} onChange={(e) => setShiftId(e.target.value)}><option value="">No shift</option>{shifts.filter((s) => s.active || s.id === shiftId).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.startTime}-{s.endTime})</option>)}</select>}</Field>
      </div>
      {emp && <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (inactive people cannot sign in)</label>}
      <Field label={emp ? 'New password (optional)' : 'Password'} hint={emp ? 'Leave empty to keep the current password. Changing it signs the person out everywhere.' : 'At least 10 characters. Share it with the person securely.'}>
        {(p) => <input {...p} type="password" autoComplete="new-password" minLength={10} maxLength={200} required={!emp} value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <div className="row between">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={busy}>{emp ? 'Save changes' : 'Create person'}</Button>
      </div>
    </form>
  );
}

export default function Employees() {
  const tz = useOrgTz();
  const list = useLoad<{ items: Employee[] }>(`${A}/employees`);
  const shifts = useLoad<{ items: Shift[] }>(`${A}/shifts`);
  const [editing, setEditing] = useState<Editing>(null);
  const [saved, setSaved] = useState(false);

  return (
    <Page title="People" actions={<Button variant="primary" onClick={() => { setSaved(false); setEditing({ mode: 'create' }); }}>Add person</Button>}>
      <p className="muted small" style={{ margin: 0 }}>The alias is what the AI assistant shows instead of the name.</p>
      {saved && <Alert kind="ok">Saved.</Alert>}
      <Async loading={list.loading} error={list.error} hasData={!!list.data}>
        {list.data && (list.data.items.length === 0 ? <Empty>No people yet.</Empty> : (
          <div className="card flush table-wrap"><table>
            <caption className="sr-only">People</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Alias</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Shift</th><th scope="col">Status</th><th scope="col">Location consent</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{list.data.items.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td><td className="mono">{e.alias}</td><td>{e.email}</td>
                <td>{e.role === 'admin' ? <Badge kind="info">Admin</Badge> : 'Employee'}</td>
                <td>{e.shift_name ?? '–'}</td>
                <td><Badge kind={e.active ? 'ok' : ''}>{e.active ? 'Active' : 'Inactive'}</Badge></td>
                <td>{e.location_consent_at ? <span>Given {fmtDateTime(e.location_consent_at, tz)}</span> : <Badge kind="warn">Not given</Badge>}</td>
                <td><Button size="sm" onClick={() => { setSaved(false); setEditing({ mode: 'edit', emp: e }); }} aria-label={`Edit ${e.name}`}>Edit</Button></td>
              </tr>))}</tbody>
          </table></div>
        ))}
      </Async>
      <Modal title={editing?.mode === 'edit' ? 'Edit person' : 'Add person'} open={!!editing} onClose={() => setEditing(null)}>
        {editing && <EmployeeForm editing={editing} shifts={shifts.data?.items ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setSaved(true); list.reload(); }} />}
      </Modal>
    </Page>
  );
}
