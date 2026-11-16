// Latency of the check-in/out API in-process (no network). Usage: npx tsx scripts/bench.ts [postgres-url]
import { createApp } from '../src/server/app';
import { loadConfig } from '../src/server/config';
import { migrate, openDb } from '../src/server/db';
import { seedDemo, DEMO_PASSWORD } from '../src/server/seed';
import { signToken } from '../src/server/domain/qr';

const url = process.argv[2] ?? null;
const db = await openDb(url, ':memory:');
if (url) await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await migrate(db);
const config = loadConfig({ MASTER_SECRET: 'bench-secret-bench-secret-bench-secret', APP_URL: 'http://localhost:5173' } as any);
let now = new Date('2026-11-16T02:00:00Z');
const deps = { db, config, clock: () => now };
await seedDemo(deps, { history: true });
const app = createApp(deps, { log: () => {} });
const call = (cookie: string, path: string, body?: unknown) =>
  app.request(path, { method: body ? 'POST' : 'GET', headers: { cookie, origin: 'http://localhost:5173', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const login = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: JSON.stringify({ email: 'sari@keypresence.test', password: DEMO_PASSWORD }) });
const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
const admin = (await (await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: JSON.stringify({ email: 'admin@keypresence.test', password: DEMO_PASSWORD }) })).headers.get('set-cookie')!).split(';')[0]!;
const site = (await db.query<any>("SELECT id, qr_secret, qr_epoch FROM sites WHERE name LIKE 'Head%'"))[0];
const token = signToken(config.masterSecret, site, '2026-11-16');
const times: Record<string, number[]> = { in: [], out: [], summary: [], ask: [] };
const time = async (k: string, f: () => Promise<Response> | Response, expect: number) => {
  const t = performance.now(); const r = await f(); times[k]!.push(performance.now() - t);
  if (r.status !== expect) throw new Error(`${k} -> ${r.status}`);
};
for (let i = 0; i < 100; i++) {
  now = new Date(now.getTime() + 60_000);
  const fix = { lat: -6.175262, lng: 106.827153, accuracy: 10, fixTimestamp: now.getTime() - 1000 };
  await time('in', () => call(cookie, '/api/checkins/in', { token, kind: 'attendance', ...fix }), 201);
  now = new Date(now.getTime() + 60_000);
  await time('out', () => call(cookie, '/api/checkins/out', { token, kind: 'attendance', ...fix, fixTimestamp: now.getTime() - 1000 }), 200);
}
for (let i = 0; i < 30; i++) {
  await time('summary', () => call(admin, '/api/admin/summary?from=2026-11-02&to=2026-11-16'), 200);
  await time('ask', () => call(admin, '/api/admin/ai/ask', { question: 'late arrivals by site last 14 days' }), 200);
}
const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]!;
console.log(`db=${db.kind}`);
for (const [k, v] of Object.entries(times)) console.log(`${k.padEnd(8)} n=${String(v.length).padEnd(4)} p50=${q(v, 0.5).toFixed(1)}ms p95=${q(v, 0.95).toFixed(1)}ms`);
await db.close();
