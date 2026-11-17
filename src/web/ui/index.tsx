import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Button as KitButton, Dialog as KitDialog } from '@kit/ui';
import { Icon, type IconName } from './icons';
export { Icon } from './icons';
export type { IconName } from './icons';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span role="status" className="row"><span className="spinner" aria-hidden="true" /><span className="sr-only">{label}</span></span>;
}

const ALERT_ICON: Record<string, IconName> = { info: 'info', bad: 'alert', warn: 'alert', ok: 'check' };
export function Alert({ kind = 'info', children }: { kind?: 'info' | 'bad' | 'ok' | 'warn'; children: ReactNode }) {
  return (
    <div className={`alert ${kind}`} role={kind === 'bad' ? 'alert' : 'status'}>
      <Icon name={ALERT_ICON[kind]!} size={20} className="alert-icon" />
      <div className="alert-body">{children}</div>
    </div>
  );
}

export function Badge({ kind = 'info', dot, children }: { kind?: 'info' | 'ok' | 'warn' | 'bad' | ''; dot?: boolean; children: ReactNode }) {
  return <span className={`badge ${kind}`}>{dot && <i className="dot" aria-hidden="true" />}{children}</span>;
}

/** Our Button is the kit's Button (busy stays focusable and ignores clicks, aria-busy) with KeyPresence styling on top. */
export function Button({ variant, size, busy, children, ...p }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & { className?: string; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'sm' | 'big'; busy?: boolean }) {
  return (
    <KitButton {...p} variant={variant === 'ghost' || !variant ? 'secondary' : variant} busy={busy} className={['btn', variant, size, p.className].filter(Boolean).join(' ')}>
      {busy && <span className="spinner" aria-hidden="true" />}{children}
    </KitButton>
  );
}

/** Label + control + optional hint, wired with ids so screen readers announce them together. */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (p: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode }) {
  const id = useId();
  const d = [hint && `${id}-h`, error && `${id}-e`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': d, 'aria-invalid': error ? true : undefined })}
      {hint && <span id={`${id}-h`} className="hint">{hint}</span>}
      {error && <span id={`${id}-e`} className="hint" style={{ color: 'var(--danger)' }}>{error}</span>}
    </div>
  );
}

/** Modal on the kit's Dialog (native <dialog>: focus trap, Esc, focus restore, backdrop click, labelled by the title). */
export function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <KitDialog open={open} onClose={onClose} title={title}>
      {open && (
        <>
          <button type="button" className="icon-btn modal-x" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button>
          {children}
        </>
      )}
    </KitDialog>
  );
}

export function Empty({ icon = 'inbox', title, children, action }: { icon?: IconName; title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={26} /></span>
      {title && <strong>{title}</strong>}
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  useEffect(() => { document.title = `${title} · KeyPresence`; }, [title]);
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted page-sub">{subtitle}</p>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/** Surface with an optional heading row. Use instead of nesting a bare .card. */
export function Card({ title, actions, flush, children }: { title?: string; actions?: ReactNode; flush?: boolean; children: ReactNode }) {
  return (
    <div className={`card${flush ? ' flush' : ''}`}>
      {(title || actions) && <div className="card-head"><h2>{title}</h2><div className="row">{actions}</div></div>}
      {children}
    </div>
  );
}

/** KPI tile: icon, big number, label, optional tone and link. */
export function Stat({ icon, label, value, sub, tone, to }: { icon: IconName; label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'bad'; to?: ReactNode }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-icon"><Icon name={icon} size={20} /></span>
      <div className="stat-n">{value}</div>
      <div className="stat-l">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
      {to}
    </div>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  return <span className="avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.4, ['--h' as string]: hue }}>{initials}</span>;
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className="skeleton" role="status" aria-label="Loading">{Array.from({ length: lines }, (_, i) => <span key={i} style={{ width: `${90 - i * 15}%` }} />)}</div>;
}

// ---- Toasts: transient confirmation for saves and background actions ----
type ToastKind = 'ok' | 'bad' | 'info';
interface ToastItem { id: number; kind: ToastKind; text: string }
const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, kind: ToastKind = 'ok') => {
    const id = ++seq.current;
    setItems((x) => [...x.slice(-2), { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'bad' ? 7000 : 4000);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon name={t.kind === 'bad' ? 'alert' : t.kind === 'ok' ? 'check' : 'info'} size={18} />
            <span>{t.text}</span>
            <button className="toast-x" aria-label="Dismiss" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}><Icon name="x" size={16} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const FLAG_LABEL: Record<string, string> = {
  OUTSIDE_FENCE: 'Outside fence', LOW_ACCURACY: 'Low GPS accuracy', IMPOSSIBLE_TRAVEL: 'Impossible travel', SPOOF_SIGNAL: 'Spoof signal',
  STALE_FIX: 'Stale location', AUTO_CLOSED: 'Auto-closed', ADMIN_OVERRIDE: 'Admin override', DIFFERENT_SITE: 'Different site',
  INVALID_COORDS: 'Invalid location', QR_EXPIRED: 'QR expired', QR_ROTATED: 'QR replaced', QR_BAD_SIGNATURE: 'QR not valid', QR_MALFORMED: 'QR not valid', QR_UNKNOWN_SITE: 'Unknown site',
};
export const flagLabel = (f: string) => FLAG_LABEL[f] ?? f;

export function fmtDateTime(iso: string | null | undefined, tz: string) {
  if (!iso) return '–';
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
export function fmtTime(iso: string | null | undefined, tz: string) {
  if (!iso) return '–';
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
export const fmtMinutes = (m: number | null | undefined) => (m === null || m === undefined ? '–' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);
