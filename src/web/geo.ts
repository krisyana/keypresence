export interface Fix { lat: number; lng: number; accuracy: number; fixTimestamp: number }

/** Reads one fresh position. No cache (maximumAge 0): the server rejects stale fixes. Never watches or tracks in the background (ADR-0006). */
export function getFix(timeoutMs = 15000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new GeoError('unsupported', 'This device does not support location.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, fixTimestamp: p.timestamp }),
      (e) => {
        const map: Record<number, [string, string]> = {
          1: ['denied', 'Location permission was denied. Allow location for this site in your browser settings, then try again.'],
          2: ['unavailable', 'Your position could not be determined. Move to an open area and try again.'],
          3: ['timeout', 'Getting your position took too long. Try again.'],
        };
        const [code, msg] = map[e.code] ?? ['unavailable', 'Location error.'];
        reject(new GeoError(code, msg));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

export class GeoError extends Error { constructor(public code: string, message: string) { super(message); } }
