import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import { Alert, Button, Card, Field, Icon, Page, useToast, type IconName } from '../ui';
import { A, Async, Info, errMsg, fieldErrors, useLoad } from './shared';

type S = { timezone: string; impossible_speed_kmh: number; spoofing_action: 'flag' | 'reject'; stale_fix_seconds: number; qr_grace_minutes: number; coord_retention_days: number; daily_summary_hour: number; missing_checkin_reminder_minutes: number; checkout_reminder_minutes: number };

const NUMS: Record<string, { label: string; min: number; max: number; hint?: string }> = {
  impossible_speed_kmh: { label: 'Impossible travel speed (km/h)', min: 20, max: 1000, hint: 'Faster movement between two check-ins is flagged.' },
  stale_fix_seconds: { label: 'Stale location after (seconds)', min: 5, max: 300 },
  qr_grace_minutes: { label: 'QR grace after midnight (minutes)', min: 0, max: 60, hint: 'Yesterday’s code keeps working this long.' },
  coord_retention_days: { label: 'Keep exact coordinates for (days)', min: 1, max: 3650 },
  daily_summary_hour: { label: 'Daily summary hour (0-23)', min: 0, max: 23 },
  missing_checkin_reminder_minutes: { label: 'Missing check-in reminder (minutes)', min: 0, max: 240, hint: '0 turns it off.' },
  checkout_reminder_minutes: { label: 'Check-out reminder (minutes)', min: 0, max: 240, hint: '0 turns it off.' },
};

const toForm = (s: S) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v)])) as Record<string, string>;

function Section({ title, blurb, children }: { title: string; blurb: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="set-section">
      <div className="set-intro"><h2>{title}</h2><p className="muted small">{blurb}</p></div>
      <div className="form-grid">{children}</div>
    </section>
  );
}

export default function Settings() {
  const toast = useToast();
  const cur = useLoad<S>(`${A}/settings`);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [saved, setSaved] = useState<S | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  useEffect(() => { if (cur.data) { setSaved(cur.data); setForm(toForm(cur.data)); } }, [cur.data]);
  const zones = useMemo(() => { try { return (Intl as any).supportedValuesOf('timeZone') as string[]; } catch { return null; } }, []);
  const dirty = !!form && !!saved && Object.entries(toForm(saved)).some(([k, v]) => form[k] !== v);
  const set = (k: string, v: string) => setForm((f) => ({ ...f!, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form || !saved || !dirty) return;
    setErr(null); setFe({});
    const patch: Record<string, unknown> = {};
    for (const [k, raw] of Object.entries(form)) {
      if (raw === String((saved as any)[k])) continue;
      patch[k] = typeof (saved as any)[k] === 'number' ? Number(raw) : raw;
    }
    setBusy(true);
    try {
      const after = await api<S>(`${A}/settings`, { method: 'PUT', body: patch });
      setSaved(after); setForm(toForm(after)); toast('Settings saved');
    } catch (x) { const f = fieldErrors(x); setFe(f); setErr(Object.keys(f).length ? 'Fix the highlighted fields.' : errMsg(x)); } finally { setBusy(false); }
  }
  const discard = () => { if (saved) { setForm(toForm(saved)); setFe({}); setErr(null); } };
  const num = (k: keyof typeof NUMS) => {
    const n = NUMS[k]!;
    return <Field key={k} label={n.label} hint={n.hint} error={fe[k]}>{(p) => <input {...p} type="number" inputMode="numeric" min={n.min} max={n.max} step="any" required value={form![k]!} onChange={(e) => set(k, e.target.value)} />}</Field>;
  };

  return (
    <Page title="Settings" subtitle="Rules for location checks, QR codes and reminders.">
      <Async loading={cur.loading} error={cur.error} hasData={!!form}>
        {form && (
          <form className="stack" onSubmit={(e) => void submit(e)}>
            {err && <Alert kind="bad">{err}</Alert>}
            <Card flush><div className="set-list">
            <Section title="Location rules" blurb="How strictly a check-in position is judged.">
              <Field label="When spoofing is suspected" error={fe.spoofing_action}>
                {(p) => <select {...p} value={form.spoofing_action} onChange={(e) => set('spoofing_action', e.target.value)}><option value="flag">Accept but flag for review</option><option value="reject">Reject the check-in</option></select>}
              </Field>
              {num('impossible_speed_kmh')}
              {num('stale_fix_seconds')}
            </Section>
            <Section title="QR codes" blurb="Each site's code changes every day.">{num('qr_grace_minutes')}</Section>
            <Section title="Automation" blurb="What the system does on its own, and when.">
              <Field label="Timezone" error={fe.timezone}>
                {(p) => zones
                  ? <select {...p} value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>{(zones.includes(form.timezone) ? zones : [form.timezone, ...zones]).map((z) => <option key={z}>{z}</option>)}</select>
                  : <input {...p} value={form.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="Asia/Jakarta" />}
              </Field>
              {num('daily_summary_hour')}
              {num('missing_checkin_reminder_minutes')}
              {num('checkout_reminder_minutes')}
            </Section>
            <Section title="Privacy" blurb="How long exact positions are kept.">
              {num('coord_retention_days')}
              <div style={{ alignSelf: 'end' }}><Info label="What happens after this period?">Exact GPS coordinates are removed. Times, distances and flags stay.</Info></div>
            </Section>
            </div></Card>
            {dirty && (
              <div className="save-bar" role="region" aria-label="Unsaved changes">
                <span><strong>Unsaved changes</strong></span>
                <div className="row">
                  <Button onClick={discard} disabled={busy}>Discard</Button>
                  <Button type="submit" variant="primary" busy={busy}>Save settings</Button>
                </div>
              </div>
            )}
          </form>
        )}
      </Async>
    </Page>
  );
}
