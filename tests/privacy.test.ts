import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insideFix, makeEnv, outsideFix, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => { env = await makeEnv(); });
afterAll(() => env.close());

describe('logs and storage (ADR-0006)', () => {
  it('request logs never contain coordinates, tokens, cookies or bodies', async () => {
    const sari = await env.login('sari@keypresence.test');
    const token = await env.siteToken(env.ids.siteHq);
    await env.call(sari, 'GET', `/api/sites/resolve?token=${token}`);
    await env.call(sari, 'POST', '/api/checkins/in', { token, kind: 'attendance', ...insideFix(env) });
    await env.call(sari, 'POST', '/api/checkins/out', { token, kind: 'attendance', ...outsideFix(env) });
    const all = env.logs.join('\n');
    expect(env.logs.length).toBeGreaterThan(3);
    expect(all).not.toContain(token);
    expect(all).not.toContain(sari.split('=')[1]!);
    expect(all).not.toMatch(/-6\.1\d+|106\.82\d+/);
    expect(all).not.toMatch(/password|token=/i);
    expect(all).toMatch(/POST \/api\/checkins\/in 201/);
  });
  it('rejected attempts store distance and reasons but no coordinates', async () => {
    const cols = (await env.db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'attempts'")).map((c) => c.column_name);
    expect(cols.filter((c) => /lat|lng|lon/.test(c))).toEqual([]);
  });
  it('server errors do not leak internals', async () => {
    await env.db.exec('ALTER TABLE shifts RENAME TO shifts_x');
    const admin = await env.login('admin@keypresence.test');
    const r = await env.call(admin, 'GET', '/api/admin/shifts');
    await env.db.exec('ALTER TABLE shifts_x RENAME TO shifts');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.json)).not.toMatch(/shifts|relation|SELECT/i);
  });
});
