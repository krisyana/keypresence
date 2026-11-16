import { describe, expect, it } from 'vitest';
import { newSiteSecret, parseToken, signToken, verifyParsed, type QrSite } from '../src/server/domain/qr';

const master = 'm'.repeat(40);
const site: QrSite = { id: '11111111-1111-4111-8111-111111111111', qr_secret: newSiteSecret(), qr_epoch: 1 };
const tz = 'Asia/Jakarta';
const ctx = (iso: string) => ({ master, now: new Date(iso), tz, graceMinutes: 10 });
const check = (token: string, s: QrSite | null, iso: string) => {
  const p = parseToken(token);
  return p ? verifyParsed(p, s, ctx(iso)) : ({ ok: false, code: 'malformed' } as const);
};

describe('site QR token', () => {
  const token = signToken(master, site, '2026-11-16');
  it('verifies on the day it was issued (local day)', () => {
    expect(check(token, site, '2026-11-16T02:00:00Z')).toEqual({ ok: true });
    expect(check(token, site, '2026-11-16T16:59:00Z')).toEqual({ ok: true }); // 23:59 Jakarta
  });
  it('expires the next local day, with a grace window after midnight', () => {
    expect(check(token, site, '2026-11-16T17:05:00Z')).toEqual({ ok: true }); // 00:05 Jakarta, inside the 10 min grace
    expect(check(token, site, '2026-11-16T17:11:00Z')).toEqual({ ok: false, code: 'expired' });
    expect(check(token, site, '2026-11-18T02:00:00Z')).toEqual({ ok: false, code: 'expired' });
  });
  it('day boundary follows the organisation timezone, not UTC', () => {
    // 2026-11-16T20:00Z is already 17 Nov in Jakarta
    expect(check(token, site, '2026-11-16T20:00:00Z')).toEqual({ ok: false, code: 'expired' });
  });
  it('a token for tomorrow is not valid today (no pre-issued codes)', () => {
    expect(check(signToken(master, site, '2026-11-17'), site, '2026-11-16T02:00:00Z')).toEqual({ ok: false, code: 'expired' });
  });
  it('rotation invalidates earlier tokens, including today\'s', () => {
    const rotated = { ...site, qr_secret: newSiteSecret(), qr_epoch: 2 };
    expect(check(token, rotated, '2026-11-16T02:00:00Z')).toEqual({ ok: false, code: 'bad_signature' });
    // same secret but bumped epoch (defence in depth)
    expect(check(token, { ...site, qr_epoch: 2 }, '2026-11-16T02:00:00Z')).toEqual({ ok: false, code: 'rotated' });
  });
  it('rejects a token signed with another master secret or for another site', () => {
    expect(check(signToken('x'.repeat(40), site, '2026-11-16'), site, '2026-11-16T02:00:00Z').ok).toBe(false);
    const other: QrSite = { ...site, id: '22222222-2222-4222-8222-222222222222' };
    expect(check(token, other, '2026-11-16T02:00:00Z')).toEqual({ ok: false, code: 'unknown_site' });
  });
  it('rejects tampering with the payload (day) or signature', () => {
    const [p, sig] = token.split('.');
    const forgedPayload = Buffer.from(Buffer.from(p!, 'base64url').toString().replace('2026-11-16', '2026-11-17')).toString('base64url');
    expect(check(`${forgedPayload}.${sig}`, site, '2026-11-17T02:00:00Z')).toEqual({ ok: false, code: 'bad_signature' });
    expect(check(`${p}.${sig!.slice(0, -2)}AA`, site, '2026-11-16T02:00:00Z').ok).toBe(false);
  });
  it.each(['', 'abc', 'a.b.c', 'x'.repeat(400), '!!!.???'])('treats garbage as malformed: %s', (g) => {
    expect(parseToken(g)).toBeNull();
  });
  it('unknown site gives no signature oracle', () => {
    expect(check(token, null, '2026-11-16T02:00:00Z')).toEqual({ ok: false, code: 'unknown_site' });
  });
});
