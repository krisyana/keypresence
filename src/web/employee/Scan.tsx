import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import jsQR from 'jsqr';
import { ApiError, api, qs } from '../api';
import { useAuth } from '../auth';
import { GeoError, getFix } from '../geo';
import { Alert, Badge, Button, Field, Icon, Page, Skeleton, flagLabel, fmtMinutes, fmtTime, useToast } from '../ui';
import { EmployeeStyles, KIND_ICON } from './bits';

const KINDS: [string, string][] = [
  ['attendance', 'Attendance'],
  ['visitor', 'Visitor'],
  ['event', 'Event'],
  ['asset', 'Asset'],
  ['task', 'Task'],
];
const RESOLVE_MSG: Record<string, string> = {
  expired: "This QR code is from a previous day. Ask for today's code.",
};
const GENERIC_QR = 'This QR code is not valid.';

/** Accepts a full URL containing /s/<token> or a bare token. */
export function extractToken(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const m = /\/s\/([^/?#\s]+)/.exec(t);
  if (m) { try { return decodeURIComponent(m[1]!); } catch { return m[1]!; } }
  return /^[^\s/?#]{10,300}$/.test(t) ? t : null;
}

interface CheckResp {
  outcome: 'accepted' | 'flagged'; reasons: string[]; siteName: string;
  checkin: { check_in_at: string; check_out_at: string | null; work_minutes: number | null; late_minutes: number | null; overtime_minutes: number | null };
}
type Result =
  | { t: 'done'; action: 'in' | 'out'; r: CheckResp }
  | { t: 'rejected'; lines: string[]; qr: boolean }
  | { t: 'consent' }
  | { t: 'error'; message: string };

export default function Scan() {
  const { token: urlToken } = useParams();
  const [search] = useSearchParams();
  const out = search.get('out');
  if (!urlToken) return <Page title={out ? 'Scan to check out' : 'Scan QR code'}><EmployeeStyles /><Finder out={out} /></Page>;
  return <Page title="Check in or out"><EmployeeStyles /><Check key={urlToken} token={urlToken} out={out} /></Page>;
}

/** Live camera scanner plus a paste/enter-link fallback. */
function Finder({ out }: { out: string | null }) {
  const nav = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [camError, setCamError] = useState('');
  const [starting, setStarting] = useState(true);
  const [text, setText] = useState('');
  const [pasteError, setPasteError] = useState('');

  const go = useCallback((token: string) => nav(`/s/${encodeURIComponent(token)}${qs({ out })}`, { replace: true }), [nav, out]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const stop = () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); stream = null; };
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamError('This browser cannot open the camera.'); setStarting(false); return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const v = videoRef.current!;
        v.srcObject = s;
        await v.play().catch(() => {});
        setStarting(false);
        const tick = () => {
          if (stopped) return;
          const c = canvasRef.current;
          if (c && v.readyState >= 2 && v.videoWidth) {
            c.width = v.videoWidth; c.height = v.videoHeight;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, 0, 0);
              const img = ctx.getImageData(0, 0, c.width, c.height);
              const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
              const token = hit ? extractToken(hit.data) : null;
              if (token) { stop(); go(token); return; }
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e: any) {
        setStarting(false);
        setCamError(e?.name === 'NotAllowedError'
          ? 'Camera access was denied. Allow it in your browser settings.'
          : e?.name === 'NotFoundError' ? 'No camera was found on this device.'
          : 'The camera could not be started.');
      }
    })();
    return stop;
  }, [go]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = extractToken(text);
    if (!t) return setPasteError('That does not look like a KeyPresence QR link.');
    go(t);
  }

  return (
    <div className="stack">
      {!camError ? (
        <div className="stack-sm">
          <div className="scan-frame">
            <video ref={videoRef} muted playsInline aria-label="Camera view for scanning the QR code" />
            <canvas ref={canvasRef} hidden />
            <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
            {starting && <span className="scan-hint" role="status"><span className="spinner" aria-hidden="true" />Starting camera…</span>}
          </div>
          <p className="muted" style={{ textAlign: 'center' }}>Point the camera at the site QR code</p>
        </div>
      ) : (
        <Alert kind="warn">{camError}</Alert>
      )}
      <details key={camError ? 'open' : 'closed'} open={!!camError} className="card" style={{ padding: 0 }}>
        <summary style={{ minHeight: 52, display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px', cursor: 'pointer', fontWeight: 600 }}>
          <Icon name="qr" size={18} />Enter a code instead
        </summary>
        <form className="stack-sm" style={{ padding: '0 20px 20px' }} onSubmit={submit}>
          <Field label="QR link or code" error={pasteError || undefined}>
            {(p) => <input type="text" inputMode="url" autoComplete="off" value={text} onChange={(e) => { setText(e.target.value); setPasteError(''); }} {...p} />}
          </Field>
          <Button type="submit" variant="primary">Continue</Button>
        </form>
      </details>
    </div>
  );
}

function Check({ token, out }: { token: string; out: string | null }) {
  const { me, refresh } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [site, setSite] = useState<{ name: string } | null>(null);
  const [resolveErr, setResolveErr] = useState('');
  const [kind, setKind] = useState('attendance');
  const [ref, setRef] = useState('');
  const [phase, setPhase] = useState<'idle' | 'locating' | 'sending'>('idle');
  const [geoErr, setGeoErr] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const tz = me?.timezone ?? 'UTC';

  const outRec = useMemo(() => (out ? me?.open.find((o) => o.id === out) ?? null : null), [out, me]);
  // Opening from "Check out": kind and reference come from that record.
  useEffect(() => { if (outRec) { setKind(outRec.kind); setRef(outRec.subject_ref ?? ''); } }, [outRec]);
  const match = useMemo(
    () => outRec ?? me?.open.find((o) => o.kind === kind && (o.subject_ref ?? '') === ref.trim()) ?? null,
    [outRec, me, kind, ref],
  );
  const isOut = !!match;

  useEffect(() => {
    let live = true;
    api<{ site: { name: string } }>(`/api/sites/resolve${qs({ token })}`)
      .then((r) => live && setSite(r.site))
      .catch((e: any) => live && setResolveErr(e instanceof ApiError && e.status === 422 ? (RESOLVE_MSG[e.data?.code] ?? GENERIC_QR) : (e.message ?? 'Could not check this QR code.')));
    return () => { live = false; };
  }, [token]);

  useEffect(() => { if (result || resolveErr) headRef.current?.focus(); }, [result, resolveErr]);

  if (!me) return null;
  if (!me.user.location_consent_at && !result) {
    return <Alert kind="warn">Location consent is needed first. <Link to="/">Go to Home to agree.</Link></Alert>;
  }

  async function submit() {
    setGeoErr(''); setResult(null);
    if (kind === 'visitor' && !ref.trim()) { setGeoErr('Enter the visitor name or reference first.'); return; }
    setPhase('locating');
    let fix;
    try { fix = await getFix(); } catch (e) {
      setPhase('idle');
      setGeoErr(e instanceof GeoError ? e.message : 'Location error. Try again.');
      return;
    }
    setPhase('sending');
    const action = isOut ? 'out' : 'in';
    try {
      const r = await api<CheckResp>(`/api/checkins/${action}`, {
        body: {
          token, kind, subjectRef: ref.trim() || null, checkinId: match?.id,
          lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, fixTimestamp: fix.fixTimestamp,
        },
      });
      setResult({ t: 'done', action, r });
      toast(`${action === 'in' ? 'Checked in' : 'Checked out'} · ${r.siteName}${r.outcome === 'flagged' ? ' (needs review)' : ''}`, r.outcome === 'flagged' ? 'info' : 'ok');
      await refresh();
    } catch (e: any) {
      setResult(toFailure(e));
    } finally { setPhase('idle'); }
  }

  const busy = phase !== 'idle';
  const needsRef = kind !== 'attendance' && !outRec;
  return (
    <div className="stack">
      <div aria-live="polite" className="stack">
        {resolveErr && (
          <div className="card result bad">
            <span className="result-icon bad"><Icon name="x" size={44} /></span>
            <h2 ref={headRef} tabIndex={-1}>QR code problem</h2>
            <p>{resolveErr}</p>
            <div className="result-actions"><Link to={`/scan${qs({ out })}`} className="btn primary big">Scan again</Link></div>
          </div>
        )}
        {!site && !resolveErr && <div className="card"><Skeleton lines={3} /></div>}
        {result && <ResultView result={result} tz={tz} headRef={headRef} onRetry={() => (result.t === 'rejected' && result.qr ? nav(`/scan${qs({ out })}`) : void submit())} />}
      </div>

      {site && !result && (
        <div className="card stack">
          <div className="stack-xs">
            <span className="small muted row" style={{ gap: 6 }}><Icon name="pin" size={16} />Site</span>
            <h2 style={{ fontSize: '1.6rem' }}>{site.name}</h2>
          </div>
          {outRec ? (
            <p className="muted">Checking out of {KINDS.find(([v]) => v === outRec.kind)?.[1] ?? outRec.kind}{outRec.subject_ref ? ` · ${outRec.subject_ref}` : ''}</p>
          ) : (
            <fieldset className="chips" disabled={busy}>
              <legend className="sr-only">Type</legend>
              {KINDS.map(([v, l]) => (
                <label key={v} className="chip">
                  <input type="radio" name="kind" value={v} checked={kind === v} onChange={() => setKind(v)} />
                  <Icon name={KIND_ICON[v] ?? 'clock'} size={22} />{l}
                </label>
              ))}
            </fieldset>
          )}
          {needsRef && (
            <Field label={kind === 'visitor' ? 'Visitor name or reference' : 'Reference (optional)'}>
              {(p) => <input type="text" maxLength={80} required={kind === 'visitor'} value={ref} disabled={busy} onChange={(e) => setRef(e.target.value)} {...p} />}
            </Field>
          )}
          {isOut && !outRec && <Badge kind="info" dot>Checked in here, this will check you out</Badge>}
          {geoErr && <Alert kind="bad">{geoErr}</Alert>}
          <div role="status" className="sr-only">{phase === 'locating' ? 'Getting your location' : phase === 'sending' ? 'Sending' : ''}</div>
          <Button variant="primary" size="big" busy={busy} onClick={submit}>
            {phase === 'locating' ? 'Locating…' : phase === 'sending' ? 'Sending…' : geoErr ? 'Try again' : isOut ? 'Check out' : 'Check in'}
          </Button>
        </div>
      )}
      {!result && site && <Button onClick={() => nav('/')}>Cancel</Button>}
    </div>
  );
}

function toFailure(e: any): Result {
  if (e instanceof ApiError) {
    if (e.status === 403 && e.code === 'CONSENT_REQUIRED') return { t: 'consent' };
    if (e.status === 422) return { t: 'rejected', lines: explain(e.data), qr: ((e.data?.reasons ?? []) as string[]).some((r) => r.startsWith('QR_')) };
    if (e.status === 409) return { t: 'error', message: e.message };
  }
  return { t: 'error', message: e?.message ?? 'Something went wrong. Try again.' };
}

const fmtM = (n: number) => Math.round(n).toLocaleString('en-GB');
function explain(d: any): string[] {
  const reasons: string[] = d?.reasons ?? [];
  const lines: string[] = [];
  for (const r of reasons) {
    if (r === 'OUTSIDE_FENCE' && typeof d.distanceM === 'number') {
      lines.push(`You are ${fmtM(d.distanceM)} m from the site; the allowed distance is ${fmtM(d.radiusM)} m.`);
    } else if (r === 'LOW_ACCURACY') {
      lines.push(d.accuracyM != null ? `GPS accuracy was ±${fmtM(d.accuracyM)} m; the site needs a better signal. Move outdoors or near a window and try again.` : 'GPS accuracy was too low. Move outdoors and try again.');
    } else if (r === 'QR_EXPIRED') lines.push("This QR code is from a previous day. Ask for today's code.");
    else if (r.startsWith('QR_')) lines.push(GENERIC_QR);
    else if (r === 'STALE_FIX') lines.push('Your location reading was out of date. Try again.');
    else lines.push(flagLabel(r) + '.');
  }
  return lines.length ? lines : ['The check was rejected.'];
}

function ResultView({ result, tz, headRef, onRetry }: { result: Result; tz: string; headRef: React.RefObject<HTMLHeadingElement | null>; onRetry: () => void }) {
  if (result.t === 'done') {
    const { r, action } = result;
    const flagged = r.outcome === 'flagged';
    const c = r.checkin;
    const tone = flagged ? 'warn' : 'ok';
    const when = fmtTime(action === 'in' ? c.check_in_at : c.check_out_at, tz);
    const rows: [string, string][] = [];
    if (action === 'out') rows.push(['Worked', fmtMinutes(c.work_minutes)]);
    if (c.late_minutes) rows.push(['Late', `${c.late_minutes} min`]);
    if (action === 'out' && c.overtime_minutes) rows.push(['Overtime', `${c.overtime_minutes} min`]);
    return (
      <div className={`card result ${tone}`}>
        <span className={`result-icon ${tone}`}><Icon name={flagged ? 'alert' : 'check'} size={48} /></span>
        <h2 ref={headRef} tabIndex={-1}>{action === 'in' ? 'Checked in' : 'Checked out'} at {r.siteName} · {when}</h2>
        {flagged && (
          <>
            <p>Saved, marked for HR review.</p>
            <div className="row">{r.reasons.map((x) => <Badge key={x} kind="warn">{flagLabel(x)}</Badge>)}</div>
          </>
        )}
        {rows.length > 0 && <dl className="kv">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>}
        <div className="result-actions">
          <Link to="/" className="btn primary big">Done</Link>
          <Link to="/history" className="btn">View history</Link>
        </div>
      </div>
    );
  }
  if (result.t === 'consent') {
    return (
      <div className="card result warn">
        <span className="result-icon warn"><Icon name="shield" size={44} /></span>
        <h2 ref={headRef} tabIndex={-1}>Consent needed</h2>
        <p>Agree to location use on Home first.</p>
        <div className="result-actions"><Link to="/" className="btn primary big">Go to Home</Link></div>
      </div>
    );
  }
  const lines = result.t === 'rejected' ? result.lines : [result.message];
  return (
    <div className="card result bad">
      <span className="result-icon bad"><Icon name="x" size={44} /></span>
      <h2 ref={headRef} tabIndex={-1}>{result.t === 'rejected' ? 'Not accepted' : 'Could not complete'}</h2>
      <p><strong>{lines[0]}</strong></p>
      {lines.slice(1).map((l) => <p key={l} className="small">{l}</p>)}
      <div className="result-actions">
        <Button variant="primary" size="big" onClick={onRetry}>{result.t === 'rejected' && result.qr ? 'Scan again' : 'Try again'}</Button>
        <Link to="/" className="btn">Back to home</Link>
      </div>
    </div>
  );
}
