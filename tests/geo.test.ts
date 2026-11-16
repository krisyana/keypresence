import { describe, expect, it } from 'vitest';
import { evaluateLocation, haversineM, type Policy, type SiteFence } from '../src/server/domain/geo';

const site: SiteFence = { id: 's1', lat: -6.175392, lng: 106.827153, radiusM: 100, maxAccuracyM: 50, enforcement: 'reject' };
const policy: Policy = { spoofingAction: 'flag', impossibleSpeedKmh: 200, staleFixSeconds: 30 };
const now = new Date('2026-11-16T02:00:00Z');
/** Moves north by metres (1 deg lat = 111_195 m with the mean radius used). */
const north = (m: number) => ({ lat: site.lat + m / 111_195, lng: site.lng });
const fix = (extra = {}) => ({ ...north(10), accuracy: 10, timestamp: now.getTime() - 1000, ...extra });
const ev = (f = fix(), s = site, prev = null as any, p = policy) => evaluateLocation(s, f, prev, now, p);

describe('haversine', () => {
  it('is zero for the same point and symmetric', () => {
    expect(haversineM(1, 2, 1, 2)).toBe(0);
    expect(haversineM(-6.17, 106.82, -6.2, 106.9)).toBeCloseTo(haversineM(-6.2, 106.9, -6.17, 106.82), 6);
  });
  it('matches a known distance (1 degree of latitude is about 111.2 km)', () => {
    expect(haversineM(0, 0, 1, 0)).toBeGreaterThan(111_100);
    expect(haversineM(0, 0, 1, 0)).toBeLessThan(111_300);
  });
});

describe('evaluateLocation', () => {
  it('accepts inside the fence with good accuracy', () => {
    const r = ev();
    expect(r.decision).toBe('accept');
    expect(r.reasons).toEqual([]);
    expect(r.distanceM).toBeCloseTo(10, 0);
  });

  it.each([
    ['just inside the radius', 99, 'accept'],
    ['just outside the radius', 101, 'reject'],
  ])('boundary: %s', (_n, m, decision) => {
    expect(ev(fix(north(m))).decision).toBe(decision);
  });

  it.each([
    ['at the accuracy threshold', 50, 'accept'],
    ['over the accuracy threshold', 50.5, 'reject'],
    ['accuracy missing', undefined, 'reject'],
  ])('accuracy: %s', (_n, accuracy, decision) => {
    const r = ev(fix({ accuracy }));
    expect(r.decision).toBe(decision);
    if (decision === 'reject') expect(r.blocking).toContain('LOW_ACCURACY');
  });

  it('does not let poor accuracy "cover" a distance (distance minus accuracy is not used)', () => {
    const r = ev(fix({ ...north(140), accuracy: 49 }));
    expect(r.blocking).toEqual(['OUTSIDE_FENCE']);
  });

  it('flag mode records outside-fence and low-accuracy as flags, not rejections', () => {
    const r = ev(fix({ ...north(500), accuracy: 400 }), { ...site, enforcement: 'flag' });
    expect(r.decision).toBe('flag');
    expect(r.reasons).toEqual(['LOW_ACCURACY', 'OUTSIDE_FENCE']);
    expect(r.blocking).toEqual([]);
  });

  it('off mode ignores fence and accuracy', () => {
    expect(ev(fix({ ...north(5000), accuracy: 900 }), { ...site, enforcement: 'off' }).decision).toBe('accept');
  });

  it.each([
    ['NaN', { lat: NaN }], ['lat out of range', { lat: 91 }], ['lng out of range', { lng: -181 }], ['null island', { lat: 0, lng: 0 }],
  ])('rejects invalid coordinates: %s', (_n, extra) => {
    const r = ev(fix(extra));
    expect(r.decision).toBe('reject');
    expect(r.blocking).toEqual(['INVALID_COORDS']);
    expect(r.distanceM).toBeNull();
  });

  it('rejects stale and future fixes even when enforcement is off', () => {
    const off = { ...site, enforcement: 'off' as const };
    expect(ev(fix({ timestamp: now.getTime() - 31_000 }), off).blocking).toEqual(['STALE_FIX']);
    expect(ev(fix({ timestamp: now.getTime() + 6_000 }), off).blocking).toEqual(['STALE_FIX']);
    expect(ev(fix({ timestamp: now.getTime() - 29_000 }), off).decision).toBe('accept');
  });

  describe('spoof signals', () => {
    it('flags a native mock hint, and rejects when policy says reject', () => {
      expect(ev(fix({ isMock: true })).decision).toBe('flag');
      expect(ev(fix({ isMock: true }), site, null, { ...policy, spoofingAction: 'reject' }).decision).toBe('reject');
    });
    it('flags accuracy under 1 m and suspiciously round coordinates', () => {
      expect(ev(fix({ accuracy: 0 })).reasons).toEqual(['SPOOF_SIGNAL']);
      const roundSite = { ...site, lat: -6.175, lng: 106.827 };
      expect(ev(fix({ lat: -6.175, lng: 106.827 }), roundSite).reasons).toEqual(['SPOOF_SIGNAL']);
    });
  });

  describe('impossible travel', () => {
    const prevAt = (minutesAgo: number, km: number) => ({ siteId: 'other', at: new Date(now.getTime() - minutesAgo * 60000), lat: site.lat + km / 111.195, lng: site.lng });
    it('flags 30 km in 5 minutes (360 km/h)', () => expect(ev(fix(), site, prevAt(5, 30)).reasons).toEqual(['IMPOSSIBLE_TRAVEL']));
    it('allows 30 km in 60 minutes (30 km/h)', () => expect(ev(fix(), site, prevAt(60, 30)).decision).toBe('accept'));
    it('ignores tiny jumps (under 0.5 km) however fast', () => expect(ev(fix(), site, prevAt(0.1, 0.3)).decision).toBe('accept'));
    it('ignores gaps over 12 hours', () => expect(ev(fix(), site, prevAt(13 * 60, 500)).decision).toBe('accept'));
    it('rejects when the policy says reject', () =>
      expect(ev(fix(), site, prevAt(5, 30), { ...policy, spoofingAction: 'reject' }).blocking).toEqual(['IMPOSSIBLE_TRAVEL']));
  });
});
