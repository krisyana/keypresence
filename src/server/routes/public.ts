import { Hono } from 'hono';
import { z } from 'zod';
import { ApiError, KINDS, type Deps } from '../deps';
import { body } from '../http';
import {
  clearSessionCookie, createSession, destroySession, dummyVerify, makeLimiter, requireRole, sessionToken,
  setSessionCookie, verifyPassword, type Env,
} from '../auth';
import { performCheck } from '../domain/checkin';
import { parseToken, verifyParsed } from '../domain/qr';
import { getSettings } from '../settings';
import { audit } from '../audit';

const checkSchema = z.object({
  token: z.string().min(10).max(300),
  kind: z.enum(KINDS).default('attendance'),
  subjectRef: z.string().max(80).nullish(),
  checkinId: z.uuid().optional(),
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().nonnegative().nullish(),
  fixTimestamp: z.number().int().nullish(),
  isMock: z.boolean().optional(),
});

export function publicRoutes(deps: Deps) {
  const { db, clock, config } = deps;
  const app = new Hono<Env>();
  const limiter = makeLimiter(10, 10 * 60_000, clock);
  const secure = config.appUrl.startsWith('https://');
  const auth = requireRole(db, clock);

  app.post('/auth/login', async (c) => {
    const { email, password } = await body(c, z.object({ email: z.string().max(200), password: z.string().max(200) }));
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    if (!limiter.take(`${email.toLowerCase()}|${ip}`)) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
    const rows = await db.query<any>('SELECT * FROM users WHERE lower(email) = lower($1) AND active', [email]);
    const u = rows[0];
    const ok = u ? await verifyPassword(password, u.password_hash) : (await dummyVerify(password), false);
    if (!u || !ok) return c.json({ error: 'BAD_CREDENTIALS', message: 'Email or password is incorrect.' }, 401);
    const token = await createSession(db, u.id, clock());
    setSessionCookie(c, token, secure);
    return c.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role } });
  });

  app.post('/auth/logout', async (c) => {
    const t = sessionToken(c);
    if (t) await destroySession(db, t);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.get('/me', auth, async (c) => {
    const u = c.get('user');
    const settings = await getSettings(db);
    const shift = u.shift_id ? (await db.query('SELECT name, start_time, end_time FROM shifts WHERE id = $1', [u.shift_id]))[0] ?? null : null;
    const open = await db.query(
      `SELECT c.id, c.kind, c.subject_ref, c.check_in_at, c.in_flags, s.name AS site_name
         FROM checkins c JOIN sites s ON s.id = c.site_id WHERE c.user_id = $1 AND c.status = 'open' ORDER BY c.check_in_at`, [u.id]);
    const [unread] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [u.id]);
    return c.json({ user: u, timezone: settings.timezone, shift, open, unread: unread.n });
  });

  app.post('/me/consent', auth, async (c) => {
    const { consent } = await body(c, z.object({ consent: z.boolean() }));
    const u = c.get('user');
    await db.query('UPDATE users SET location_consent_at = $2 WHERE id = $1', [u.id, consent ? clock() : null]);
    await audit(db, u.id, consent ? 'CONSENT_GIVEN' : 'CONSENT_WITHDRAWN', 'user', u.id);
    return c.json({ ok: true });
  });

  /** Lets the app show the site name before the user commits to a check-in. Reveals nothing for an invalid token. */
  app.get('/sites/resolve', auth, async (c) => {
    const token = c.req.query('token') ?? '';
    const p = parseToken(token);
    const site = p ? (await db.query<any>('SELECT * FROM sites WHERE id = $1 AND active', [p.siteId]))[0] ?? null : null;
    const settings = await getSettings(db);
    const r = p ? verifyParsed(p, site, { master: config.masterSecret, now: clock(), tz: settings.timezone, graceMinutes: settings.qr_grace_minutes }) : { ok: false as const, code: 'malformed' as const };
    if (!r.ok || !site) return c.json({ ok: false, code: r.ok ? 'unknown_site' : r.code }, 422);
    return c.json({ ok: true, site: { id: site.id, name: site.name, radiusM: site.radius_m, enforcement: site.enforcement } });
  });

  app.post('/checkins/in', auth, async (c) => c.json(await performCheck(deps, c.get('user'), 'in', await body(c, checkSchema)), 201));
  app.post('/checkins/out', auth, async (c) => c.json(await performCheck(deps, c.get('user'), 'out', await body(c, checkSchema))));

  app.get('/checkins/mine', auth, async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
    const rows = await db.query(
      `SELECT c.id, c.kind, c.subject_ref, c.day, c.status, c.check_in_at, c.check_out_at, c.in_flags, c.out_flags, c.review_status,
              c.late_minutes, c.overtime_minutes, c.work_minutes, c.closed_by, s.name AS site_name,
              EXISTS (SELECT 1 FROM corrections k WHERE k.checkin_id = c.id AND k.status = 'pending') AS correction_pending
         FROM checkins c JOIN sites s ON s.id = c.site_id WHERE c.user_id = $1 ORDER BY c.check_in_at DESC LIMIT $2`, [c.get('user').id, limit]);
    return c.json({ items: rows });
  });

  app.get('/notifications', auth, async (c) => {
    const rows = await db.query('SELECT id, type, title, body, created_at, read_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [c.get('user').id]);
    return c.json({ items: rows });
  });
  app.post('/notifications/read', auth, async (c) => {
    await db.query('UPDATE notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL', [c.get('user').id, clock()]);
    return c.json({ ok: true });
  });

  const correctionSchema = z.object({
    checkinId: z.uuid(),
    proposedCheckInAt: z.iso.datetime({ offset: true }).optional(),
    proposedCheckOutAt: z.iso.datetime({ offset: true }).optional(),
    reason: z.string().trim().min(5).max(500),
  });
  app.post('/corrections', auth, async (c) => {
    const b = await body(c, correctionSchema);
    if (!b.proposedCheckInAt && !b.proposedCheckOutAt) throw new ApiError(400, 'VALIDATION', 'Propose a check-in or check-out time.');
    const u = c.get('user');
    const own = await db.query('SELECT check_in_at FROM checkins WHERE id = $1 AND user_id = $2', [b.checkinId, u.id]);
    if (!own.length) throw new ApiError(404, 'NOT_FOUND');
    const inAt = b.proposedCheckInAt ? new Date(b.proposedCheckInAt) : new Date(own[0].check_in_at);
    if (b.proposedCheckOutAt && new Date(b.proposedCheckOutAt) < inAt) throw new ApiError(400, 'BAD_TIMES', 'Check-out cannot be before check-in.');
    if ([b.proposedCheckInAt, b.proposedCheckOutAt].some((t) => t && new Date(t).getTime() > clock().getTime() + 60_000)) throw new ApiError(400, 'BAD_TIMES', 'Times cannot be in the future.');
    try {
      const r = await db.query(
        'INSERT INTO corrections(checkin_id, user_id, proposed_check_in_at, proposed_check_out_at, reason) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [b.checkinId, u.id, b.proposedCheckInAt ?? null, b.proposedCheckOutAt ?? null, b.reason]);
      return c.json(r[0], 201);
    } catch (e: any) {
      if (e?.code === '23505') throw new ApiError(409, 'CORRECTION_PENDING', 'A correction for this record is already pending.');
      throw e;
    }
  });
  app.get('/corrections/mine', auth, async (c) => {
    const rows = await db.query('SELECT * FROM corrections WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [c.get('user').id]);
    return c.json({ items: rows });
  });

  return app;
}
