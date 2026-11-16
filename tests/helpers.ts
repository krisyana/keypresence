import { createApp } from '../src/server/app';
import { loadConfig } from '../src/server/config';
import { migrate, openDb, type Db } from '../src/server/db';
import { seedDemo, DEMO_PASSWORD } from '../src/server/seed';
import type { Deps } from '../src/server/deps';
import type { Planner } from '../src/server/ai';
import { signToken } from '../src/server/domain/qr';
import { localParts } from '../src/server/domain/time';

export interface TestEnv {
  db: Db; deps: Deps; app: ReturnType<typeof createApp>; logs: string[];
  setNow(d: Date | string): void; now(): Date; advance(ms: number): void;
  login(email: string): Promise<string>;
  call(cookie: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; json: any; res: Response }>;
  siteToken(siteId: string): Promise<string>;
  ids: { siteHq: string; siteWh: string; sari: string; budi: string; admin: string; office: string };
  close(): Promise<void>;
}

/** Fresh database per call: in-memory PGlite, or real Postgres when TEST_DATABASE_URL is set. */
export async function makeEnv(opts: { history?: boolean; planner?: Planner; start?: string } = {}): Promise<TestEnv> {
  const url = process.env.TEST_DATABASE_URL || null;
  const db = await openDb(url, ':memory:');
  if (url) await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  let t = new Date(opts.start ?? '2026-11-16T02:00:00Z'); // Monday 09:00 in Asia/Jakarta
  const config = loadConfig({ MASTER_SECRET: 'test-master-secret-test-master-secret', APP_URL: 'http://localhost:5173' } as any);
  const deps: Deps = { db, config, clock: () => t };
  await seedDemo(deps, { history: opts.history ?? false });
  const logs: string[] = [];
  const app = createApp(deps, { log: (l) => logs.push(l), planner: opts.planner });
  const one = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p))[0];
  const ids = {
    siteHq: (await one("SELECT id FROM sites WHERE name LIKE 'Head%'")).id,
    siteWh: (await one("SELECT id FROM sites WHERE name LIKE 'Ware%'")).id,
    sari: (await one("SELECT id FROM users WHERE email = 'sari@keypresence.test'")).id,
    budi: (await one("SELECT id FROM users WHERE email = 'budi@keypresence.test'")).id,
    admin: (await one("SELECT id FROM users WHERE role = 'admin'")).id,
    office: (await one("SELECT id FROM shifts WHERE name = 'Office hours'")).id,
  };
  const call: TestEnv['call'] = async (cookie, method, path, body) => {
    const res = await app.request(path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), origin: 'http://localhost:5173' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.clone().text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, res };
  };
  return {
    db, deps, app, logs, ids, call,
    setNow: (d) => { t = new Date(d); }, now: () => t, advance: (ms) => { t = new Date(t.getTime() + ms); },
    async login(email) {
      const r = await call(null, 'POST', '/api/auth/login', { email, password: DEMO_PASSWORD });
      if (r.status !== 200) throw new Error(`login failed ${r.status}`);
      return (r.res.headers.get('set-cookie') ?? '').split(';')[0]!;
    },
    async siteToken(siteId) {
      const s = await one('SELECT id, qr_secret, qr_epoch FROM sites WHERE id = $1', [siteId]);
      return signToken(config.masterSecret, s, localParts(t, 'Asia/Jakarta').day);
    },
    close: () => db.close(),
  };
}

/** A fix inside the Head Office fence (about 15 m from the centre). */
export const INSIDE = { lat: -6.175392, lng: 106.827153 };
export const insideFix = (env: TestEnv, extra: object = {}) => ({ lat: -6.175262, lng: 106.827153, accuracy: 12.5, fixTimestamp: env.now().getTime() - 2000, ...extra });
/** About 1.1 km north of the Head Office. */
export const outsideFix = (env: TestEnv, extra: object = {}) => ({ lat: -6.165392, lng: 106.827153, accuracy: 12.5, fixTimestamp: env.now().getTime() - 2000, ...extra });
