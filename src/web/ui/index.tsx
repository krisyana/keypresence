import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span role="status" className="row"><span className="spinner" aria-hidden="true" /><span className="sr-only">{label}</span></span>;
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'bad' | 'ok' | 'warn'; children: ReactNode }) {
  return <div className={`alert ${kind}`} role={kind === 'bad' ? 'alert' : 'status'}>{children}</div>;
}

export function Badge({ kind = 'info', children }: { kind?: 'info' | 'ok' | 'warn' | 'bad' | ''; children: ReactNode }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

export function Button({ variant, size, busy, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger'; size?: 'sm' | 'big'; busy?: boolean }) {
  return (
    <button {...p} disabled={p.disabled || busy} className={['btn', variant, size, p.className].filter(Boolean).join(' ')} type={p.type ?? 'button'}>
      {busy && <span className="spinner" aria-hidden="true" />}{children}
    </button>
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

export function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-label={title} onClose={onClose} onCancel={onClose}>
      <h2>{title}</h2>
      {open && children}
    </dialog>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted" style={{ padding: '1rem', textAlign: 'center' }}>{children}</p>;
}

export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  useEffect(() => { document.title = `${title} · KeyPresence`; }, [title]);
  return (
    <section className="stack">
      <div className="row between"><h1 style={{ margin: 0 }}>{title}</h1><div className="row">{actions}</div></div>
      {children}
    </section>
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
