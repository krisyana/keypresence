import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insideFix, makeEnv, outsideFix, type TestEnv } from './helpers';

let env: TestEnv; let sari: string; let admin: string;
beforeAll(async () => {
  env = await makeEnv();
  sari = await env.login('sari@keypresence.test');
  admin = await env.login('admin@keypresence.test');
});
afterAll(() => env.close());

const checkIn = async (cookie: string, siteId: string, fix: object, extra: object = {}) =>
  env.call(cookie, 'POST', '/api/checkins/in', { token: await env.siteToken(siteId), kind: 'attendance', ...fix, ...extra });
const checkOut = async (cookie: string, siteId: string, fix: object, extra: object = {}) =>
  env.call(cookie, 'POST', '/api/checkins/out', { token: await env.siteToken(siteId), kind: 'attendance', ...fix, ...extra });
const wipe = () => env.db.exec('DELETE FROM checkins; DELETE FROM attempts;');

describe('auth', () => {
  it('requires a session', async () => {
    expect((await env.call(null, 'GET', '/api/me')).status).toBe(401);
    expect((await env.call(null, 'POST', '/api/checkins/in', {})).status).toBe(401);
  });
  it('employees cannot reach admin routes; admins can', async () => {
    expect((await env.call(sari, 'GET', '/api/admin/sites')).status).toBe(403);
    expect((await env.call(admin, 'GET', '/api/admin/sites')).status).toBe(200);
  });
  it('wrong password and unknown email give the same error', async () => {
    const a = await env.call(null, 'POST', '/api/auth/login', { email: 'sari@keypresence.test', password: 'nope-nope-nope' });
    const b = await env.call(null, 'POST', '/api/auth/login', { email: 'ghost@keypresence.test', password: 'nope-nope-nope' });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.json).toEqual(b.json);
  });
  it('stores only a hash of the session token', async () => {
    const token = sari.split('=')[1]!;
    const rows = await env.db.query<{ token_hash: string }>('SELECT token_hash FROM sessions');
    expect(rows.some((r) => r.token_hash === token)).toBe(false);
  });
  it('deactivating an employee kills their session immediately', async () => {
    const c = await env.login('tono@keypresence.test');
    expect((await env.call(c, 'GET', '/api/me')).status).toBe(200);
    const tono = (await env.db.query<{ id: string }>("SELECT id FROM users WHERE email = 'tono@keypresence.test'"))[0]!.id;
    expect((await env.call(admin, 'PATCH', `/api/admin/employees/${tono}`, { active: false })).status).toBe(200);
    expect((await env.call(c, 'GET', '/api/me')).status).toBe(401);
  });
  it('logout destroys the session', async () => {
    const c = await env.login('lina@keypresence.test');
    await env.call(c, 'POST', '/api/auth/logout', {});
    expect((await env.call(c, 'GET', '/api/me')).status).toBe(401);
  });
  it('rate-limits repeated login attempts', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await env.call(null, 'POST', '/api/auth/login', { email: 'rate@keypresence.test', password: 'x'.repeat(12) })).status;
    expect(last).toBe(429);
  });
});

describe('check-in / check-out', () => {
  it('requires location consent', async () => {
    await env.db.query("UPDATE users SET location_consent_at = NULL WHERE id = $1", [env.ids.sari]);
    const r = await checkIn(sari, env.ids.siteHq, insideFix(env));
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('CONSENT_REQUIRED');
    expect((await env.call(sari, 'POST', '/api/me/consent', { consent: true })).status).toBe(200);
  });

  it('accepts inside the fence, rejects outside, then check-out works and computes metrics', async () => {
    await wipe();
    env.setNow('2026-11-16T02:20:00Z'); // 09:20 -> 20 min late
    const bad = await checkIn(sari, env.ids.siteHq, outsideFix(env));
    expect(bad.status).toBe(422);
    expect(bad.json.reasons).toContain('OUTSIDE_FENCE');
    expect(bad.json.distanceM).toBeGreaterThan(1000);
    expect((await env.db.query('SELECT 1 FROM checkins')).length).toBe(0);

    const ok = await checkIn(sari, env.ids.siteHq, insideFix(env));
    expect(ok.status).toBe(201);
    expect(ok.json.outcome).toBe('accepted');
    expect(ok.json.checkin.late_minutes).toBe(20);
    expect(ok.json.checkin.day).toBe('2026-11-16');

    env.setNow('2026-11-16T10:00:00Z'); // 17:00
    const out = await checkOut(sari, env.ids.siteHq, insideFix(env));
    expect(out.status).toBe(200);
    expect(out.json.checkin.status).toBe('closed');
    expect(out.json.checkin.work_minutes).toBe(460);
    expect(out.json.checkin.overtime_minutes).toBe(0);
    const attempts = await env.db.query<any>('SELECT action, outcome, reasons FROM attempts ORDER BY at, action');
    expect(attempts.map((a) => `${a.action}:${a.outcome}`).sort()).toEqual(['in:accepted', 'in:rejected', 'out:accepted']);
  });

  it('refuses a second open check-in and a check-out with nothing open', async () => {
    await wipe();
    env.setNow('2026-11-16T02:00:00Z');
    expect((await checkIn(sari, env.ids.siteHq, insideFix(env))).status).toBe(201);
    const again = await checkIn(sari, env.ids.siteHq, insideFix(env));
    expect([again.status, again.json.error]).toEqual([409, 'ALREADY_CHECKED_IN']);
    await checkOut(sari, env.ids.siteHq, insideFix(env));
    const none = await checkOut(sari, env.ids.siteHq, insideFix(env));
    expect([none.status, none.json.error]).toEqual([409, 'NOT_CHECKED_IN']);
  });

  it('two simultaneous check-ins create exactly one open record', async () => {
    await wipe();
    env.setNow('2026-11-16T02:00:00Z');
    const results = await Promise.all(Array.from({ length: 8 }, () => checkIn(sari, env.ids.siteHq, insideFix(env))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    expect((await env.db.query('SELECT 1 FROM checkins WHERE status = \'open\'')).length).toBe(1);
  });

  it('works for other kinds on the same flow, independently of attendance', async () => {
    await wipe();
    env.setNow('2026-11-16T02:00:00Z');
    expect((await checkIn(sari, env.ids.siteHq, insideFix(env))).status).toBe(201);
    const room = await checkIn(sari, env.ids.siteHq, insideFix(env), { kind: 'asset', subjectRef: 'Meeting room 2' });
    expect(room.status).toBe(201);
    const room2 = await checkIn(sari, env.ids.siteHq, insideFix(env), { kind: 'asset', subjectRef: 'Projector A' });
    expect(room2.status).toBe(201);
    expect((await checkIn(sari, env.ids.siteHq, insideFix(env), { kind: 'asset', subjectRef: 'Meeting room 2' })).status).toBe(409);
    const out = await checkOut(sari, env.ids.siteHq, insideFix(env), { kind: 'asset', subjectRef: 'Meeting room 2' });
    expect(out.status).toBe(200);
    expect(out.json.checkin.kind).toBe('asset');
    expect(out.json.checkin.late_minutes).toBe(0); // shift rules only apply to attendance
    expect((await checkIn(sari, env.ids.siteHq, insideFix(env), { kind: 'visitor' })).json.error).toBe('SUBJECT_REQUIRED');
  });

  it('flag-mode site accepts outside the fence but flags it and queues review', async () => {
    await wipe();
    env.setNow('2026-11-16T02:00:00Z');
    // Warehouse is enforcement=flag. Use head-office coordinates: far from the warehouse.
    const r = await checkIn(sari, env.ids.siteWh, insideFix(env));
    expect(r.status).toBe(201);
    expect(r.json.outcome).toBe('flagged');
    expect(r.json.reasons).toContain('OUTSIDE_FENCE');
    expect(r.json.checkin.review_status).toBe('pending');
  });

  it('flags a different-site check-out', async () => {
    await wipe();
    env.setNow('2026-11-16T02:00:00Z');
    await checkIn(sari, env.ids.siteHq, insideFix(env));
    const out = await checkOut(sari, env.ids.siteWh, insideFix(env));
    expect(out.json.checkin.out_flags).toContain('DIFFERENT_SITE');
  });

  it('flags impossible travel between two events and rejects it when policy says so', async () => {
    await wipe();
    env.setNow('2026-11-16T02:00:00Z');
    await checkIn(sari, env.ids.siteHq, insideFix(env));
    await checkOut(sari, env.ids.siteHq, insideFix(env));
    env.advance(5 * 60_000);
    // Warehouse flag-mode site, but coordinates at the warehouse: ~4 km from HQ in 5 minutes = 48 km/h -> fine
    const wh = (await env.db.query<any>('SELECT lat, lng FROM sites WHERE id = $1', [env.ids.siteWh]))[0];
    expect((await checkIn(sari, env.ids.siteWh, { lat: wh.lat, lng: wh.lng + 0.00011, accuracy: 10, fixTimestamp: env.now().getTime() - 1000 })).json.reasons).toEqual([]);
    await checkOut(sari, env.ids.siteWh, { lat: wh.lat, lng: wh.lng + 0.00011, accuracy: 10, fixTimestamp: env.now().getTime() - 1000 });
    env.advance(60_000);
    // 1 minute later back at HQ (~4 km): 240 km/h
    const back = await checkIn(sari, env.ids.siteHq, insideFix(env));
    expect(back.json.reasons).toContain('IMPOSSIBLE_TRAVEL');
    expect(back.json.outcome).toBe('flagged');
    await env.call(admin, 'PUT', '/api/admin/settings', { spoofing_action: 'reject' });
    await checkOut(sari, env.ids.siteHq, insideFix(env)).catch(() => {});
    await env.db.exec("UPDATE checkins SET status='closed', check_out_at = check_in_at WHERE status='open'");
    env.advance(60_000);
    const rej = await checkIn(sari, env.ids.siteWh, { lat: wh.lat, lng: wh.lng + 0.00011, accuracy: 10, fixTimestamp: env.now().getTime() - 1000 });
    expect(rej.status).toBe(422);
    expect(rej.json.reasons).toContain('IMPOSSIBLE_TRAVEL');
    await env.call(admin, 'PUT', '/api/admin/settings', { spoofing_action: 'flag' });
  });

  it('rejects a stale fix (replay)', async () => {
    await wipe();
    env.setNow('2026-11-16T02:00:00Z');
    const r = await checkIn(sari, env.ids.siteHq, insideFix(env, { fixTimestamp: env.now().getTime() - 120_000 }));
    expect(r.status).toBe(422);
    expect(r.json.reasons).toContain('STALE_FIX');
  });
});

describe('QR enforcement', () => {
  const tryToken = (token: string) => env.call(sari, 'POST', '/api/checkins/in', { token, kind: 'attendance', ...insideFix(env) });
  it('rejects yesterday\'s code, other site\'s code, garbage and a rotated code', async () => {
    await wipe();
    env.setNow('2026-11-16T02:00:00Z');
    const today = await env.siteToken(env.ids.siteHq);
    const stale = await tryToken(await env.tokenForDay(env.ids.siteHq, '2026-11-15'));
    expect([stale.status, stale.json.reasons]).toEqual([422, ['QR_EXPIRED']]);
    const tomorrow = await tryToken(await env.tokenForDay(env.ids.siteHq, '2026-11-17'));
    expect(tomorrow.json.reasons).toEqual(['QR_EXPIRED']);

    // A valid code for the warehouse used at HQ coordinates: signature fine, the warehouse fence flags it.
    const wrongSite = await tryToken(await env.siteToken(env.ids.siteWh));
    expect(wrongSite.json.outcome).toBe('flagged');
    await wipe();
    expect((await tryToken('not-a-token')).json.reasons).toEqual(['QR_MALFORMED']);

    const rot = await env.call(admin, 'POST', `/api/admin/sites/${env.ids.siteHq}/qr/rotate`, {});
    expect(rot.status).toBe(200);
    const old = await tryToken(today);
    expect(old.status).toBe(422);
    expect(old.json.reasons[0]).toMatch(/QR_(BAD_SIGNATURE|ROTATED)/);
    const fresh = await tryToken(await env.siteToken(env.ids.siteHq));
    expect(fresh.status).toBe(201);
  });
  it('does not accept a code for an inactive site', async () => {
    await wipe();
    const token = await env.siteToken(env.ids.siteHq);
    await env.call(admin, 'PATCH', `/api/admin/sites/${env.ids.siteHq}`, { active: false });
    expect((await tryToken(token)).json.reasons).toEqual(['QR_UNKNOWN_SITE']);
    await env.call(admin, 'PATCH', `/api/admin/sites/${env.ids.siteHq}`, { active: true });
  });
  it('admin QR endpoint returns today\'s URL that the resolve endpoint accepts', async () => {
    const q = await env.call(admin, 'GET', `/api/admin/sites/${env.ids.siteHq}/qr`);
    expect(q.json.url).toMatch(/\/s\//);
    expect(q.json.svg).toContain('<svg');
    const token = q.json.url.split('/s/')[1];
    const r = await env.call(sari, 'GET', `/api/sites/resolve?token=${token}`);
    expect(r.json).toMatchObject({ ok: true, site: { name: 'Head Office (demo)' } });
    expect((await env.call(sari, 'GET', '/api/sites/resolve?token=junk')).status).toBe(422);
  });
});

describe('employee data isolation', () => {
  it('history contains only the caller\'s records and no coordinates', async () => {
    await wipe();
    env.setNow('2026-11-16T02:00:00Z');
    const budi = await env.login('budi@keypresence.test');
    await checkIn(sari, env.ids.siteHq, insideFix(env));
    await checkIn(budi, env.ids.siteHq, insideFix(env));
    const mine = await env.call(sari, 'GET', '/api/checkins/mine');
    expect(mine.json.items).toHaveLength(1);
    expect(JSON.stringify(mine.json)).not.toMatch(/in_lat|in_lng/);
  });
});
