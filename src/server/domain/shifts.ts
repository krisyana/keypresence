import { isoDowOfDay, localParts, timeToString, zonedToUtc } from './time';

export interface ShiftRule {
  id: string;
  start_time: string; end_time: string;
  grace_minutes: number; overtime_after_minutes: number; auto_close_after_minutes: number;
  work_days: number[];
}

export interface Metrics { lateMinutes: number; overtimeMinutes: number; workMinutes: number | null }

const minutes = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60000);

export const shiftStartUtc = (s: ShiftRule, day: string, tz: string) => zonedToUtc(day, timeToString(s.start_time), tz);
export const shiftEndUtc = (s: ShiftRule, day: string, tz: string) => zonedToUtc(day, timeToString(s.end_time), tz);

/**
 * Late / overtime / work minutes for an attendance record.
 * - Late: arrival after start + grace counts the whole delay since start.
 * - Overtime: leaving at least `overtime_after_minutes` after shift end counts the time since shift end.
 * - On a non-working day, the whole worked time is overtime.
 */
export function computeMetrics(shift: ShiftRule | null, checkIn: Date, checkOut: Date | null, tz: string): Metrics {
  const work = checkOut ? Math.max(0, minutes(checkIn, checkOut)) : null;
  if (!shift) return { lateMinutes: 0, overtimeMinutes: 0, workMinutes: work };
  const day = localParts(checkIn, tz).day;
  if (!shift.work_days.includes(isoDowOfDay(day))) {
    return { lateMinutes: 0, overtimeMinutes: work ?? 0, workMinutes: work };
  }
  const start = shiftStartUtc(shift, day, tz);
  const end = shiftEndUtc(shift, day, tz);
  const delay = minutes(start, checkIn);
  const late = delay > shift.grace_minutes ? delay : 0;
  let overtime = 0;
  if (checkOut) {
    const over = minutes(end, checkOut);
    overtime = over >= shift.overtime_after_minutes && over > 0 ? over : 0;
  }
  return { lateMinutes: late, overtimeMinutes: overtime, workMinutes: work };
}
