import type { Db } from '../db';
import { addDays, zonedToUtc } from './time';

export interface Summary {
  from: string; to: string;
  attendance: {
    presentDays: number; checkins: number; lateCount: number; lateMinutes: number;
    overtimeCount: number; overtimeMinutes: number; avgWorkMinutes: number | null;
    flagged: number; autoClosed: number; stillOpen: number; absentDays: number;
  };
  byKind: Record<string, number>;
  bySite: { site: string; checkins: number }[];
  byDay: { day: string; checkins: number; late: number; absent: number }[];
  rejectedAttempts: number;
  pendingReviews: number;
  pendingCorrections: number;
}

/** Aggregate over a local-day range (inclusive). A daily summary is from === to. */
export async function computeSummary(db: Db, tz: string, from: string, to: string): Promise<Summary> {
  const [a] = await db.query<any>(
    `SELECT count(DISTINCT (user_id, day))::int AS present_days, count(*)::int AS checkins,
            count(*) FILTER (WHERE late_minutes > 0)::int AS late_count, coalesce(sum(late_minutes),0)::int AS late_minutes,
            count(*) FILTER (WHERE overtime_minutes > 0)::int AS ot_count, coalesce(sum(overtime_minutes),0)::int AS ot_minutes,
            round(avg(work_minutes))::int AS avg_work,
            count(*) FILTER (WHERE cardinality(in_flags) + cardinality(out_flags) > 0)::int AS flagged,
            count(*) FILTER (WHERE closed_by = 'auto')::int AS auto_closed,
            count(*) FILTER (WHERE status = 'open')::int AS still_open
       FROM checkins WHERE kind = 'attendance' AND day BETWEEN $1 AND $2`, [from, to]);
  const [abs] = await db.query<any>('SELECT count(*)::int AS n FROM absences WHERE day BETWEEN $1 AND $2', [from, to]);
  const kinds = await db.query<{ kind: string; n: number }>(
    'SELECT kind, count(*)::int AS n FROM checkins WHERE day BETWEEN $1 AND $2 GROUP BY kind', [from, to]);
  const sites = await db.query<{ site: string; n: number }>(
    `SELECT s.name AS site, count(*)::int AS n FROM checkins c JOIN sites s ON s.id = c.site_id
      WHERE c.day BETWEEN $1 AND $2 GROUP BY s.name ORDER BY n DESC, s.name`, [from, to]);
  const days = await db.query<{ day: string; checkins: number; late: number }>(
    `SELECT day, count(*)::int AS checkins, count(*) FILTER (WHERE late_minutes > 0)::int AS late
       FROM checkins WHERE kind = 'attendance' AND day BETWEEN $1 AND $2 GROUP BY day`, [from, to]);
  const absDays = await db.query<{ day: string; n: number }>(
    'SELECT day, count(*)::int AS n FROM absences WHERE day BETWEEN $1 AND $2 GROUP BY day', [from, to]);
  const [rej] = await db.query<any>(
    "SELECT count(*)::int AS n FROM attempts WHERE outcome = 'rejected' AND at >= $1 AND at < $2",
    [zonedToUtc(from, '00:00', tz), zonedToUtc(addDays(to, 1), '00:00', tz)]);
  const [pr] = await db.query<any>("SELECT count(*)::int AS n FROM checkins WHERE review_status = 'pending'");
  const [pc] = await db.query<any>("SELECT count(*)::int AS n FROM corrections WHERE status = 'pending'");

  const dayMap = new Map<string, { day: string; checkins: number; late: number; absent: number }>();
  for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++) dayMap.set(d, { day: d, checkins: 0, late: 0, absent: 0 });
  for (const r of days) { const e = dayMap.get(r.day); if (e) { e.checkins = r.checkins; e.late = r.late; } }
  for (const r of absDays) { const e = dayMap.get(r.day); if (e) e.absent = r.n; }

  return {
    from, to,
    attendance: {
      presentDays: a.present_days, checkins: a.checkins, lateCount: a.late_count, lateMinutes: a.late_minutes,
      overtimeCount: a.ot_count, overtimeMinutes: a.ot_minutes, avgWorkMinutes: a.avg_work,
      flagged: a.flagged, autoClosed: a.auto_closed, stillOpen: a.still_open, absentDays: abs.n,
    },
    byKind: Object.fromEntries(kinds.map((k) => [k.kind, k.n])),
    bySite: sites.map((s) => ({ site: s.site, checkins: s.n })),
    byDay: [...dayMap.values()],
    rejectedAttempts: rej.n,
    pendingReviews: pr.n,
    pendingCorrections: pc.n,
  };
}
