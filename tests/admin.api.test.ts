import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insideFix, makeEnv, type TestEnv } from './helpers';

let env: TestEnv; let sari: string; let admin: string;
beforeAll(async () => {
  env = await makeEnv();
  sari = await env.login('sari@keypresence.test');
  admin = await env.login('admin@keypresence.test');
});
afterAll(() => env.close());
const A = (m: string, p: string, b?: unknown) => env.call(admin, m, `/api/admin${p}`, b);

it('runs on the database the run claims', () => {
  expect(env.db.kind).toBe(process.env.TEST_DATABASE_URL ? 'pg' : 'pglite');
});

describe('sites', () => {
  it('creates a site with a geofence, validates input, rejects duplicates, and audits', async () => {
    const ok = await A('POST', '/sites', { name: 'Branch Bandung (demo)', lat: -6.917464, lng: 107.619125, radiusM: 80, maxAccuracyM: 40, enforcement: 'reject' });
    expect(ok.status).toBe(201);
    expect((await A('POST', '/sites', { name: 'Branch Bandung (demo)', lat: 1, lng: 1, radiusM: 80 })).status).toBe(409);
    expect((await A('POST', '/sites', { name: 'Bad', lat: 91, lng: 0, radiusM: 80 })).status).toBe(400);
    expect((await A('POST', '/sites', { name: 'Tiny', lat: 1, lng: 1, radiusM: 1 })).status).toBe(400);
    const audit = (await A('GET', '/audit')).json.items;
    expect(audit.some((a: any) => a.action === 'SITE_CREATE' && a.detail.name === 'Branch Bandung (demo)')).toBe(true);
  });
  it('never exposes the QR secret', async () => {
    const list = JSON.stringify((await A('GET', '/sites')).json);
    expect(list).not.toMatch(/qr_secret|qrSecret/);
  });
  it('rotation increments the epoch, is audited, and the QR URL changes', async () => {
    const before = (await A('GET', `/sites/${env.ids.siteWh}/qr`)).json;
    const rot = await A('POST', `/sites/${env.ids.siteWh}/qr/rotate`, {});
    const after = (await A('GET', `/sites/${env.ids.siteWh}/qr`)).json;
    expect(after.epoch).toBe(before.epoch + 1);
    expect(after.url).not.toBe(before.url);
    expect(rot.json.epoch).toBe(after.epoch);
    expect((await A('GET', '/audit')).json.items.some((a: any) => a.action === 'QR_ROTATE')).toBe(true);
  });
});

describe('shifts and employees', () => {
  it('validates shifts', async () => {
    expect((await A('POST', '/shifts', { name: 'Night', startTime: '22:00', endTime: '06:00' })).status).toBe(400);
    expect((await A('POST', '/shifts', { name: 'Late', startTime: '12:00', endTime: '20:00', workDays: [1, 2, 3] })).status).toBe(201);
  });
  it('creates employees, hashes passwords, rejects weak passwords and duplicate emails', async () => {
    expect((await A('POST', '/employees', { email: 'new@keypresence.test', name: 'New Person', password: 'short' })).status).toBe(400);
    const r = await A('POST', '/employees', { email: 'new@keypresence.test', name: 'New Person', password: 'long-enough-pass' });
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.json)).not.toMatch(/password/);
    expect((await A('POST', '/employees', { email: 'NEW@keypresence.test', name: 'Dup', password: 'long-enough-pass' })).status).toBe(409);
    const row = (await env.db.query<any>("SELECT password_hash FROM users WHERE email = 'new@keypresence.test'"))[0];
    expect(row.password_hash).toMatch(/^scrypt\$/);
  });
  it('an admin cannot lock themselves out', async () => {
    expect((await A('PATCH', `/employees/${env.ids.admin}`, { active: false })).status).toBe(409);
    expect((await A('PATCH', `/employees/${env.ids.admin}`, { role: 'employee' })).status).toBe(409);
  });
  it('lists aliases, not used elsewhere as ids', async () => {
    const items = (await A('GET', '/employees')).json.items;
    expect(items[0].alias).toMatch(/^E-[A-Z2-9]{5}$/);
  });
});

describe('records, review, override, corrections', () => {
  let recordId: string;
  it('lists, filters, reviews flagged records', async () => {
    env.setNow('2026-11-16T02:00:00Z');
    const token = await env.siteToken(env.ids.siteWh);
    const inn = await env.call(sari, 'POST', '/api/checkins/in', { token, kind: 'attendance', ...insideFix(env) }); // flagged at warehouse
    recordId = inn.json.checkin.id;
    const flagged = (await A('GET', '/checkins?flagged=1')).json;
    expect(flagged.total).toBe(1);
    expect((await A('GET', '/checkins?review=pending')).json.items[0].id).toBe(recordId);
    expect((await A('PATCH', `/checkins/${recordId}/review`, { note: 'OK: indoor GPS' })).status).toBe(200);
    expect((await A('GET', '/checkins?review=pending')).json.total).toBe(0);
    expect((await A('GET', `/checkins?userId=${env.ids.budi}`)).json.total).toBe(0);
  });
  it('override requires a reason, writes a flag and an audit entry, and clears a detected absence', async () => {
    await env.db.query("INSERT INTO absences(user_id, day) VALUES ($1, '2026-11-16')", [env.ids.budi]);
    const body = { userId: env.ids.budi, siteId: env.ids.siteHq, checkInAt: '2026-11-16T02:00:00Z', checkOutAt: '2026-11-16T10:00:00Z' };
    expect((await A('POST', '/checkins/override', body)).status).toBe(400);
    const ok = await A('POST', '/checkins/override', { ...body, reason: 'Phone broken, confirmed by manager' });
    expect(ok.status).toBe(201);
    const row = (await env.db.query<any>('SELECT * FROM checkins WHERE id = $1', [ok.json.id]))[0];
    expect(row.in_flags).toContain('ADMIN_OVERRIDE');
    expect(row.override_by).toBe(env.ids.admin);
    expect(row.work_minutes).toBe(480);
    expect((await env.db.query('SELECT 1 FROM absences WHERE user_id = $1', [env.ids.budi])).length).toBe(0);
    const a = (await A('GET', '/audit')).json.items.find((x: any) => x.action === 'CHECKIN_OVERRIDE');
    expect(a.detail.reason).toMatch(/Phone broken/);
    expect((await A('POST', '/checkins/override', { ...body, checkInAt: '2999-01-01T00:00:00Z', checkOutAt: undefined, reason: 'future dated' })).status).toBe(400);
  });
  it('employee correction: pending, one at a time, approved by admin, recomputes and audits before/after', async () => {
    env.setNow('2026-11-16T11:00:00Z');
    await env.db.query("UPDATE checkins SET status='closed', check_out_at = '2026-11-16T05:00:00Z', closed_by = 'auto', out_flags = ARRAY['AUTO_CLOSED'] WHERE id = $1", [recordId]);
    const corr = { checkinId: recordId, proposedCheckOutAt: '2026-11-16T10:30:00Z', reason: 'Forgot to scan out, left at 17:30' };
    const made = await env.call(sari, 'POST', '/api/corrections', corr);
    expect(made.status).toBe(201);
    expect((await env.call(sari, 'POST', '/api/corrections', corr)).json.error).toBe('CORRECTION_PENDING');
    expect((await env.call(sari, 'POST', '/api/corrections', { ...corr, proposedCheckOutAt: '2026-11-16T01:00:00Z' })).status).toBe(400);
    const budi = await env.login('budi@keypresence.test');
    expect((await env.call(budi, 'POST', '/api/corrections', { ...corr, reason: 'not my record' })).status).toBe(404);
    expect((await env.call(sari, 'POST', `/api/admin/corrections/${made.json.id}/decide`, { approve: true })).status).toBe(403);

    expect((await A('POST', `/corrections/${made.json.id}/decide`, { approve: true, note: 'ok' })).status).toBe(200);
    const row = (await env.db.query<any>('SELECT * FROM checkins WHERE id = $1', [recordId]))[0];
    expect(new Date(row.check_out_at).toISOString()).toBe('2026-11-16T10:30:00.000Z');
    expect(row.overtime_minutes).toBe(30);
    expect((await A('POST', `/corrections/${made.json.id}/decide`, { approve: true })).json.error).toBe('NOT_PENDING');
    const audit = (await A('GET', '/audit')).json.items.find((x: any) => x.action === 'CORRECTION_APPROVE');
    expect(audit.detail.before.out).toBeTruthy();
    expect(audit.detail.after.out).toBeTruthy();
    const notes = (await env.call(sari, 'GET', '/api/notifications')).json.items;
    expect(notes.some((n: any) => n.type === 'correction')).toBe(true);
  });
  it('admin edit needs a reason and keeps an audit trail', async () => {
    expect((await A('PATCH', `/checkins/${recordId}`, { checkOutAt: '2026-11-16T10:45:00Z' })).status).toBe(400);
    const r = await A('PATCH', `/checkins/${recordId}`, { checkOutAt: '2026-11-16T10:45:00Z', reason: 'Manager confirmed 17:45' });
    expect(r.status).toBe(200);
    expect(r.json.overtime_minutes).toBe(45);
    expect((await A('GET', '/audit')).json.items.some((a: any) => a.action === 'CHECKIN_EDIT')).toBe(true);
  });
});

describe('CSV export', () => {
  it('neutralises spreadsheet formulas, omits coordinates by default, and audits the export', async () => {
    await env.db.query("UPDATE users SET name = '=HYPERLINK(\"http://evil\")' WHERE id = $1", [env.ids.sari]);
    const r = await env.call(admin, 'GET', '/api/admin/checkins/export.csv');
    const text = await r.res.text();
    expect(r.res.headers.get('content-type')).toContain('text/csv');
    expect(text.split('\r\n')[0]).toContain('employee');
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(text).not.toMatch(/-6\.1\d{4}/);
    const withCoords = await (await env.call(admin, 'GET', '/api/admin/checkins/export.csv?coords=1')).res.text();
    expect(withCoords).toMatch(/in_lat/);
    const audits = (await A('GET', '/audit')).json.items.filter((a: any) => a.action === 'CSV_EXPORT');
    expect(audits.map((a: any) => a.detail.coords).sort()).toEqual([false, true]);
  });
});

describe('settings', () => {
  it('validates, rejects unknown keys, audits before/after, and takes effect', async () => {
    expect((await A('PUT', '/settings', { timezone: 'Mars/Phobos' })).status).toBe(400);
    expect((await A('PUT', '/settings', { evil: 1 })).status).toBe(400);
    expect((await A('PUT', '/settings', { impossible_speed_kmh: 5 })).status).toBe(400);
    const r = await A('PUT', '/settings', { qr_grace_minutes: 20 });
    expect(r.json.qr_grace_minutes).toBe(20);
    expect((await A('GET', '/settings')).json.qr_grace_minutes).toBe(20);
    const a = (await A('GET', '/audit')).json.items.find((x: any) => x.action === 'SETTINGS_UPDATE');
    expect(a.detail.before.qr_grace_minutes).toBe(10);
  });
});

describe('csrf and input handling', () => {
  it('rejects a cross-origin mutation and non-JSON bodies', async () => {
    const res = await env.app.request('/api/admin/sites', { method: 'POST', headers: { cookie: admin, origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(403);
    const res2 = await env.app.request('/api/me/consent', { method: 'POST', headers: { cookie: sari, 'content-type': 'text/plain' }, body: 'consent=true' });
    expect(res2.status).toBe(400);
  });
  it('malformed JSON and bad ids are 400, unknown routes 404', async () => {
    const res = await env.app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    expect(res.status).toBe(400);
    expect((await A('PATCH', '/sites/not-a-uuid', {})).status).toBe(400);
    expect((await env.call(admin, 'GET', '/api/nothing')).status).toBe(404);
  });
});
