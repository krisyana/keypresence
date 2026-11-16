import type { Deps } from '../deps';
import { audit, notify } from '../audit';
import { getSettings } from '../settings';
import { computeMetrics, shiftEndUtc, shiftStartUtc, type ShiftRule } from '../domain/shifts';
import { computeSummary } from '../domain/summary';
import { addDays, isoDowOfDay, localParts, startOfIsoWeek, zonedToUtc } from '../domain/time';

/**
 * Every job is idempotent: it can run every minute, twice, or late, and converges to the same state.
 * Idempotency comes from unique keys (absences PK, notifications dedupe_key, job_runs PK), not from timing.
 */
export interface JobResult {
  autoClosed: number; absences: number; reminders: number; summaries: number; retained: number; purged: number;
}

export async function runJobs(deps: Deps): Promise<JobResult> {
  const { db, clock } = deps;
  const now = clock();
  const s = await getSettings(db);
  const tz = s.timezone;
  const today = localParts(now, tz).day;
  const res: JobResult = { autoClosed: 0, absences: 0, reminders: 0, summaries: 0, retained: 0, purged: 0 };

  const shifts = await db.query<ShiftRule & { name: string; active: boolean }>('SELECT * FROM shifts WHERE active');
  const byId = new Map(shifts.map((x) => [x.id, x]));

  // 1. Auto-close forgotten check-outs: attendance with a shift, shift end + delay has passed.
  const open = await db.query<any>("SELECT * FROM checkins WHERE status = 'open' AND kind = 'attendance' AND shift_id IS NOT NULL");
  for (const c of open) {
    const shift = byId.get(c.shift_id);
    if (!shift) continue;
    const end = shiftEndUtc(shift, c.day, tz);
    const deadline = new Date(end.getTime() + shift.auto_close_after_minutes * 60000);
    if (now < deadline) continue;
    const closeAt = end > new Date(c.check_in_at) ? end : new Date(c.check_in_at);
    const m = computeMetrics(shift, new Date(c.check_in_at), closeAt, tz);
    const done = await db.tx(async (t) => {
      const r = await t.query(
        `UPDATE checkins SET status = 'closed', closed_by = 'auto', check_out_at = $2, out_flags = ARRAY['AUTO_CLOSED'],
                review_status = 'pending', overtime_minutes = $3, work_minutes = $4
          WHERE id = $1 AND status = 'open' RETURNING id`, [c.id, closeAt, m.overtimeMinutes, m.workMinutes]);
      if (!r.length) return false;
      await audit(t, null, 'AUTO_CLOSE', 'checkin', c.id, { closedAt: closeAt.toISOString() });
      await notify(t, c.user_id, 'auto_close', 'Check-out recorded automatically',
        `You did not check out on ${c.day}. It was closed at shift end (${closeAt.toISOString().slice(11, 16)} UTC) and marked for review. You can request a correction.`, `auto-close:${c.id}`);
      return true;
    });
    if (done) res.autoClosed++;
  }

  // 2. Absences and reminders for yesterday (catch-up) and today.
  const employees = await db.query<any>("SELECT id, name, shift_id, created_at FROM users WHERE active AND role = 'employee' AND shift_id IS NOT NULL");
  for (const day of [addDays(today, -1), today]) {
    const dow = isoDowOfDay(day);
    const present = new Set((await db.query<{ user_id: string }>("SELECT DISTINCT user_id FROM checkins WHERE kind = 'attendance' AND day = $1", [day])).map((r) => r.user_id));
    for (const u of employees) {
      const shift = byId.get(u.shift_id);
      if (!shift || !shift.work_days.includes(dow) || present.has(u.id)) continue;
      const start = shiftStartUtc(shift, day, tz), end = shiftEndUtc(shift, day, tz);
      if (new Date(u.created_at) > end) continue;
      if (now >= end) {
        const r = await db.query('INSERT INTO absences(user_id, day, shift_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id', [u.id, day, shift.id]);
        if (r.length) {
          res.absences++;
          await notify(db, u.id, 'absence', 'Absence recorded', `No attendance check-in was found for ${day}. If this is wrong, ask HR for a correction.`, `absence:${day}`);
        }
      } else if (now >= new Date(start.getTime() + s.missing_checkin_reminder_minutes * 60000)) {
        if (await notify(db, u.id, 'reminder_checkin', 'You have not checked in', `Your shift started at ${shift.start_time.slice(0, 5)}. Scan the site QR to check in.`, `missing-in:${day}`)) res.reminders++;
      }
    }
  }
  const stillIn = await db.query<any>("SELECT id, user_id, day, shift_id FROM checkins WHERE status = 'open' AND kind = 'attendance' AND shift_id IS NOT NULL");
  for (const c of stillIn) {
    const shift = byId.get(c.shift_id);
    if (!shift) continue;
    const end = shiftEndUtc(shift, c.day, tz);
    if (now >= new Date(end.getTime() + s.checkout_reminder_minutes * 60000)) {
      if (await notify(db, c.user_id, 'reminder_checkout', 'Still checked in?', 'Your shift has ended. Scan the site QR to check out, or it will be closed automatically.', `still-in:${c.id}`)) res.reminders++;
    }
  }

  // 3. Summaries: today (after the configured hour) and yesterday (final, once).
  const hour = localParts(now, tz).hh;
  const admins = await db.query<{ id: string }>("SELECT id FROM users WHERE role = 'admin' AND active");
  const summaryDays: string[] = [];
  const y = addDays(today, -1);
  if (!(await db.query('SELECT 1 FROM job_runs WHERE job = $1 AND key = $2', ['daily_summary_final', y])).length) summaryDays.push(y);
  if (hour >= s.daily_summary_hour) summaryDays.push(today);
  for (const day of summaryDays) {
    const sum = await computeSummary(db, tz, day, day);
    await db.query(
      'INSERT INTO daily_summaries(day, data) VALUES ($1, $2::jsonb) ON CONFLICT (day) DO UPDATE SET data = EXCLUDED.data, generated_at = now()',
      [day, JSON.stringify(sum)]);
    if (day === y) await db.query("INSERT INTO job_runs(job, key, result) VALUES ('daily_summary_final', $1, $2::jsonb) ON CONFLICT DO NOTHING", [y, JSON.stringify(sum.attendance)]);
    const a = sum.attendance;
    for (const ad of admins) {
      await notify(db, ad.id, 'daily_summary', `Daily summary ${day}`,
        `${a.presentDays} present, ${a.lateCount} late, ${a.absentDays} absent, ${a.overtimeCount} overtime, ${a.flagged} flagged, ${a.autoClosed} auto-closed, ${sum.pendingReviews} awaiting review.`,
        `daily-summary:${day}${day === today ? ':live' : ':final'}`);
    }
    res.summaries++;
  }
  // Weekly summary on the first run of a new ISO week, for the week that just ended.
  const thisWeek = startOfIsoWeek(today), lastWeek = addDays(thisWeek, -7);
  const weekDone = (await db.query('SELECT 1 FROM job_runs WHERE job = $1 AND key = $2', ['weekly_summary', lastWeek])).length > 0;
  if (!weekDone) {
    const w = await computeSummary(db, tz, lastWeek, addDays(lastWeek, 6));
    const a = w.attendance;
    for (const ad of admins) {
      await notify(db, ad.id, 'weekly_summary', `Weekly summary ${lastWeek} to ${addDays(lastWeek, 6)}`,
        `${a.presentDays} present-days, ${a.lateCount} late arrivals (${a.lateMinutes} min), ${a.absentDays} absent-days, ${a.overtimeMinutes} overtime minutes, ${a.flagged} flagged.`, `weekly-summary:${lastWeek}`);
    }
    await db.query("INSERT INTO job_runs(job, key, result) VALUES ('weekly_summary', $1, $2::jsonb) ON CONFLICT DO NOTHING", [lastWeek, JSON.stringify(a)]);
    res.summaries++;
  }

  // 4. Retention (ADR-0006): strip precise coordinates and old attempts; drop expired sessions.
  const cutoffDay = addDays(today, -s.coord_retention_days);
  const stripped = await db.query(
    `UPDATE checkins SET in_lat = NULL, in_lng = NULL, out_lat = NULL, out_lng = NULL
      WHERE day < $1 AND (in_lat IS NOT NULL OR out_lat IS NOT NULL) RETURNING id`, [cutoffDay]);
  res.retained = stripped.length;
  const cutoffTs = zonedToUtc(cutoffDay, '00:00', tz);
  const a1 = await db.query('DELETE FROM attempts WHERE at < $1 RETURNING id', [cutoffTs]);
  const s1 = await db.query('DELETE FROM sessions WHERE expires_at < $1 RETURNING token_hash', [now]);
  res.purged = a1.length + s1.length;
  if (res.retained) await audit(db, null, 'RETENTION', 'checkin', null, { stripped: res.retained, cutoffDay });
  return res;
}

export function startScheduler(deps: Deps, log: (m: string) => void = console.log, everyMs = 60_000) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runJobs(deps); } catch (e) { log(`jobs failed: ${e instanceof Error ? e.message : e}`); } finally { running = false; }
  };
  const h = setInterval(tick, everyMs);
  h.unref();
  void tick();
  return () => clearInterval(h);
}
