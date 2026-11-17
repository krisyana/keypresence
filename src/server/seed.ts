import type { Deps } from './deps';
import { hashPassword } from './auth';
import { newSiteSecret } from './domain/qr';
import { computeMetrics, shiftEndUtc, shiftStartUtc, type ShiftRule } from './domain/shifts';
import { addDays, isoDowOfDay, localParts } from './domain/time';

/** Fictional demo data. All people, emails (.test is a reserved TLD) and places are invented. */
export const DEMO_PASSWORD = 'demo-password-1';

const PEOPLE = [
  ['Sari Wulandari', 'sari@keypresence.test'], ['Budi Santoso', 'budi@keypresence.test'], ['Rina Maharani', 'rina@keypresence.test'],
  ['Dewi Lestari', 'dewi@keypresence.test'], ['Agus Pratama', 'agus@keypresence.test'], ['Maya Kusuma', 'maya@keypresence.test'],
  ['Tono Hartono', 'tono@keypresence.test'], ['Lina Susanti', 'lina@keypresence.test'],
] as const;

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedResult { adminEmail: string; password: string; employees: string[]; siteIds: string[] }

export async function seedDemo(deps: Deps, opts: { history?: boolean; today?: boolean } = {}): Promise<SeedResult> {
  const { db, clock } = deps;
  const now = clock();
  const tz = 'Asia/Jakarta';
  const hash = await hashPassword(DEMO_PASSWORD);

  const shifts = await db.query<ShiftRule & { id: string }>(
    `INSERT INTO shifts(name, start_time, end_time, grace_minutes, overtime_after_minutes, auto_close_after_minutes)
     VALUES ('Office hours','09:00','17:00',10,15,120), ('Early shift','07:00','15:00',10,15,120) RETURNING *`);
  const office = shifts[0]!, early = shifts[1]!;

  const sites = await db.query<{ id: string }>(
    `INSERT INTO sites(name, lat, lng, radius_m, max_accuracy_m, enforcement, qr_secret) VALUES
      ('Head Office (demo)', -6.175392, 106.827153, 120, 50, 'reject', $1),
      ('Warehouse (demo)', -6.214621, 106.845130, 200, 80, 'flag', $2) RETURNING id`, [newSiteSecret(), newSiteSecret()]);
  const hq = sites[0]!.id;

  const admin = await db.query<{ id: string }>(
    "INSERT INTO users(email, name, role, password_hash, location_consent_at) VALUES ('admin@keypresence.test','Admin Demo','admin',$1,$2) RETURNING id", [hash, now]);
  void admin;
  const emp: { id: string; shift: ShiftRule }[] = [];
  for (const [i, [name, email]] of PEOPLE.entries()) {
    const shift = i % 4 === 3 ? early : office;
    const r = await db.query<{ id: string }>(
      "INSERT INTO users(email, name, role, password_hash, shift_id, location_consent_at, created_at) VALUES ($1,$2,'employee',$3,$4,$5,$6) RETURNING id",
      [email, name, hash, shift.id, now, new Date(now.getTime() - 40 * 86400000)]);
    emp.push({ id: r[0]!.id, shift });
  }

  if (opts.history !== false) {
    const rand = rng(42);
    const today = localParts(now, tz).day;
    for (let back = 14; back >= 1; back--) {
      const day = addDays(today, -back);
      if (isoDowOfDay(day) > 5) continue;
      for (const e of emp) {
        const r = rand();
        if (r < 0.06) {
          await db.query('INSERT INTO absences(user_id, day, shift_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [e.id, day, e.shift.id]);
          continue;
        }
        const start = shiftStartUtc(e.shift, day, tz), end = shiftEndUtc(e.shift, day, tz);
        const late = rand() < 0.18;
        const inAt = new Date(start.getTime() + (late ? (12 + Math.floor(rand() * 40)) : Math.floor(rand() * 8) - 10) * 60000);
        const forgot = rand() < 0.07;
        const overtime = !forgot && rand() < 0.15;
        const outAt = forgot ? end : new Date(end.getTime() + (overtime ? 20 + Math.floor(rand() * 90) : Math.floor(rand() * 10) - 5) * 60000);
        const flagged = rand() < 0.06;
        const m = computeMetrics(e.shift, inAt, outAt, tz);
        const jitter = () => (rand() - 0.5) * 0.0004;
        await db.query(
          `INSERT INTO checkins(user_id, site_id, kind, status, day, check_in_at, check_out_at, in_lat, in_lng, in_accuracy_m, in_distance_m,
                                out_lat, out_lng, out_accuracy_m, out_distance_m, in_flags, out_flags, review_status, closed_by, shift_id,
                                late_minutes, overtime_minutes, work_minutes)
           VALUES ($1,$2,'attendance','closed',$3,$4,$5,$6,$7,12.5,18.2,$8,$9,14.1,20.4,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [e.id, hq, day, inAt, outAt, -6.175392 + jitter(), 106.827153 + jitter(), forgot ? null : -6.175392 + jitter(), forgot ? null : 106.827153 + jitter(),
            flagged ? ['LOW_ACCURACY'] : [], forgot ? ['AUTO_CLOSED'] : [], flagged || forgot ? 'pending' : 'none', forgot ? 'auto' : 'user', e.shift.id,
            m.lateMinutes, m.overtimeMinutes, m.workMinutes]);
      }
    }
  }
  if (opts.today) {
    // Make the overview alive in a demo: people whose shift has started are already checked in; finished shifts are closed.
    const rand = rng(7);
    const today = localParts(now, tz).day;
    if (isoDowOfDay(today) <= 5) {
      for (const e of emp) {
        const start = shiftStartUtc(e.shift, today, tz), end = shiftEndUtc(e.shift, today, tz);
        const late = rand() < 0.25;
        const inAt = new Date(start.getTime() + (late ? 14 + Math.floor(rand() * 30) : Math.floor(rand() * 8) - 10) * 60000);
        if (inAt > now || rand() < 0.1) continue;
        const outAt = end < now ? new Date(end.getTime() + Math.floor(rand() * 10) * 60000) : null;
        const m = computeMetrics(e.shift, inAt, outAt ?? now, tz);
        await db.query(
          `INSERT INTO checkins(user_id, site_id, kind, status, day, check_in_at, check_out_at, in_lat, in_lng, in_accuracy_m, in_distance_m, in_flags, out_flags, review_status, shift_id, late_minutes)
           VALUES ($1,$2,'attendance',$3,$4,$5,$6,-6.175392,106.827153,12.5,18.2,'{}','{}','none',$7,$8)`,
          [e.id, hq, outAt ? 'closed' : 'open', today, inAt, outAt, e.shift.id, m.lateMinutes]);
      }
    }
  }
  return { adminEmail: 'admin@keypresence.test', password: DEMO_PASSWORD, employees: PEOPLE.map((p) => p[1]), siteIds: sites.map((s) => s.id) };
}
