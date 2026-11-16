import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { addDays, localParts } from './time';

/** Signed, day-scoped site QR token (ADR-0004). */

export interface QrSite { id: string; qr_secret: string; qr_epoch: number }
export interface ParsedToken { siteId: string; day: string; epoch: number; sig: string; payload: string }
export type QrFailure = 'malformed' | 'unknown_site' | 'bad_signature' | 'expired' | 'rotated';
export type QrResult = { ok: true } | { ok: false; code: QrFailure };

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const SIG_BYTES = 16;

export function newSiteSecret(): string {
  return randomBytes(32).toString('hex');
}

function siteKey(master: string, site: QrSite): Buffer {
  return createHmac('sha256', master).update(site.qr_secret).digest();
}

export function signToken(master: string, site: QrSite, day: string): string {
  const payload = `kp1.${site.id}.${day}.${site.qr_epoch}`;
  const sig = createHmac('sha256', siteKey(master, site)).update(payload).digest().subarray(0, SIG_BYTES);
  return `${b64u(payload)}.${b64u(sig)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseToken(token: string): ParsedToken | null {
  if (typeof token !== 'string' || token.length > 300) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  let payload: string;
  try { payload = Buffer.from(parts[0], 'base64url').toString('utf8'); } catch { return null; }
  const f = payload.split('.');
  if (f.length !== 4 || f[0] !== 'kp1' || !UUID.test(f[1]) || !DAY.test(f[2]) || !/^\d{1,6}$/.test(f[3])) return null;
  return { siteId: f[1], day: f[2], epoch: Number(f[3]), sig: parts[1], payload };
}

export interface VerifyCtx { master: string; now: Date; tz: string; graceMinutes: number }

export function verifyParsed(p: ParsedToken, site: QrSite | null, ctx: VerifyCtx): QrResult {
  if (!site || site.id !== p.siteId) return { ok: false, code: 'unknown_site' };
  const expected = createHmac('sha256', siteKey(ctx.master, site)).update(p.payload).digest().subarray(0, SIG_BYTES);
  let given: Buffer;
  try { given = Buffer.from(p.sig, 'base64url'); } catch { return { ok: false, code: 'malformed' }; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, code: 'bad_signature' };
  // Signature is valid from here on, so the remaining failures may be reported precisely.
  if (p.epoch !== site.qr_epoch) return { ok: false, code: 'rotated' };
  const l = localParts(ctx.now, ctx.tz);
  if (p.day === l.day) return { ok: true };
  const minutesSinceMidnight = l.hh * 60 + l.mm;
  if (p.day === addDays(l.day, -1) && minutesSinceMidnight < ctx.graceMinutes) return { ok: true };
  return { ok: false, code: 'expired' };
}
