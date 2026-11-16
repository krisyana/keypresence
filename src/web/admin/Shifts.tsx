import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Alert, Badge, Button, Empty, Field, Modal, Page } from '../ui';
import { A, Async, DAY_NAMES, errMsg, useLoad, type Shift } from './shared';

const num = (v: string) => (v === '' ? NaN : Number(v));

function ShiftForm({ shift, onClose, onSaved }: { shift: Shift | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(shift?.name ?? '');
  const [start, setStart] = useState(shift?.startTime ?? '09:00');
  const [end, setEnd] = useState(shift?.endTime ?? '17:00');
  const [grace, setGrace] = useState(String(shift?.graceMinutes ?? 10));
  const [ot, setOt] = useState(String(shift?.overtimeAfterMinutes ?? 15));
  const [auto, setAuto] = useState(String(shift?.autoCloseAfterMinutes ?? 120));
  const [days, setDays] = useState<number[]>(shift?.workDays ?? [1, 2, 3, 4, 5]);
  const [active, setActive] = useState(shift?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (days.length === 0) { setErr('Pick at least one work day.'); return; }
    if (end <= start) { setErr('End time must be after start time. Overnight shifts are not supported.'); return; }
    setBusy(true);
    const body = { name, startTime: start, endTime: end, graceMinutes: num(grace), overtimeAfterMinutes: num(ot), autoCloseAfterMinutes: num(auto), workDays: [...days].sort(), active };
    try {
      await api(shift ? `${A}/shifts/${shift.id}` : `${A}/shifts`, { method: shift ? 'PATCH' : 'POST', body });
      onSaved();
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      {err && <Alert kind="bad">{err}</Alert>}
      <Field label="Name">{(p) => <input {...p} required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <div className="form-grid">
        <Field label="Start (HH:MM)">{(p) => <input {...p} type="time" required value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
        <Field label="End (HH:MM)" hint="Overnight shifts (ending after midnight) are not supported yet.">{(p) => <input {...p} type="time" required value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
        <Field label="Grace minutes" hint="Arrivals within this time of the start are not late.">{(p) => <input {...p} type="number" min={0} max={120} required value={grace} onChange={(e) => setGrace(e.target.value)} />}</Field>
        <Field label="Overtime after (minutes)" hint="Minutes worked past the end before overtime counts.">{(p) => <input {...p} type="number" min={0} max={240} required value={ot} onChange={(e) => setOt(e.target.value)} />}</Field>
        <Field label="Auto-close after (minutes)" hint="Open records are closed automatically this long after the shift end (15-720).">{(p) => <input {...p} type="number" min={15} max={720} required value={auto} onChange={(e) => setAuto(e.target.value)} />}</Field>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.3rem' }}>Work days</legend>
        <div className="row">
          {DAY_NAMES.map((d, i) => (
            <label key={d} className="check" style={{ minHeight: 44 }}>
              <input type="checkbox" checked={days.includes(i + 1)} onChange={(e) => setDays(e.target.checked ? [...days, i + 1] : days.filter((x) => x !== i + 1))} /> {d}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
      <div className="row between">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={busy}>{shift ? 'Save changes' : 'Create shift'}</Button>
      </div>
    </form>
  );
}

export default function Shifts() {
  const list = useLoad<{ items: Shift[] }>(`${A}/shifts`);
  const [editing, setEditing] = useState<{ shift: Shift | null } | null>(null);
  const [saved, setSaved] = useState(false);
  return (
    <Page title="Shifts" actions={<Button variant="primary" onClick={() => { setSaved(false); setEditing({ shift: null }); }}>Add shift</Button>}>
      {saved && <Alert kind="ok">Saved.</Alert>}
      <Async loading={list.loading} error={list.error} hasData={!!list.data}>
        {list.data && (list.data.items.length === 0 ? <Empty>No shifts yet. Add one, then assign people to it.</Empty> : (
          <div className="card flush table-wrap"><table>
            <caption className="sr-only">Shifts</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Hours</th><th scope="col">Grace</th><th scope="col">Overtime after</th><th scope="col">Auto-close after</th><th scope="col">Work days</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{list.data.items.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td><td>{s.startTime}–{s.endTime}</td><td>{s.graceMinutes} min</td><td>{s.overtimeAfterMinutes} min</td><td>{s.autoCloseAfterMinutes} min</td>
                <td>{s.workDays.map((d) => DAY_NAMES[d - 1]).join(', ')}</td>
                <td><Badge kind={s.active ? 'ok' : ''}>{s.active ? 'Active' : 'Inactive'}</Badge></td>
                <td><Button size="sm" aria-label={`Edit ${s.name}`} onClick={() => { setSaved(false); setEditing({ shift: s }); }}>Edit</Button></td>
              </tr>))}</tbody>
          </table></div>
        ))}
      </Async>
      <Modal title={editing?.shift ? 'Edit shift' : 'Add shift'} open={!!editing} onClose={() => setEditing(null)}>
        {editing && <ShiftForm shift={editing.shift} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setSaved(true); list.reload(); }} />}
      </Modal>
    </Page>
  );
}
