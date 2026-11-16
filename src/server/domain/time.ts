/** Timezone helpers. All business-day logic uses the organisation timezone (requirements §6). */

export interface LocalParts {
  y: number; m: number; d: number; hh: number; mm: number; ss: number;
  isoDow: number; // 1=Mon..7=Sun
  day: string;    // YYYY-MM-DD
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}

export function localParts(date: Date, tz: string): LocalParts {
  const p: Record<string, string> = {};
  for (const part of fmt(tz).formatToParts(date)) p[part.type] = part.value;
  const dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const y = +p.year, m = +p.month, d = +p.day;
  return {
    y, m, d, hh: +p.hour, mm: +p.minute, ss: +p.second,
    isoDow: dows.indexOf(p.weekday) + 1,
    day: `${p.year}-${p.month}-${p.day}`,
  };
}

/** Offset of tz from UTC in minutes at the given instant (positive east). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const l = localParts(date, tz);
  const asUtc = Date.UTC(l.y, l.m - 1, l.d, l.hh, l.mm, l.ss);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Converts a local wall-clock time on a local day ("2026-11-16", "08:30") to a UTC instant. */
export function zonedToUtc(day: string, time: string, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  let guess = naive;
  for (let i = 0; i < 3; i++) guess = naive - tzOffsetMinutes(new Date(guess), tz) * 60000;
  return new Date(guess);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function isoDowOfDay(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export function startOfIsoWeek(day: string): string {
  return addDays(day, -(isoDowOfDay(day) - 1));
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z'), b = Date.parse(to + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

export function timeToString(t: string): string {
  return t.slice(0, 5); // "08:30:00" -> "08:30"
}
