import { Hono } from 'hono';
import { z } from 'zod';
import QRCode from 'qrcode';
import { ApiError, KINDS, type Deps } from '../deps';
import { body, parse, toCsv } from '../http';
import { hashPassword, type Env } from '../auth';
import { audit, notify } from '../audit';
import { applyTimes, loadShift } from '../domain/checkin';
import { newSiteSecret, signToken } from '../domain/qr';
import { computeMetrics } from '../domain/shifts';
import { computeSummary } from '../domain/summary';
import { addDays, localParts } from '../domain/time';
import { getSettings, updateSettings } from '../settings';
import { runJobs } from '../jobs';
import { aliasFor } from '../ai/guard';
import { anthropicPlanner, ask, detectAnomalies, rulePlanner, type Planner } from '../ai';
import { isUniqueViolation } from '../db';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const iso = z.iso.datetime({ offset: true });
const uuid = z.uuid();

const siteBase = z.object({
  name: z.string().trim().min(2).max(80),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(5).max(5000),
  maxAccuracyM: z.number().int().min(5).max(1000).default(50),
  enforcement: z.enum(['reject', 'flag', 'off']).default('reject'),
  active: z.boolean().default(true),
});
const shiftBase = z.object({
  name: z.string().trim().min(2).max(60),
  startTime: time,
  endTime: time,
  graceMinutes: z.number().int().min(0).max(120).default(10),
  overtimeAfterMinutes: z.number().int().min(0).max(240).default(15),
  autoCloseAfterMinutes: z.number().int().min(15).max(720).default(120),
  workDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).default([1, 2, 3, 4, 5]),
  active: z.boolean().default(true),
});
const password = z.string().min(10).max(200);

function dup(e: unknown, msg: string): never {
  if (isUniqueViolation(e)) throw new ApiError(409, 'DUPLICATE', msg);
  throw e;
}

export function adminRoutes(deps: Deps, planner?: Planner) {
  const { db, clock, config } = deps;
  const app = new Hono<Env>();
  const actor = (c: any) => c.get('user').id as string;
  const pl = planner ?? (config.aiProvider === 'anthropic' && config.anthropicApiKey ? anthropicPlanner(config.anthropicApiKey) : rulePlanner);

  // ---- employees ----
  app.get('/employees', async (c) => {
    const rows = await db.query<any>(
      `SELECT u.id, u.email, u.name, u.role, u.active, u.shift_id, sh.name AS shift_name, u.location_consent_at, u.created_at
         FROM users u LEFT JOIN shifts sh ON sh.id = u.shift_id ORDER BY u.name`);
    return c.json({ items: rows.map((r) => ({ ...r, alias: aliasFor(config.masterSecret, r.id) })) });
  });
  app.post('/employees', async (c) => {
    const b = await body(c, z.object({ email: z.email().max(200), name: z.string().trim().min(2).max(100), role: z.enum(['admin', 'employee']).default('employee'), password, shiftId: uuid.nullish() }));
    try {
      const r = await db.query<any>('INSERT INTO users(email, name, role, password_hash, shift_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, email, name, role, active, shift_id',
        [b.email, b.name, b.role, await hashPassword(b.password), b.shiftId ?? null]);
      await audit(db, actor(c), 'EMPLOYEE_CREATE', 'user', r[0].id, { role: b.role });
      return c.json(r[0], 201);
    } catch (e) { dup(e, 'That email is already in use.'); }
  });
  app.patch('/employees/:id', async (c) => {
    const id = parse(uuid, c.req.param('id'));
    const b = await body(c, z.object({ name: z.string().trim().min(2).max(100), role: z.enum(['admin', 'employee']), active: z.boolean(), shiftId: uuid.nullable(), password }).partial().strict());
    if (id === actor(c) && (b.active === false || b.role === 'employee')) throw new ApiError(409, 'SELF_LOCKOUT', 'You cannot deactivate or demote yourself.');
    const cur = (await db.query<any>('SELECT * FROM users WHERE id = $1', [id]))[0];
    if (!cur) throw new ApiError(404, 'NOT_FOUND');
    const next = {
      name: b.name ?? cur.name, role: b.role ?? cur.role, active: b.active ?? cur.active,
      shift_id: b.shiftId === undefined ? cur.shift_id : b.shiftId,
      password_hash: b.password ? await hashPassword(b.password) : cur.password_hash,
    };
    await db.tx(async (t) => {
      await t.query('UPDATE users SET name=$2, role=$3, active=$4, shift_id=$5, password_hash=$6 WHERE id=$1', [id, next.name, next.role, next.active, next.shift_id, next.password_hash]);
      if (b.password || b.active === false) await t.query('DELETE FROM sessions WHERE user_id = $1', [id]);
      await audit(t, actor(c), 'EMPLOYEE_UPDATE', 'user', id, { fields: Object.keys(b).filter((k) => k !== 'password'), passwordChanged: !!b.password });
    });
    return c.json({ ok: true });
  });

  // ---- sites and QR ----
  const siteOut = (s: any) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, radiusM: s.radius_m, maxAccuracyM: s.max_accuracy_m, enforcement: s.enforcement, active: s.active, qrEpoch: s.qr_epoch, qrRotatedAt: s.qr_rotated_at });
  app.get('/sites', async (c) => c.json({ items: (await db.query('SELECT * FROM sites ORDER BY name')).map(siteOut) }));
  app.post('/sites', async (c) => {
    const b = await body(c, siteBase);
    try {
      const r = await db.query(
        'INSERT INTO sites(name, lat, lng, radius_m, max_accuracy_m, enforcement, active, qr_secret) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [b.name, b.lat, b.lng, b.radiusM, b.maxAccuracyM, b.enforcement, b.active, newSiteSecret()]);
      await audit(db, actor(c), 'SITE_CREATE', 'site', r[0].id, { name: b.name, radiusM: b.radiusM, enforcement: b.enforcement });
      return c.json(siteOut(r[0]), 201);
    } catch (e) { dup(e, 'A site with that name exists.'); }
  });
  app.patch('/sites/:id', async (c) => {
    const id = parse(uuid, c.req.param('id'));
    const b = await body(c, siteBase.partial().strict());
    const cur = (await db.query<any>('SELECT * FROM sites WHERE id = $1', [id]))[0];
    if (!cur) throw new ApiError(404, 'NOT_FOUND');
    const n = { name: b.name ?? cur.name, lat: b.lat ?? cur.lat, lng: b.lng ?? cur.lng, radius_m: b.radiusM ?? cur.radius_m, max_accuracy_m: b.maxAccuracyM ?? cur.max_accuracy_m, enforcement: b.enforcement ?? cur.enforcement, active: b.active ?? cur.active };
    try {
      await db.tx(async (t) => {
        await t.query('UPDATE sites SET name=$2, lat=$3, lng=$4, radius_m=$5, max_accuracy_m=$6, enforcement=$7, active=$8 WHERE id=$1', [id, n.name, n.lat, n.lng, n.radius_m, n.max_accuracy_m, n.enforcement, n.active]);
        await audit(t, actor(c), 'SITE_UPDATE', 'site', id, { before: { lat: cur.lat, lng: cur.lng, radiusM: cur.radius_m, maxAccuracyM: cur.max_accuracy_m, enforcement: cur.enforcement, active: cur.active }, after: { lat: n.lat, lng: n.lng, radiusM: n.radius_m, maxAccuracyM: n.max_accuracy_m, enforcement: n.enforcement, active: n.active } });
      });
    } catch (e) { dup(e, 'A site with that name exists.'); }
    return c.json({ ok: true });
  });
  app.get('/sites/:id/qr', async (c) => {
    const id = parse(uuid, c.req.param('id'));
    const site = (await db.query<any>('SELECT * FROM sites WHERE id = $1', [id]))[0];
    if (!site) throw new ApiError(404, 'NOT_FOUND');
    const s = await getSettings(db);
    const today = localParts(clock(), s.timezone).day;
    const token = signToken(config.masterSecret, site, today);
    const url = `${config.appUrl}/s/${token}`;
    const svg = await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
    return c.json({ siteName: site.name, day: today, epoch: site.qr_epoch, url, svg });
  });
  app.post('/sites/:id/qr/rotate', async (c) => {
    const id = parse(uuid, c.req.param('id'));
    const r = await db.query<any>('UPDATE sites SET qr_secret = $2, qr_epoch = qr_epoch + 1, qr_rotated_at = $3 WHERE id = $1 RETURNING qr_epoch', [id, newSiteSecret(), clock()]);
    if (!r.length) throw new ApiError(404, 'NOT_FOUND');
    await audit(db, actor(c), 'QR_ROTATE', 'site', id, { epoch: r[0].qr_epoch });
    return c.json({ epoch: r[0].qr_epoch });
  });

  // ---- shifts ----
  const shiftOut = (s: any) => ({ id: s.id, name: s.name, startTime: s.start_time.slice(0, 5), endTime: s.end_time.slice(0, 5), graceMinutes: s.grace_minutes, overtimeAfterMinutes: s.overtime_after_minutes, autoCloseAfterMinutes: s.auto_close_after_minutes, workDays: s.work_days, active: s.active });
  app.get('/shifts', async (c) => c.json({ items: (await db.query('SELECT * FROM shifts ORDER BY start_time, name')).map(shiftOut) }));
  const validShift = (b: { startTime: string; endTime: string }) => { if (b.endTime <= b.startTime) throw new ApiError(400, 'VALIDATION', 'End time must be after start time (overnight shifts are not supported in v1).'); };
  app.post('/shifts', async (c) => {
    const b = await body(c, shiftBase);
    validShift(b);
    try {
      const r = await db.query('INSERT INTO shifts(name, start_time, end_time, grace_minutes, overtime_after_minutes, auto_close_after_minutes, work_days, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [b.name, b.startTime, b.endTime, b.graceMinutes, b.overtimeAfterMinutes, b.autoCloseAfterMinutes, [...new Set(b.workDays)].sort(), b.active]);
      await audit(db, actor(c), 'SHIFT_CREATE', 'shift', r[0].id, { name: b.name });
      return c.json(shiftOut(r[0]), 201);
    } catch (e) { dup(e, 'A shift with that name exists.'); }
  });
  app.patch('/shifts/:id', async (c) => {
    const id = parse(uuid, c.req.param('id'));
    const p = await body(c, shiftBase.partial().strict());
    const cur = (await db.query<any>('SELECT * FROM shifts WHERE id = $1', [id]))[0];
    if (!cur) throw new ApiError(404, 'NOT_FOUND');
    const b = { ...shiftOut(cur), ...p };
    validShift(b);
    try {
      await db.query('UPDATE shifts SET name=$2, start_time=$3, end_time=$4, grace_minutes=$5, overtime_after_minutes=$6, auto_close_after_minutes=$7, work_days=$8, active=$9 WHERE id=$1',
        [id, b.name, b.startTime, b.endTime, b.graceMinutes, b.overtimeAfterMinutes, b.autoCloseAfterMinutes, [...new Set(b.workDays)].sort(), b.active]);
    } catch (e) { dup(e, 'A shift with that name exists.'); }
    await audit(db, actor(c), 'SHIFT_UPDATE', 'shift', id, { fields: Object.keys(p) });
    return c.json({ ok: true });
  });

  // ---- records ----
  const listQuery = z.object({
    from: day.optional(), to: day.optional(), siteId: uuid.optional(), userId: uuid.optional(), kind: z.enum(KINDS).optional(),
    flagged: z.enum(['1']).optional(), review: z.enum(['pending', 'reviewed', 'none']).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0),
  });
  const recordsSql = (q: z.infer<typeof listQuery>, coords: boolean) => {
    const params: unknown[] = [];
    const w: string[] = [];
    const add = (cond: string, v: unknown) => { params.push(v); w.push(cond.replace('?', `$${params.length}`)); };
    if (q.from) add('c.day >= ?', q.from);
    if (q.to) add('c.day <= ?', q.to);
    if (q.siteId) add('c.site_id = ?', q.siteId);
    if (q.userId) add('c.user_id = ?', q.userId);
    if (q.kind) add('c.kind = ?', q.kind);
    if (q.review) add('c.review_status = ?', q.review);
    if (q.flagged) w.push('cardinality(c.in_flags) + cardinality(c.out_flags) > 0');
    const cols = `c.id, c.user_id, u.name AS user_name, u.email AS user_email, s.name AS site_name, c.kind, c.subject_ref, c.day, c.status,
      c.check_in_at, c.check_out_at, c.in_distance_m, c.out_distance_m, c.in_accuracy_m, c.out_accuracy_m, c.in_flags, c.out_flags, c.review_status, c.review_note,
      c.closed_by, c.late_minutes, c.overtime_minutes, c.work_minutes, c.override_reason${coords ? ', c.in_lat, c.in_lng, c.out_lat, c.out_lng' : ''}`;
    return { cols, where: w.length ? 'WHERE ' + w.join(' AND ') : '', params };
  };
  app.get('/checkins', async (c) => {
    const q = parse(listQuery, c.req.query());
    const { cols, where, params } = recordsSql(q, false);
    const items = await db.query(`SELECT ${cols} FROM checkins c JOIN users u ON u.id = c.user_id JOIN sites s ON s.id = c.site_id ${where} ORDER BY c.check_in_at DESC LIMIT ${q.limit} OFFSET ${q.offset}`, params);
    const [t] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM checkins c ${where}`, params);
    return c.json({ items, total: t.n });
  });
  app.get('/checkins/export.csv', async (c) => {
    const q = parse(listQuery.extend({ coords: z.enum(['1']).optional() }), c.req.query());
    const coords = q.coords === '1';
    const { cols, where, params } = recordsSql(q, coords);
    const rows = await db.query<any>(`SELECT ${cols} FROM checkins c JOIN users u ON u.id = c.user_id JOIN sites s ON s.id = c.site_id ${where} ORDER BY c.check_in_at DESC LIMIT 10000`, params);
    await audit(db, actor(c), 'CSV_EXPORT', 'checkin', null, { rows: rows.length, coords, from: q.from ?? null, to: q.to ?? null });
    const header = ['day', 'employee', 'email', 'site', 'kind', 'reference', 'check_in', 'check_out', 'work_minutes', 'late_minutes', 'overtime_minutes', 'flags', 'review', 'closed_by', ...(coords ? ['in_lat', 'in_lng', 'out_lat', 'out_lng'] : [])];
    const out = toCsv(header, rows.map((r) => [r.day, r.user_name, r.user_email, r.site_name, r.kind, r.subject_ref, r.check_in_at, r.check_out_at, r.work_minutes, r.late_minutes, r.overtime_minutes, [...r.in_flags, ...r.out_flags], r.review_status, r.closed_by, ...(coords ? [r.in_lat, r.in_lng, r.out_lat, r.out_lng] : [])]));
    return new Response(out, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="keypresence-${localParts(clock(), 'UTC').day}.csv"` } });
  });
  app.patch('/checkins/:id/review', async (c) => {
    const id = parse(uuid, c.req.param('id'));
    const { note } = await body(c, z.object({ note: z.string().trim().min(3).max(300) }));
    const r = await db.query("UPDATE checkins SET review_status = 'reviewed', review_note = $2, reviewed_by = $3, reviewed_at = $4 WHERE id = $1 RETURNING user_id", [id, note, actor(c), clock()]);
    if (!r.length) throw new ApiError(404, 'NOT_FOUND');
    await audit(db, actor(c), 'REVIEW', 'checkin', id, { note });
    return c.json({ ok: true });
  });
  app.patch('/checkins/:id', async (c) => {
    const id = parse(uuid, c.req.param('id'));
    const b = await body(c, z.object({ checkInAt: iso.optional(), checkOutAt: iso.optional(), reason: z.string().trim().min(5).max(300) }));
    if (!b.checkInAt && !b.checkOutAt) throw new ApiError(400, 'VALIDATION', 'Provide a new check-in or check-out time.');
    const tz = (await getSettings(db)).timezone;
    const res = await db.tx(async (t) => {
      const r = await applyTimes(t, tz, id, { checkInAt: b.checkInAt ? new Date(b.checkInAt) : undefined, checkOutAt: b.checkOutAt ? new Date(b.checkOutAt) : undefined });
      await t.query("UPDATE checkins SET override_by = $2, override_reason = $3, in_flags = CASE WHEN 'ADMIN_OVERRIDE' = ANY(in_flags) THEN in_flags ELSE array_append(in_flags, 'ADMIN_OVERRIDE') END WHERE id = $1", [id, actor(c), b.reason]);
      await audit(t, actor(c), 'CHECKIN_EDIT', 'checkin', id, { reason: b.reason, before: { in: r.before.check_in_at, out: r.before.check_out_at }, after: { in: r.after.check_in_at, out: r.after.check_out_at } });
      return r.after;
    });
    return c.json(res);
  });
  app.post('/checkins/override', async (c) => {
    const b = await body(c, z.object({ userId: uuid, siteId: uuid, kind: z.enum(KINDS).default('attendance'), subjectRef: z.string().max(80).nullish(), checkInAt: iso, checkOutAt: iso.optional(), reason: z.string().trim().min(5).max(300) }));
    const tz = (await getSettings(db)).timezone;
    const inAt = new Date(b.checkInAt), outAt = b.checkOutAt ? new Date(b.checkOutAt) : null;
    if (outAt && outAt < inAt) throw new ApiError(400, 'BAD_TIMES', 'Check-out cannot be before check-in.');
    if (inAt.getTime() > clock().getTime() + 60_000) throw new ApiError(400, 'BAD_TIMES', 'Times cannot be in the future.');
    const user = (await db.query<any>('SELECT id, shift_id FROM users WHERE id = $1', [b.userId]))[0];
    if (!user || !(await db.query('SELECT 1 FROM sites WHERE id = $1', [b.siteId])).length) throw new ApiError(404, 'NOT_FOUND');
    const shift = b.kind === 'attendance' ? await loadShift(db, user.shift_id) : null;
    const m = computeMetrics(shift, inAt, outAt, tz);
    try {
      const r = await db.tx(async (t) => {
        const row = await t.query(
          `INSERT INTO checkins (user_id, site_id, kind, subject_ref, status, day, check_in_at, check_out_at, in_flags, review_status, closed_by, shift_id,
                                 late_minutes, overtime_minutes, work_minutes, override_by, override_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,ARRAY['ADMIN_OVERRIDE'],'reviewed',$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
          [b.userId, b.siteId, b.kind, b.subjectRef?.trim() || null, outAt ? 'closed' : 'open', localParts(inAt, tz).day, inAt, outAt, outAt ? 'admin' : null, shift?.id ?? null, m.lateMinutes, m.overtimeMinutes, m.workMinutes, actor(c), b.reason]);
        await t.query('DELETE FROM absences WHERE user_id = $1 AND day = $2', [b.userId, localParts(inAt, tz).day]);
        await audit(t, actor(c), 'CHECKIN_OVERRIDE', 'checkin', row[0].id, { userId: b.userId, siteId: b.siteId, kind: b.kind, reason: b.reason });
        return row[0];
      });
      return c.json(r, 201);
    } catch (e) { dup(e, 'That employee already has an open record of this kind.'); }
  });
  app.get('/attempts', async (c) => {
    const rows = await db.query(
      `SELECT a.id, a.at, a.action, a.kind, a.outcome, a.reasons, a.distance_m, a.accuracy_m, u.name AS user_name, s.name AS site_name
         FROM attempts a JOIN users u ON u.id = a.user_id LEFT JOIN sites s ON s.id = a.site_id
        WHERE a.outcome <> 'accepted' ORDER BY a.at DESC LIMIT 100`);
    return c.json({ items: rows });
  });

  // ---- corrections ----
  app.get('/corrections', async (c) => {
    const status = c.req.query('status');
    const rows = await db.query(
      `SELECT k.*, u.name AS user_name, c.check_in_at AS current_check_in_at, c.check_out_at AS current_check_out_at, c.kind, s.name AS site_name
         FROM corrections k JOIN users u ON u.id = k.user_id JOIN checkins c ON c.id = k.checkin_id JOIN sites s ON s.id = c.site_id
        WHERE ($1::text IS NULL OR k.status = $1) ORDER BY k.created_at DESC LIMIT 200`, [status ?? null]);
    return c.json({ items: rows });
  });
  app.post('/corrections/:id/decide', async (c) => {
    const id = parse(uuid, c.req.param('id'));
    const b = await body(c, z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() }));
    const tz = (await getSettings(db)).timezone;
    await db.tx(async (t) => {
      const k = (await t.query<any>("SELECT * FROM corrections WHERE id = $1 AND status = 'pending' FOR UPDATE", [id]))[0];
      if (!k) throw new ApiError(409, 'NOT_PENDING', 'This correction is not pending.');
      if (b.approve) {
        const r = await applyTimes(t, tz, k.checkin_id, { checkInAt: k.proposed_check_in_at ? new Date(k.proposed_check_in_at) : undefined, checkOutAt: k.proposed_check_out_at ? new Date(k.proposed_check_out_at) : undefined });
        await t.query("UPDATE checkins SET review_status = 'reviewed', review_note = $2, reviewed_by = $3, reviewed_at = $4 WHERE id = $1", [k.checkin_id, `Correction approved: ${k.reason}`.slice(0, 300), actor(c), clock()]);
        await audit(t, actor(c), 'CORRECTION_APPROVE', 'checkin', k.checkin_id, { correctionId: id, reason: k.reason, before: { in: r.before.check_in_at, out: r.before.check_out_at }, after: { in: r.after.check_in_at, out: r.after.check_out_at } });
      } else {
        await audit(t, actor(c), 'CORRECTION_REJECT', 'checkin', k.checkin_id, { correctionId: id, note: b.note ?? null });
      }
      await t.query('UPDATE corrections SET status = $2, decided_by = $3, decided_at = $4, decision_note = $5 WHERE id = $1', [id, b.approve ? 'approved' : 'rejected', actor(c), clock(), b.note ?? null]);
      await notify(t, k.user_id, 'correction', `Correction ${b.approve ? 'approved' : 'rejected'}`, b.note ? `Note from HR: ${b.note}` : `Your correction request was ${b.approve ? 'approved' : 'rejected'}.`, `correction:${id}`);
    });
    return c.json({ ok: true });
  });

  // ---- settings, audit, summaries, jobs ----
  app.get('/settings', async (c) => c.json(await getSettings(db)));
  app.put('/settings', async (c) => {
    let raw: unknown;
    try { raw = await c.req.json(); } catch { throw new ApiError(400, 'BAD_JSON'); }
    const { before, after } = await updateSettings(db, raw);
    await audit(db, actor(c), 'SETTINGS_UPDATE', 'settings', null, { before, after });
    return c.json(after);
  });
  app.get('/audit', async (c) => {
    const rows = await db.query(
      `SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.detail, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 200`);
    return c.json({ items: rows });
  });
  app.get('/summary', async (c) => {
    const s = await getSettings(db);
    const today = localParts(clock(), s.timezone).day;
    const q = parse(z.object({ from: day.default(today), to: day.default(today) }), c.req.query());
    if (q.to < q.from || q.to > addDays(q.from, 92)) throw new ApiError(400, 'VALIDATION', 'Invalid range (max 93 days).');
    return c.json(await computeSummary(db, s.timezone, q.from, q.to));
  });
  app.post('/jobs/run', async (c) => {
    const res = await runJobs(deps);
    await audit(db, actor(c), 'JOBS_RUN_MANUAL', 'jobs', null, { ...res });
    return c.json(res);
  });

  // ---- AI (admin only, read-only, pseudonymised) ----
  app.post('/ai/ask', async (c) => {
    const { question } = await body(c, z.object({ question: z.string().max(1000) }));
    return c.json(await ask(deps, actor(c), question, pl));
  });
  app.get('/ai/anomalies', async (c) => {
    const s = await getSettings(db);
    const today = localParts(clock(), s.timezone).day;
    const q = parse(z.object({ from: day.default(addDays(today, -13)), to: day.default(today) }), c.req.query());
    if (q.to < q.from || q.to > addDays(q.from, 92)) throw new ApiError(400, 'VALIDATION', 'Invalid range (max 93 days).');
    return c.json({ from: q.from, to: q.to, items: await detectAnomalies(deps, q.from, q.to) });
  });

  return app;
}
