import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Alert, Badge, Button, Card, Empty, Field, Icon, Modal, Page, useToast } from '../ui';
import { A, Async, DAY_NAMES, dayRange, errMsg, fieldErrors, useLoad, type Shift } from './shared';

const num = (v: string) => (v === '' ? NaN : Number(v));

function ShiftForm({ shift, onClose, onSaved }: { shift: Shift | null; onClose: () => void; onSaved: (name: string, created: boolean) => void }) {
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
  const [fe, setFe] = useState<Record<string, string>>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null); setFe({});
    if (days.length === 0) { setErr('Pick at least one work day.'); return; }
    if (end <= start) { setFe({ endTime: 'Must be after the start. Overnight shifts are not supported.' }); return; }
    setBusy(true);
    const body = { name, startTime: start, endTime: end, graceMinutes: num(grace), overtimeAfterMinutes: num(ot), autoCloseAfterMinutes: num(auto), workDays: [...days].sort(), active };
    try {
      await api(shift ? `${A}/shifts/${shift.id}` : `${A}/shifts`, { method: shift ? 'PATCH' : 'POST', body });
      onSaved(name, !shift);
    } catch (x) { const f = fieldErrors(x); setFe(f); setErr(Object.keys(f).length ? null : errMsg(x)); } finally { setBusy(false); }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      {err && <Alert kind="bad">{err}</Alert>}
      <Field label="Name" error={fe.name}>{(p) => <input {...p} required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <div className="form-grid">
        <Field label="Start" error={fe.startTime}>{(p) => <input {...p} type="time" required value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
        <Field label="End" error={fe.endTime}>{(p) => <input {...p} type="time" required value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
        <Field label="Grace (minutes)" hint="Arrivals within this are not late." error={fe.graceMinutes}>{(p) => <input {...p} type="number" min={0} max={120} required value={grace} onChange={(e) => setGrace(e.target.value)} />}</Field>
        <Field label="Overtime after (minutes)" hint="Minutes past the end before overtime counts." error={fe.overtimeAfterMinutes}>{(p) => <input {...p} type="number" min={0} max={240} required value={ot} onChange={(e) => setOt(e.target.value)} />}</Field>
        <Field label="Auto-close after (minutes)" hint="Open records close this long after the shift ends." error={fe.autoCloseAfterMinutes}>{(p) => <input {...p} type="number" min={15} max={720} required value={auto} onChange={(e) => setAuto(e.target.value)} />}</Field>
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
      <div className="confirm-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={busy}>{shift ? 'Save changes' : 'Create shift'}</Button>
      </div>
    </form>
  );
}

export default function Shifts() {
  const toast = useToast();
  const list = useLoad<{ items: Shift[] }>(`${A}/shifts`);
  const [editing, setEditing] = useState<{ shift: Shift | null } | null>(null);
  return (
    <Page title="Shifts" subtitle="Working hours that decide who is late or on overtime." actions={<Button variant="primary" onClick={() => setEditing({ shift: null })}><Icon name="plus" size={16} />Add shift</Button>}>
      <Async loading={list.loading} error={list.error} hasData={!!list.data}>
        {list.data && (list.data.items.length === 0 ? (
          <Card><Empty icon="clock" title="No shifts yet" action={<Button variant="primary" onClick={() => setEditing({ shift: null })}>Add shift</Button>}>Add a shift, then assign people to it.</Empty></Card>
        ) : (
          <Card flush>
            <div className="table-wrap"><table className="responsive">
              <caption className="sr-only">Shifts</caption>
              <thead><tr><th scope="col">Shift</th><th scope="col">When</th><th scope="col">Rules</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{list.data.items.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong>{!s.active && <> <Badge kind="">Inactive</Badge></>}</td>
                  <td className="num-cell">{s.startTime} to {s.endTime}<span className="cell-sub">{dayRange(s.workDays)}</span></td>
                  <td className="wrap">Late after {s.graceMinutes} min grace.<span className="cell-sub">Overtime counts {s.overtimeAfterMinutes} min after the end. Open records close {s.autoCloseAfterMinutes} min after the end.</span></td>
                  <td><Button size="sm" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => setEditing({ shift: s })}>Edit<Icon name="chevron" size={14} /></Button></td>
                </tr>))}</tbody>
            </table></div>
          </Card>
        ))}
      </Async>
      <Modal title={editing?.shift ? 'Edit shift' : 'Add shift'} open={!!editing} onClose={() => setEditing(null)}>
        {editing && <ShiftForm shift={editing.shift} onClose={() => setEditing(null)} onSaved={(n, created) => { setEditing(null); toast(created ? `Shift "${n}" created` : `Shift "${n}" saved`); list.reload(); }} />}
      </Modal>
    </Page>
  );
}
