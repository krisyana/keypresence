/** Location evaluation: one pure function decides accept / flag / reject (ADR-0005). */

export type Reason =
  | 'INVALID_COORDS' | 'LOW_ACCURACY' | 'OUTSIDE_FENCE' | 'STALE_FIX' | 'SPOOF_SIGNAL' | 'IMPOSSIBLE_TRAVEL';

export interface Fix {
  lat: number;
  lng: number;
  accuracy?: number | null;
  /** Epoch ms of the position fix as reported by the device. */
  timestamp?: number | null;
  /** Mock hint from a native wrapper. Browsers cannot supply it. */
  isMock?: boolean;
}
export interface SiteFence {
  id: string; lat: number; lng: number; radiusM: number; maxAccuracyM: number;
  enforcement: 'reject' | 'flag' | 'off';
}
export interface PreviousEvent { lat: number; lng: number; at: Date; siteId: string }
export interface Policy { spoofingAction: 'flag' | 'reject'; impossibleSpeedKmh: number; staleFixSeconds: number }

export interface Evaluation {
  decision: 'accept' | 'flag' | 'reject';
  reasons: Reason[];
  /** Subset of reasons that caused a rejection. */
  blocking: Reason[];
  distanceM: number | null;
}

const R = 6371008.8; // mean Earth radius, metres

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const looksRounded = (n: number) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-7;

export function evaluateLocation(
  site: SiteFence, fix: Fix, prev: PreviousEvent | null, now: Date, policy: Policy,
): Evaluation {
  const reasons: Reason[] = [];
  const blocking: Reason[] = [];
  const add = (r: Reason, blocks: boolean) => {
    if (!reasons.includes(r)) reasons.push(r);
    if (blocks && !blocking.includes(r)) blocking.push(r);
  };

  const valid =
    isNum(fix.lat) && isNum(fix.lng) && Math.abs(fix.lat) <= 90 && Math.abs(fix.lng) <= 180 &&
    !(fix.lat === 0 && fix.lng === 0);
  if (!valid) {
    add('INVALID_COORDS', true);
    return { decision: 'reject', reasons, blocking, distanceM: null };
  }

  const distanceM = haversineM(site.lat, site.lng, fix.lat, fix.lng);
  const enforced = site.enforcement !== 'off';
  const hard = site.enforcement === 'reject';

  // Fix freshness: replayed old fixes are rejected regardless of enforcement mode.
  if (isNum(fix.timestamp)) {
    const ageMs = now.getTime() - fix.timestamp;
    if (ageMs > policy.staleFixSeconds * 1000 || ageMs < -5000) add('STALE_FIX', true);
  }

  if (enforced) {
    if (!isNum(fix.accuracy) || fix.accuracy > site.maxAccuracyM) add('LOW_ACCURACY', hard);
    if (distanceM > site.radiusM) add('OUTSIDE_FENCE', hard);
  }

  const spoofBlocks = policy.spoofingAction === 'reject';
  if (fix.isMock === true || (isNum(fix.accuracy) && fix.accuracy < 1) || (looksRounded(fix.lat) && looksRounded(fix.lng))) {
    add('SPOOF_SIGNAL', spoofBlocks);
  }

  if (prev) {
    const hours = Math.max((now.getTime() - prev.at.getTime()) / 3_600_000, 1 / 3600);
    const km = haversineM(prev.lat, prev.lng, fix.lat, fix.lng) / 1000;
    if (hours < 12 && km > 0.5 && km / hours > policy.impossibleSpeedKmh) add('IMPOSSIBLE_TRAVEL', spoofBlocks);
  }

  const decision = blocking.length ? 'reject' : reasons.length ? 'flag' : 'accept';
  return { decision, reasons, blocking, distanceM };
}
