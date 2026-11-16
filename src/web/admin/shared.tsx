import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alert, Spinner } from '../ui';

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
  if (!hasData && loading) return <Spinner />;
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
