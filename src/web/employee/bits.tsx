import { useEffect, useState } from 'react';
import { Badge, Icon, flagLabel, type IconName } from '../ui';
import { addDaysStr, todayIn } from '../tz';

export interface Rec {
  id: string; kind: string; subject_ref: string | null; day: string; status: string; check_in_at: string; check_out_at: string | null;
  in_flags: string[]; out_flags: string[] | null; review_status: string; late_minutes: number | null; overtime_minutes: number | null;
  work_minutes: number | null; closed_by: string | null; site_name: string; correction_pending: boolean;
}

export const KIND_LABEL: Record<string, string> = { attendance: 'Attendance', visitor: 'Visitor', event: 'Event', asset: 'Asset', task: 'Task' };
export const KIND_ICON: Record<string, IconName> = { attendance: 'clock', visitor: 'users', event: 'calendar', asset: 'qr', task: 'list' };

/** Employee-screen styles. Tokens only; rendered by each screen so this file stays self-contained. */
const CSS = `
.chips{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px;border:0;padding:0;margin:0;min-width:0}
.chip{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:76px;padding:10px 8px;border:1.5px solid var(--border);border-radius:12px;background:var(--surface);cursor:pointer;font-weight:600;font-size:.85rem;text-align:center;transition:background .12s,border-color .12s}
.chip:hover{background:var(--surface-2)}
.chips .chip input[type=radio]{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.chip:has(input:checked){border-color:var(--accent-edge);background:var(--accent-soft);color:var(--accent-soft-ink)}
.chip:has(input:focus-visible){outline:3px solid var(--focus);outline-offset:2px}
.chip:has(input:disabled){opacity:.55;cursor:not-allowed}
.scan-frame{position:relative;aspect-ratio:1/1;border-radius:24px;overflow:hidden;background:var(--hero-to);display:grid;place-items:center;color:var(--hero-ink)}
.scan-frame video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.scan-frame .corner{position:absolute;width:48px;height:48px;border:4px solid var(--hero-ink);opacity:.9;pointer-events:none}
.corner.tl{top:28px;left:28px;border-right:0;border-bottom:0;border-top-left-radius:16px}
.corner.tr{top:28px;right:28px;border-left:0;border-bottom:0;border-top-right-radius:16px}
.corner.bl{bottom:28px;left:28px;border-right:0;border-top:0;border-bottom-left-radius:16px}
.corner.br{bottom:28px;right:28px;border-left:0;border-top:0;border-bottom-right-radius:16px}
.scan-hint{position:relative;display:inline-flex;align-items:center;gap:8px;font-weight:600}
.scan-frame .spinner{border-color:rgb(255 255 255 / .35);border-top-color:var(--hero-ink)}
.result{display:grid;justify-items:center;text-align:center;gap:16px;border-top:5px solid var(--border)}
.result.ok{border-top-color:var(--ok-soft-ink)} .result.warn{border-top-color:var(--warn-soft-ink)} .result.bad{border-top-color:var(--danger)}
.result-icon{width:88px;height:88px;border-radius:50%;display:grid;place-items:center;animation:pop .35s ease}
.result-icon.ok{background:var(--ok-soft);color:var(--ok-soft-ink)} .result-icon.warn{background:var(--warn-soft);color:var(--warn-soft-ink)} .result-icon.bad{background:var(--danger-soft);color:var(--danger-soft-ink)}
.result h2{font-size:1.3rem}
.result .kv{width:100%;text-align:left;padding-top:8px;border-top:1px solid var(--border)}
.result .row{justify-content:center}
.result-actions{display:grid;gap:8px;width:100%}
@keyframes pop{from{transform:scale(.6);opacity:0}}
.day-label{position:sticky;top:60px;z-index:5;background:var(--bg);padding:8px 0;font-size:.8rem;font-weight:650;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.rec{display:grid;grid-template-columns:44px 1fr;gap:12px;padding:16px;align-items:start}
.rec-body{display:grid;gap:8px;min-width:0}
.rec-title{font-weight:650}
.link-btn{background:none;border:0;color:var(--muted);font:inherit;font-size:.85rem;text-decoration:underline;text-underline-offset:3px;cursor:pointer;min-height:44px;padding:0 12px}
.link-btn:hover:not(:disabled){color:var(--text)}
.note{display:grid;grid-template-columns:44px 1fr;gap:12px;padding:16px;border-radius:var(--radius);border:1px solid var(--border);background:var(--surface);align-items:start}
.note.unread{background:var(--accent-soft);border-color:transparent}
.note .tl-icon{background:var(--surface-2);color:var(--muted)}
.note.unread .tl-icon{background:var(--accent);color:var(--accent-ink)}
.unread-dot{width:9px;height:9px;border-radius:50%;background:var(--accent-edge);flex:none}
.bullets{margin:0;padding:0;list-style:none;display:grid;gap:8px}
.bullets li{display:flex;gap:10px;align-items:center}
.bullets svg{color:var(--accent-text);flex:none}
.plain-list{list-style:none;margin:0;padding:0;display:grid;gap:12px}
`;
export function EmployeeStyles() { return <style>{CSS}</style>; }

/** Ticks once a second. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** "2 h ago" style label. Falls back to a date after a week. */
export function relTime(iso: string, now: Date, tz: string): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short' }).format(new Date(iso));
}

/** "Today", "Yesterday" or "Mon 16 Nov" for a YYYY-MM-DD day string. */
export function dayLabel(day: string, tz: string): string {
  const today = todayIn(tz);
  if (day === today) return 'Today';
  if (day === addDaysStr(today, -1)) return 'Yesterday';
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

export const timeRange = (r: Pick<Rec, 'check_in_at' | 'check_out_at'>, fmt: (iso: string) => string) =>
  `${fmt(r.check_in_at)} – ${r.check_out_at ? fmt(r.check_out_at) : 'now'}`;

export function RecBadges({ r, full }: { r: Rec; full?: boolean }) {
  const flags = full ? [...(r.in_flags ?? []), ...(r.out_flags ?? [])].filter((f, i, a) => a.indexOf(f) === i && f !== 'AUTO_CLOSED') : [];
  return (
    <>
      {!r.check_out_at && <Badge kind="ok" dot>In progress</Badge>}
      {!!r.late_minutes && <Badge kind="warn">Late {r.late_minutes}m</Badge>}
      {!!r.overtime_minutes && <Badge kind="info">Overtime {r.overtime_minutes}m</Badge>}
      {r.review_status === 'pending' && <Badge kind="warn">Needs review</Badge>}
      {r.closed_by === 'auto' && <Badge kind="warn">Auto-closed</Badge>}
      {flags.map((f) => <Badge key={f} kind="warn">{flagLabel(f)}</Badge>)}
      {full && r.correction_pending && <Badge kind="info">Correction requested</Badge>}
    </>
  );
}

export function RecIcon({ kind }: { kind: string }) {
  return <span className="tl-icon"><Icon name={KIND_ICON[kind] ?? 'clock'} size={20} /></span>;
}
