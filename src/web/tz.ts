/** Convert between <input type="datetime-local"> values (wall time in the ORGANISATION timezone) and ISO instants. */
const parts = (d: Date, tz: string) => {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return p;
};
const offsetMin = (d: Date, tz: string) => {
  const p = parts(d, tz);
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(d.getTime() / 1000) * 1000) / 60000);
};
/** "2026-11-16T09:30" in tz -> "2026-11-16T02:30:00.000Z" */
export function zonedInputToIso(value: string, tz: string): string {
  const [date, time] = value.split('T');
  const [y, m, d] = date!.split('-').map(Number);
  const [hh, mm] = time!.split(':').map(Number);
  const naive = Date.UTC(y!, m! - 1, d!, hh, mm);
  let guess = naive;
  for (let i = 0; i < 3; i++) guess = naive - offsetMin(new Date(guess), tz) * 60000;
  return new Date(guess).toISOString();
}
/** ISO instant -> "2026-11-16T09:30" wall time in tz, for datetime-local inputs. */
export function isoToZonedInput(iso: string, tz: string): string {
  const p = parts(new Date(iso), tz);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export const todayIn = (tz: string) => { const p = parts(new Date(), tz); return `${p.year}-${p.month}-${p.day}`; };
export const addDaysStr = (day: string, n: number) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10); };
