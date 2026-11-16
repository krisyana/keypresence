import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Alert, Button, Field, Page } from '../ui';
import { A, Async, errMsg, useLoad } from './shared';

type S = { timezone: string; impossible_speed_kmh: number; spoofing_action: 'flag' | 'reject'; stale_fix_seconds: number; qr_grace_minutes: number; coord_retention_days: number; daily_summary_hour: number; missing_checkin_reminder_minutes: number; checkout_reminder_minutes: number };

const NUMS: { key: keyof S; label: string; min: number; max: number; step?: number; hint: string }[] = [
  { key: 'impossible_speed_kmh', label: 'Impossible travel speed (km/h)', min: 20, max: 1000, hint: 'If someone appears to move faster than this between two check-ins, the second one is flagged. 200 is a sensible default for cars and trains.' },
  { key: 'stale_fix_seconds', label: 'Stale location after (seconds)', min: 5, max: 300, hint: 'A location reading older than this when sent is considered stale and may be flagged or rejected.' },
  { key: 'qr_grace_minutes', label: 'QR grace after midnight (minutes)', min: 0, max: 60, hint: 'Yesterday’s code still works for this long after the day changes, so late-night shifts are not locked out.' },
  { key: 'coord_retention_days', label: 'Keep exact coordinates for (days)', min: 1, max: 3650, hint: 'After this many days exact coordinates are removed from records; times, distances and flags stay.' },
  { key: 'daily_summary_hour', label: 'Daily summary hour (0-23)', min: 0, max: 23, hint: 'Local hour when the daily summary is sent to admins.' },
  { key: 'missing_checkin_reminder_minutes', label: 'Missing check-in reminder (minutes)', min: 0, max: 240, hint: 'Remind someone this long after their shift started if they have not checked in. 0 turns it off.' },
  { key: 'checkout_reminder_minutes', label: 'Check-out reminder (minutes)', min: 0, max: 240, hint: 'Remind someone this long after their shift ended if they are still checked in. 0 turns it off.' },
];

export default function Settings() {
  const cur = useLoad<S>(`${A}/settings`);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [saved, setSaved] = useState<S | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (cur.data) { setSaved(cur.data); setForm(Object.fromEntries(Object.entries(cur.data).map(([k, v]) => [k, String(v)]))); }
  }, [cur.data]);

  const zones = useMemo(() => {
    try { return (Intl as any).supportedValuesOf('timeZone') as string[]; } catch { return null; }
  }, []);

  const set = (k: string, v: string) => { setOk(false); setForm((f) => ({ ...f!, [k]: v })); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form || !saved) return;
    setErr(null); setOk(false);
    const patch: Record<string, unknown> = {};
    for (const [k, raw] of Object.entries(form)) {
      const old = String((saved as any)[k]);
      if (raw === old) continue;
      patch[k] = typeof (saved as any)[k] === 'number' ? Number(raw) : raw;
    }
    if (!Object.keys(patch).length) { setErr('Nothing changed.'); return; }
    setBusy(true);
    try {
      const after = await api<S>(`${A}/settings`, { method: 'PUT', body: patch });
      setSaved(after); setForm(Object.fromEntries(Object.entries(after).map(([k, v]) => [k, String(v)]))); setOk(true);
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }

  return (
    <Page title="Settings">
      <Async loading={cur.loading} error={cur.error} hasData={!!form}>
        {form && (
          <form className="stack" onSubmit={(e) => void submit(e)}>
            {ok && <Alert kind="ok">Settings saved.</Alert>}
            {err && <Alert kind="bad">{err}</Alert>}
            <section className="card stack" aria-labelledby="g-time">
              <h2 id="g-time" style={{ margin: 0 }}>Organisation</h2>
              <Field label="Timezone" hint="All days, shifts and reports use this timezone.">
                {(p) => zones
                  ? <select {...p} value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>{(zones.includes(form.timezone) ? zones : [form.timezone, ...zones]).map((z) => <option key={z}>{z}</option>)}</select>
                  : <input {...p} value={form.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="Asia/Jakarta" />}
              </Field>
            </section>
            <section className="card stack" aria-labelledby="g-loc">
              <h2 id="g-loc" style={{ margin: 0 }}>Location checks and anti-spoofing</h2>
              <Field label="When spoofing is suspected" hint="Flag keeps the record but marks it for review. Reject refuses the check-in.">
                {(p) => <select {...p} value={form.spoofing_action} onChange={(e) => set('spoofing_action', e.target.value)}><option value="flag">Accept but flag for review</option><option value="reject">Reject the check-in</option></select>}
              </Field>
              {NUMS.slice(0, 3).map((n) => <NumField key={n.key} n={n} v={form[n.key]!} set={set} />)}
            </section>
            <section className="card stack" aria-labelledby="g-priv">
              <h2 id="g-priv" style={{ margin: 0 }}>Privacy</h2>
              <NumField n={NUMS[3]!} v={form.coord_retention_days!} set={set} />
              <div className="alert">
                <strong>What these mean.</strong> Exact GPS coordinates are personal data. They are only needed to verify a check-in, so they are deleted after the retention period. Everything you need for attendance, such as times, distance from the site and flags, is kept. A shorter period is more private; a longer one helps investigations.
              </div>
            </section>
            <section className="card stack" aria-labelledby="g-rem">
              <h2 id="g-rem" style={{ margin: 0 }}>Reminders and summaries</h2>
              {NUMS.slice(4).map((n) => <NumField key={n.key} n={n} v={form[n.key]!} set={set} />)}
            </section>
            <div><Button type="submit" variant="primary" busy={busy}>Save settings</Button></div>
          </form>
        )}
      </Async>
    </Page>
  );
}

function NumField({ n, v, set }: { n: (typeof NUMS)[number]; v: string; set: (k: string, v: string) => void }) {
  return <Field label={n.label} hint={n.hint}>{(p) => <input {...p} type="number" inputMode="numeric" min={n.min} max={n.max} step={n.step ?? 'any'} required value={v} onChange={(e) => set(n.key, e.target.value)} />}</Field>;
}
