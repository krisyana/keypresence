export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data: any = {}) { super(message); }
}

/** Typed-enough fetch wrapper. Throws ApiError for non-2xx so callers can show `err.message` and read `err.data` (e.g. rejection reasons). */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/') && path !== '/api/me') window.dispatchEvent(new Event('kp:unauthenticated'));
    throw new ApiError(res.status, data?.error ?? 'ERROR', data?.message ?? `Request failed (${res.status})`, data ?? {});
  }
  return data as T;
}

export const qs = (o: Record<string, string | number | undefined | null | false>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
