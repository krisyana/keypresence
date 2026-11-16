import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Db } from './db';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const N = 2 ** 15, R = 8, P = 1;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const f = stored.split('$');
  if (f.length !== 6 || f[0] !== 'scrypt') return false;
  const salt = Buffer.from(f[4], 'base64url');
  const want = Buffer.from(f[5], 'base64url');
  const n = +f[1], r = +f[2], p = +f[3];
  const got = await scrypt(password, salt, want.length, { N: n, r, p, maxmem: 128 * n * r * 2 });
  return got.length === want.length && timingSafeEqual(got, want);
}

// A real hash of a random value, so an unknown email costs the same as a wrong password.
let dummyHash: Promise<string> | null = null;
export async function dummyVerify(pw: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(8).toString('hex'));
  await verifyPassword(pw, await dummyHash);
}

export interface AuthUser {
  id: string; email: string; name: string; role: 'admin' | 'employee';
  shift_id: string | null; location_consent_at: Date | null;
}

const COOKIE = 'kp_session';
const SLIDING_MS = 12 * 3600_000;
const ABSOLUTE_MS = 30 * 24 * 3600_000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createSession(db: Db, userId: string, now: Date): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO sessions(token_hash, user_id, created_at, last_seen_at, expires_at) VALUES ($1,$2,$3,$3,$4)', [
    sha(token), userId, now, new Date(now.getTime() + SLIDING_MS),
  ]);
  return token;
}

export function setSessionCookie(c: Context, token: string, secure: boolean) {
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', path: '/', secure, maxAge: ABSOLUTE_MS / 1000 });
}
export function clearSessionCookie(c: Context) { deleteCookie(c, COOKIE, { path: '/' }); }
export const sessionToken = (c: Context) => getCookie(c, COOKIE) ?? null;

export async function destroySession(db: Db, token: string) {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha(token)]);
}

export async function userForSession(db: Db, token: string, now: Date): Promise<AuthUser | null> {
  const rows = await db.query<AuthUser & { created_at: Date }>(
    `SELECT u.id, u.email, u.name, u.role, u.shift_id, u.location_consent_at, s.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.active`, [sha(token), now]);
  const row = rows[0];
  if (!row) return null;
  if (now.getTime() - new Date(row.created_at).getTime() > ABSOLUTE_MS) return null;
  await db.query('UPDATE sessions SET last_seen_at = $2, expires_at = $3 WHERE token_hash = $1', [
    sha(token), now, new Date(now.getTime() + SLIDING_MS),
  ]);
  const { created_at: _c, ...user } = row;
  return user;
}

export type Env = { Variables: { user: AuthUser } };

export const requireRole = (db: Db, clock: () => Date, role?: 'admin'): MiddlewareHandler<Env> => async (c, next) => {
  const token = sessionToken(c);
  const user = token ? await userForSession(db, token, clock()) : null;
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  if (role && user.role !== role) return c.json({ error: 'forbidden' }, 403);
  c.set('user', user);
  await next();
};

/** Sliding-window limiter, per process (documented limitation). */
export function makeLimiter(max: number, windowMs: number, clock: () => Date) {
  const hits = new Map<string, number[]>();
  return {
    take(key: string): boolean {
      const now = clock().getTime();
      const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (arr.length >= max) { hits.set(key, arr); return false; }
      arr.push(now); hits.set(key, arr);
      return true;
    },
    reset() { hits.clear(); },
  };
}
