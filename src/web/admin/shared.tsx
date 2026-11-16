import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alert, Avatar, Button, Icon, Modal, Skeleton } from '../ui';
import './admin.css';

export const A = '/api/admin';
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

/** Load data on mount / when deps change. `reload()` refetches without clearing the screen. */
export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (path === null) return;
    let live = true;
    setLoading(true);
    api<T>(path).then((d) => { if (live) { setData(d); setError(null); } })
      .catch((e) => { if (live) setError(errMsg(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Organisation timezone (falls back to the signed-in user's value while /settings loads). */
export function useOrgTz() {
  const { me } = useAuth();
  const { data } = useLoad<{ timezone: string }>(`${A}/settings`);
  return data?.timezone ?? me?.timezone ?? 'UTC';
}

export interface Employee { id: string; email: string; name: string; role: 'admin' | 'employee'; active: boolean; shift_id: string | null; shift_name: string | null; location_consent_at: string | null; alias: string }
export interface Site { id: string; name: string; lat: number; lng: number; radiusM: number; maxAccuracyM: number; enforcement: 'reject' | 'flag' | 'off'; active: boolean }
export interface Shift { id: string; name: string; startTime: string; endTime: string; graceMinutes: number; overtimeAfterMinutes: number; autoCloseAfterMinutes: number; workDays: number[]; active: boolean }

export const KIND_LIST = ['attendance', 'visitor', 'event', 'asset', 'task'] as const;
export const ENFORCEMENT_LABEL: Record<string, string> = { reject: 'Reject outside fence', flag: 'Accept but flag', off: 'No location check' };
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Wraps a list view with loading, error and empty handling. */
export function Async({ loading, error, hasData, children }: { loading: boolean; error: string | null; hasData: boolean; children: ReactNode }) {
  if (error) return <Alert kind="bad">{error}</Alert>;
  if (!hasData && loading) return <Skeleton lines={4} />;
  return <>{children}</>;
}

export function YesNo({ v, yes = 'Yes', no = 'No' }: { v: boolean; yes?: string; no?: string }) {
  return <span>{v ? yes : no}</span>;
}

export const fmtDist = (m: number | null | undefined) => (m === null || m === undefined ? '–' : `${Math.round(m)} m`);
export const kv = (o: unknown): string => {
  if (o === null || o === undefined) return '–';
  if (typeof o === 'object') return Object.entries(o as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`).join(', ');
  return String(o);
};

/** Field-level messages from a server validation error: { "reason": "Too short" }. */
export function fieldErrors(e: unknown): Record<string, string> {
  const issues = (e as { data?: { issues?: { path: string; message: string }[] } })?.data?.issues;
  const out: Record<string, string> = {};
  if (Array.isArray(issues)) for (const i of issues) if (i.path && !out[i.path]) out[i.path] = i.message;
  return out;
}

/** Short info disclosure: use instead of paragraphs of help text. */
export function Info({ label = 'More info', children }: { label?: string; children: ReactNode }) {
  return <details className="info"><summary><Icon name="info" size={16} />{label}</summary><p>{children}</p></details>;
}

export function PersonCell({ name, sub }: { name: string; sub?: string | null }) {
  return (
    <div className="cell-person">
      <Avatar name={name} size={34} />
      <div><strong>{name}</strong>{sub && <span className="cell-sub">{sub}</span>}</div>
    </div>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

/** Confirm step for destructive or security-sensitive actions. */
export function Confirm({ open, title, children, confirmLabel, danger, busy, onConfirm, onClose }: { open: boolean; title: string; children: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal title={title} open={open} onClose={onClose}>
      <div className="stack">
        <p>{children}</p>
        <div className="confirm-actions">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** "Mon–Fri" style summary of ISO weekday numbers (1 = Mon). */
export function dayRange(days: number[]): string {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (!d.length) return '–';
  if (d.length === 7) return 'Every day';
  const runs: number[][] = [];
  for (const x of d) { const last = runs[runs.length - 1]; if (last && last[last.length - 1] === x - 1) last.push(x); else runs.push([x]); }
  return runs.map((r) => (r.length > 2 ? `${DAY_NAMES[r[0]! - 1]}–${DAY_NAMES[r[r.length - 1]! - 1]}` : r.map((x) => DAY_NAMES[x - 1]).join(', '))).join(', ');
}
