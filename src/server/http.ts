import type { Context, MiddlewareHandler } from 'hono';
import { ZodError, type ZodType } from 'zod';
import { ApiError } from './deps';

export async function body<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try { raw = await c.req.json(); } catch { throw new ApiError(400, 'BAD_JSON', 'Body must be valid JSON.'); }
  return parse(schema, raw);
}

export function parse<T>(schema: ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) throw new ApiError(400, 'VALIDATION', 'Invalid input.', { issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  return r.data;
}

export function onError(log: (line: string) => void) {
  return (err: unknown, c: Context) => {
    if (err instanceof ApiError) return c.json({ error: err.code, message: err.message, ...err.extra }, err.status);
    if (err instanceof ZodError) return c.json({ error: 'VALIDATION', message: 'Invalid input.' }, 400);
    log(`ERROR ${c.req.method} ${new URL(c.req.url).pathname} ${err instanceof Error ? err.message : 'unknown'}`);
    return c.json({ error: 'INTERNAL', message: 'Something went wrong.' }, 500);
  };
}

/** Request log: method, path (no query string), status, duration. Never bodies, tokens or coordinates (ADR-0006). */
export function requestLogger(log: (line: string) => void): MiddlewareHandler {
  return async (c, next) => {
    const t = performance.now();
    await next();
    log(`${c.req.method} ${new URL(c.req.url).pathname} ${c.res.status} ${Math.round(performance.now() - t)}ms`);
  };
}

/** CSRF defence in depth (ADR-0002): JSON-only mutations and an Origin check. SameSite=Lax is the first layer. */
export function csrf(allowedOrigin: string): MiddlewareHandler {
  const allowedHost = new URL(allowedOrigin).host;
  return async (c, next) => {
    const m = c.req.method;
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
      const origin = c.req.header('origin');
      if (origin) {
        let host = '';
        try { host = new URL(origin).host; } catch { /* invalid */ }
        if (host !== allowedHost && host !== c.req.header('host')) return c.json({ error: 'BAD_ORIGIN' }, 403);
      }
      const ct = c.req.header('content-type') ?? '';
      const hasBody = c.req.header('content-length') !== '0' && c.req.header('content-length') !== undefined;
      if (hasBody && !ct.startsWith('application/json')) return c.json({ error: 'JSON_ONLY' }, 400);
    }
    await next();
  };
}

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join('|') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (header: string[], rows: unknown[][]) =>
  [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
