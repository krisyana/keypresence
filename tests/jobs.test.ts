import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runJobs } from '../src/server/jobs';
import { insideFix, makeEnv, type TestEnv } from './helpers';

let env: TestEnv;
beforeEach(async () => { env = await makeEnv(); });
afterEach(() => env.close());
const jobs = () => runJobs(env.deps);
const count = async (sql: string, p: unknown[] = []) => (await env.db.query<{ n: number }>(sql, p))[0]!.n;

describe('auto-close', () => {
  it('closes a forgotten check-out at shift end after the delay, once, flagged for review', async () => {
    const sari = await env.login('sari@keypresence.test');
    env.setNow('2026-11-16T02:05:00Z'); // 09:05 Mon
    const inn = await env.call(sari, 'POST', '/api/checkins/in', { token: await env.siteToken(env.ids.siteHq), kind: 'attendance', ...insideFix(env) });
    expect(inn.status).toBe(201);

    env.setNow('2026-11-16T10:30:00Z'); // 17:30, inside the 120 min delay
    expect((await jobs()).autoClosed).toBe(0);
    env.setNow('2026-11-16T11:59:00Z'); // 18:59
    expect((await jobs()).autoClosed).toBe(0);
    env.setNow('2026-11-16T12:00:00Z'); // 19:00 = end 17:00 + 120 min
    expect((await jobs()).autoClosed).toBe(1);
    expect((await jobs()).autoClosed).toBe(0); // idempotent

    const row = (await env.db.query<any>('SELECT * FROM checkins'))[0];
    expect(row.status).toBe('closed');
    expect(row.closed_by).toBe('auto');
    expect(new Date(row.check_out_at).toISOString()).toBe('2026-11-16T10:00:00.000Z'); // 17:00 local
    expect(row.out_flags).toEqual(['AUTO_CLOSED']);
    expect(row.review_status).toBe('pending');
    expect(row.work_minutes).toBe(475);
    expect(await count("SELECT count(*)::int AS n FROM notifications WHERE type = 'auto_close'")).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM audit_log WHERE action = 'AUTO_CLOSE'")).toBe(1);
  });

  it('leaves non-attendance and shift-less records alone', async () => {
    const sari = await env.login('sari@keypresence.test');
    env.setNow('2026-11-16T02:05:00Z');
    await env.call(sari, 'POST', '/api/checkins/in', { token: await env.siteToken(env.ids.siteHq), kind: 'asset', subjectRef: 'Van 1', ...insideFix(env) });
    env.setNow('2026-11-17T10:00:00Z');
    expect((await jobs()).autoClosed).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM checkins WHERE status = 'open'")).toBe(1);
  });
});

describe('absence and reminders', () => {
  it('reminds late non-arrivals once, records absence after shift end once, only on work days, never for present people', async () => {
    const sari = await env.login('sari@keypresence.test');
    env.setNow('2026-11-16T02:00:00Z'); // 09:00 Monday
    await env.call(sari, 'POST', '/api/checkins/in', { token: await env.siteToken(env.ids.siteHq), kind: 'attendance', ...insideFix(env) });

    env.setNow('2026-11-16T02:29:00Z'); // 09:29: office shift is not yet 30 min in; the two early-shift employees (07:00) are
    expect((await jobs()).reminders).toBe(2);
    env.setNow('2026-11-16T02:31:00Z'); // 09:31 = office start + 30
    const r1 = await jobs();
    expect(r1.reminders).toBe(5); // office shift: Budi, Rina, Agus, Maya, Tono (Sari is present)
    expect((await jobs()).reminders).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = 'sari@keypresence.test' AND n.type = 'reminder_checkin'")).toBe(0);

    env.setNow('2026-11-16T10:01:00Z'); // 17:01, after shift end
    const r2 = await jobs();
    expect(r2.absences).toBeGreaterThan(0);
    const absent = await env.db.query<any>('SELECT u.email FROM absences a JOIN users u ON u.id = a.user_id ORDER BY 1');
    expect(absent.map((a) => a.email)).not.toContain('sari@keypresence.test');
    expect((await jobs()).absences).toBe(0);
  });

  it('does not record absences on a weekend', async () => {
    env.setNow('2026-11-15T12:00:00Z'); // Sunday
    expect((await jobs()).absences).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM absences')).toBe(0);
  });

  it('catches up yesterday if the job did not run that evening', async () => {
    env.setNow('2026-11-17T01:00:00Z'); // Tuesday 08:00; Monday had no jobs run
    const r = await jobs();
    expect(r.absences).toBe(8);
    expect((await env.db.query<any>("SELECT DISTINCT day FROM absences"))[0].day).toBe('2026-11-16');
  });

  it('reminds to check out once when still checked in after shift end', async () => {
    const sari = await env.login('sari@keypresence.test');
    env.setNow('2026-11-16T02:00:00Z');
    await env.call(sari, 'POST', '/api/checkins/in', { token: await env.siteToken(env.ids.siteHq), kind: 'attendance', ...insideFix(env) });
    env.setNow('2026-11-16T10:31:00Z'); // 17:31
    await jobs(); await jobs();
    expect(await count("SELECT count(*)::int AS n FROM notifications WHERE type = 'reminder_checkout'")).toBe(1);
  });
});

describe('summaries', () => {
  it('creates a daily summary after the configured hour and notifies admins once; weekly summary once per week', async () => {
    env.setNow('2026-11-18T02:20:00Z'); // Wed 09:20 -> late
    const sari = await env.login('sari@keypresence.test');
    await env.call(sari, 'POST', '/api/checkins/in', { token: await env.siteToken(env.ids.siteHq), kind: 'attendance', ...insideFix(env) });
    env.setNow('2026-11-18T11:30:00Z'); // 18:30 >= 18:00
    const r = await jobs();
    expect(r.summaries).toBeGreaterThanOrEqual(1);
    const s = (await env.db.query<any>("SELECT data FROM daily_summaries WHERE day = '2026-11-18'"))[0].data;
    expect(s.attendance.lateCount).toBe(1);
    expect(s.attendance.presentDays).toBe(1);
    await jobs();
    expect(await count("SELECT count(*)::int AS n FROM notifications WHERE type = 'daily_summary' AND dedupe_key = 'daily-summary:2026-11-18:live'")).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM notifications WHERE type = 'weekly_summary'")).toBe(1);
  });
});

describe('retention', () => {
  it('strips coordinates older than the retention window but keeps the record, distance and flags', async () => {
    env.setNow('2026-08-03T02:00:00Z');
    const sari = await env.login('sari@keypresence.test');
    await env.call(sari, 'POST', '/api/checkins/in', { token: await env.siteToken(env.ids.siteHq), kind: 'attendance', ...insideFix(env) });
    env.setNow('2026-11-16T02:00:00Z'); // 105 days later, retention 90
    const r = await jobs();
    expect(r.retained).toBe(1);
    const row = (await env.db.query<any>('SELECT * FROM checkins'))[0];
    expect(row.in_lat).toBeNull();
    expect(row.in_lng).toBeNull();
    expect(row.in_distance_m).toBeGreaterThan(0);
    expect((await jobs()).retained).toBe(0);
  });
  it('keeps recent coordinates', async () => {
    env.setNow('2026-11-10T02:00:00Z');
    const sari = await env.login('sari@keypresence.test');
    await env.call(sari, 'POST', '/api/checkins/in', { token: await env.siteToken(env.ids.siteHq), kind: 'attendance', ...insideFix(env) });
    env.setNow('2026-11-16T02:00:00Z');
    expect((await jobs()).retained).toBe(0);
    expect((await env.db.query<any>('SELECT in_lat FROM checkins'))[0].in_lat).not.toBeNull();
  });
});
