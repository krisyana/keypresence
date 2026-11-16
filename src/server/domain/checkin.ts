import { ApiError, type Deps, type Kind } from '../deps';
import { isUniqueViolation, type Db } from '../db';
import type { AuthUser } from '../auth';
import { getSettings } from '../settings';
import { evaluateLocation, type PreviousEvent } from './geo';
import { parseToken, verifyParsed, type QrSite } from './qr';
import { computeMetrics, type ShiftRule } from './shifts';
import { localParts } from './time';

export interface CheckInput {
  token: string;
  kind: Kind;
  subjectRef?: string | null;
  checkinId?: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  fixTimestamp?: number | null;
  isMock?: boolean;
}

export interface SiteRow extends QrSite {
  name: string; lat: number; lng: number; radius_m: number; max_accuracy_m: number;
  enforcement: 'reject' | 'flag' | 'off'; active: boolean;
}

export async function loadShift(db: Db, id: string | null): Promise<ShiftRule | null> {
  if (!id) return null;
  const r = await db.query<ShiftRule>('SELECT * FROM shifts WHERE id = $1', [id]);
  return r[0] ?? null;
}

async function previousEvent(db: Db, userId: string): Promise<PreviousEvent | null> {
  const r = await db.query<{ site_id: string; at: Date; lat: number; lng: number }>(
    `SELECT site_id, at, lat, lng FROM (
        SELECT site_id, check_in_at AS at, in_lat AS lat, in_lng AS lng FROM checkins WHERE user_id = $1 AND in_lat IS NOT NULL
        UNION ALL
        SELECT site_id, check_out_at AS at, out_lat AS lat, out_lng AS lng FROM checkins WHERE user_id = $1 AND out_lat IS NOT NULL
      ) e ORDER BY at DESC LIMIT 1`, [userId]);
  const e = r[0];
  return e ? { siteId: e.site_id, at: new Date(e.at), lat: e.lat, lng: e.lng } : null;
}

async function recordAttempt(
  db: Db, userId: string, siteId: string | null, action: 'in' | 'out', kind: string,
  outcome: 'accepted' | 'flagged' | 'rejected', reasons: string[], distance: number | null, accuracy: number | null | undefined, at: Date,
) {
  await db.query(
    'INSERT INTO attempts(user_id, site_id, action, kind, outcome, reasons, distance_m, accuracy_m, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [userId, siteId, action, kind, outcome, reasons, distance, accuracy ?? null, at],
  );
}

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/** Verifies QR + location, then opens or closes a check-in. Throws ApiError(422) on rejection. */
export async function performCheck(deps: Deps, user: AuthUser, action: 'in' | 'out', input: CheckInput) {
  const { db, clock, config } = deps;
  const now = clock();
  if (!user.location_consent_at) throw new ApiError(403, 'CONSENT_REQUIRED', 'Location consent is required before checking in.');
  const settings = await getSettings(db);
  const subjectRef = input.subjectRef?.trim() ? input.subjectRef.trim().slice(0, 80) : null;
  if (input.kind === 'visitor' && !subjectRef) throw new ApiError(400, 'SUBJECT_REQUIRED', 'Visitor check-ins need a name or reference.');

  // 1. QR
  const parsed = parseToken(input.token);
  const site = parsed ? (await db.query<SiteRow>('SELECT * FROM sites WHERE id = $1', [parsed.siteId]))[0] ?? null : null;
  const qr = parsed
    ? verifyParsed(parsed, site && site.active ? site : null, { master: config.masterSecret, now, tz: settings.timezone, graceMinutes: settings.qr_grace_minutes })
    : ({ ok: false, code: 'malformed' } as const);
  if (!qr.ok || !site) {
    const code = qr.ok ? 'unknown_site' : qr.code;
    const reason = `QR_${code.toUpperCase()}`;
    await recordAttempt(db, user.id, code === 'bad_signature' || code === 'malformed' ? null : site?.id ?? null, action, input.kind, 'rejected', [reason], null, null, now);
    throw new ApiError(422, 'REJECTED', 'This QR code is not valid.', { reasons: [reason], distanceM: null });
  }

  // 2. Location
  const prev = await previousEvent(db, user.id);
  const ev = evaluateLocation(
    { id: site.id, lat: site.lat, lng: site.lng, radiusM: site.radius_m, maxAccuracyM: site.max_accuracy_m, enforcement: site.enforcement },
    { lat: input.lat, lng: input.lng, accuracy: input.accuracy, timestamp: input.fixTimestamp, isMock: input.isMock },
    prev, now, { spoofingAction: settings.spoofing_action, impossibleSpeedKmh: settings.impossible_speed_kmh, staleFixSeconds: settings.stale_fix_seconds },
  );
  const distance = round1(ev.distanceM);
  if (ev.decision === 'reject') {
    await recordAttempt(db, user.id, site.id, action, input.kind, 'rejected', ev.reasons, distance, input.accuracy, now);
    throw new ApiError(422, 'REJECTED', 'Check-in rejected by location rules.', {
      reasons: ev.reasons, blocking: ev.blocking, distanceM: distance, radiusM: site.radius_m, accuracyM: input.accuracy ?? null,
    });
  }
  const outcome = ev.decision === 'flag' ? 'flagged' : 'accepted';

  // 3. Persist
  if (action === 'in') {
    const shift = input.kind === 'attendance' ? await loadShift(db, user.shift_id) : null;
    const m = computeMetrics(shift, now, null, settings.timezone);
    try {
      const row = await db.tx(async (t) => {
        const r = await t.query(
          `INSERT INTO checkins (user_id, site_id, kind, subject_ref, day, check_in_at, in_lat, in_lng, in_accuracy_m, in_distance_m,
                                 in_flags, review_status, shift_id, late_minutes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [user.id, site.id, input.kind, subjectRef, localParts(now, settings.timezone).day, now, input.lat, input.lng,
            input.accuracy ?? null, distance, ev.reasons, ev.reasons.length ? 'pending' : 'none', shift?.id ?? null, m.lateMinutes]);
        await recordAttempt(t, user.id, site.id, 'in', input.kind, outcome, ev.reasons, distance, input.accuracy, now);
        return r[0];
      });
      return { outcome, reasons: ev.reasons, distanceM: distance, siteName: site.name, checkin: row };
    } catch (e) {
      if (isUniqueViolation(e)) throw new ApiError(409, 'ALREADY_CHECKED_IN', 'You are already checked in for this.');
      throw e;
    }
  }

  const row = await db.tx(async (t) => {
    const open = input.checkinId
      ? await t.query('SELECT * FROM checkins WHERE id = $1 AND user_id = $2 AND status = \'open\' FOR UPDATE', [input.checkinId, user.id])
      : await t.query(
          'SELECT * FROM checkins WHERE user_id = $1 AND kind = $2 AND coalesce(subject_ref, \'\') = $3 AND status = \'open\' FOR UPDATE',
          [user.id, input.kind, subjectRef ?? '']);
    const cur = open[0];
    if (!cur) throw new ApiError(409, 'NOT_CHECKED_IN', 'There is no open check-in to close.');
    const flags = [...ev.reasons, ...(cur.site_id !== site.id ? ['DIFFERENT_SITE'] : [])];
    const shift = cur.kind === 'attendance' ? await loadShift(t, cur.shift_id) : null;
    const m = computeMetrics(shift, new Date(cur.check_in_at), now, settings.timezone);
    const r = await t.query(
      `UPDATE checkins SET status = 'closed', closed_by = 'user', check_out_at = $2,
              out_lat = $3, out_lng = $4, out_accuracy_m = $5, out_distance_m = $6, out_flags = $7,
              review_status = CASE WHEN review_status = 'pending' OR cardinality($7::text[]) > 0 THEN 'pending' ELSE review_status END,
              overtime_minutes = $8, work_minutes = $9
        WHERE id = $1 RETURNING *`,
      [cur.id, now, input.lat, input.lng, input.accuracy ?? null, distance, flags, m.overtimeMinutes, m.workMinutes]);
    await recordAttempt(t, user.id, site.id, 'out', cur.kind, flags.length ? 'flagged' : 'accepted', flags, distance, input.accuracy, now);
    return r[0];
  });
  return { outcome, reasons: ev.reasons, distanceM: distance, siteName: site.name, checkin: row };
}

/** Changes the times of a record (admin edit or approved correction), recomputing derived fields. Audited by the caller. */
export async function applyTimes(
  db: Db, tz: string, id: string, times: { checkInAt?: Date | null; checkOutAt?: Date | null },
) {
  const cur = (await db.query('SELECT * FROM checkins WHERE id = $1 FOR UPDATE', [id]))[0];
  if (!cur) throw new ApiError(404, 'NOT_FOUND');
  const newIn = times.checkInAt ?? new Date(cur.check_in_at);
  const newOut = times.checkOutAt ?? (cur.check_out_at ? new Date(cur.check_out_at) : null);
  if (newOut && newOut < newIn) throw new ApiError(400, 'BAD_TIMES', 'Check-out cannot be before check-in.');
  let shift = await loadShift(db, cur.shift_id);
  if (!shift && cur.kind === 'attendance') {
    const u = await db.query<{ shift_id: string | null }>('SELECT shift_id FROM users WHERE id = $1', [cur.user_id]);
    shift = await loadShift(db, u[0]?.shift_id ?? null);
  }
  const m = computeMetrics(cur.kind === 'attendance' ? shift : null, newIn, newOut, tz);
  const r = await db.query(
    `UPDATE checkins SET check_in_at = $2, check_out_at = $3, day = $4, status = CASE WHEN $3::timestamptz IS NULL THEN 'open' ELSE 'closed' END,
            closed_by = CASE WHEN $3::timestamptz IS NULL THEN NULL WHEN closed_by IS NULL THEN 'admin' ELSE closed_by END,
            shift_id = coalesce(shift_id, $5), late_minutes = $6, overtime_minutes = $7, work_minutes = $8
      WHERE id = $1 RETURNING *`,
    [id, newIn, newOut, localParts(newIn, tz).day, shift?.id ?? null, m.lateMinutes, m.overtimeMinutes, m.workMinutes]);
  return { before: cur, after: r[0] };
}

