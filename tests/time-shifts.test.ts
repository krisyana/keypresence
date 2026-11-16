import { describe, expect, it } from 'vitest';
import { addDays, isoDowOfDay, localParts, startOfIsoWeek, zonedToUtc } from '../src/server/domain/time';
import { computeMetrics, type ShiftRule } from '../src/server/domain/shifts';

const office: ShiftRule = { id: 's', start_time: '09:00:00', end_time: '17:00:00', grace_minutes: 10, overtime_after_minutes: 15, auto_close_after_minutes: 120, work_days: [1, 2, 3, 4, 5] };

describe('time', () => {
  it('converts local wall time to UTC for whole-hour and half-hour zones', () => {
    expect(zonedToUtc('2026-11-16', '09:00', 'Asia/Jakarta').toISOString()).toBe('2026-11-16T02:00:00.000Z');
    expect(zonedToUtc('2026-11-16', '09:00', 'Asia/Kolkata').toISOString()).toBe('2026-11-16T03:30:00.000Z');
  });
  it('handles a DST zone on both sides of the change', () => {
    expect(zonedToUtc('2026-03-07', '09:00', 'America/New_York').toISOString()).toBe('2026-03-07T14:00:00.000Z'); // EST
    expect(zonedToUtc('2026-03-09', '09:00', 'America/New_York').toISOString()).toBe('2026-03-09T13:00:00.000Z'); // EDT
  });
  it('localParts agrees with zonedToUtc', () => {
    const d = zonedToUtc('2026-11-16', '23:45', 'Asia/Kolkata');
    expect(localParts(d, 'Asia/Kolkata')).toMatchObject({ day: '2026-11-16', hh: 23, mm: 45, isoDow: 1 });
  });
  it('day arithmetic', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isoDowOfDay('2026-11-15')).toBe(7);
    expect(startOfIsoWeek('2026-11-18')).toBe('2026-11-16');
  });
});

describe('computeMetrics', () => {
  const at = (hhmm: string, day = '2026-11-16') => zonedToUtc(day, hhmm, 'Asia/Jakarta');
  const m = (i: string, o: string | null, day?: string) => computeMetrics(office, at(i, day), o ? at(o, day) : null, 'Asia/Jakarta');
  it('on time (within grace) is not late', () => expect(m('09:10', '17:00').lateMinutes).toBe(0));
  it('one minute past grace counts the whole delay', () => expect(m('09:11', '17:00').lateMinutes).toBe(11));
  it('early arrival is not late', () => expect(m('08:30', '17:00').lateMinutes).toBe(0));
  it('overtime starts at the threshold and counts from shift end', () => {
    expect(m('09:00', '17:14').overtimeMinutes).toBe(0);
    expect(m('09:00', '17:15').overtimeMinutes).toBe(15);
    expect(m('09:00', '18:30').overtimeMinutes).toBe(90);
  });
  it('work minutes', () => expect(m('09:00', '17:30').workMinutes).toBe(510));
  it('open record has null work minutes', () => expect(m('09:00', null).workMinutes).toBeNull());
  it('weekend work is all overtime and never late', () => {
    const r = m('10:00', '12:00', '2026-11-15');
    expect(r).toEqual({ lateMinutes: 0, overtimeMinutes: 120, workMinutes: 120 });
  });
  it('uses local time in a half-hour zone', () => {
    const r = computeMetrics(office, zonedToUtc('2026-11-16', '09:20', 'Asia/Kolkata'), null, 'Asia/Kolkata');
    expect(r.lateMinutes).toBe(20);
  });
  it('no shift: only work minutes', () => expect(computeMetrics(null, at('09:00'), at('10:00'), 'Asia/Jakarta')).toEqual({ lateMinutes: 0, overtimeMinutes: 0, workMinutes: 60 }));
});
