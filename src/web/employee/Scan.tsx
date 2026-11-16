import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import jsQR from 'jsqr';
import { ApiError, api, qs } from '../api';
import { useAuth } from '../auth';
import { GeoError, getFix } from '../geo';
import { Alert, Badge, Button, Field, Page, Spinner, flagLabel, fmtMinutes, fmtTime } from '../ui';

const KINDS: [string, string][] = [
  ['attendance', 'Attendance (my work day)'],
  ['visitor', 'Visitor (someone visiting)'],
  ['event', 'Event'],
  ['asset', 'Asset or equipment'],
  ['task', 'Task or job'],
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
  | { t: 'rejected'; lines: string[] }
  | { t: 'consent' }
  | { t: 'error'; message: string };

export default function Scan() {
  const { token: urlToken } = useParams();
  const [search] = useSearchParams();
  const out = search.get('out');
  if (!urlToken) return <Page title="Scan QR code"><Finder out={out} /></Page>;
  return <Page title="Check in or out"><Check key={urlToken} token={urlToken} out={out} /></Page>;
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
        setCamError('This browser cannot open the camera. Paste the link below instead.'); setStarting(false); return;
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
          ? 'Camera permission was denied. Allow the camera for this site in your browser settings, or paste the link below.'
          : e?.name === 'NotFoundError' ? 'No camera was found on this device. Paste the link below instead.'
          : 'The camera could not be started. Paste the link below instead.');
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
      {out && <Alert kind="info">Scan the site QR code to check out.</Alert>}
      {!camError && (
        <div className="card stack-sm">
          <video ref={videoRef} muted playsInline aria-label="Camera view for scanning the QR code" style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)', minHeight: 200 }} />
          <canvas ref={canvasRef} hidden />
          <p className="muted small" style={{ margin: 0 }} role="status">
            {starting ? 'Starting camera…' : 'Point the camera at the QR code. It scans automatically.'}
          </p>
        </div>
      )}
      {camError && <Alert kind="warn">{camError}</Alert>}
      <form className="card stack" onSubmit={submit}>
        <Field label="Or paste the QR link" hint="Paste the link or code from the QR." error={pasteError || undefined}>
          {(p) => <input type="text" inputMode="url" autoComplete="off" value={text} onChange={(e) => { setText(e.target.value); setPasteError(''); }} {...p} />}
        </Field>
        <Button type="submit" variant="primary">Continue</Button>
      </form>
      <Link to="/" className="btn">Back to home</Link>
    </div>
  );
}

function Check({ token, out }: { token: string; out: string | null }) {
  const { me, refresh } = useAuth();
  const nav = useNavigate();
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
    return <Alert kind="warn">Location consent is needed before you can check in. <Link to="/">Go to Home to review and agree.</Link></Alert>;
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
      await refresh();
    } catch (e: any) {
      setResult(toFailure(e));
    } finally { setPhase('idle'); }
  }

  const busy = phase !== 'idle';
  return (
    <div className="stack">
      <div aria-live="polite" className="stack">
        {resolveErr && (
          <>
            <h2 ref={headRef} tabIndex={-1} style={{ margin: 0 }}>QR code problem</h2>
            <Alert kind="bad">{resolveErr}</Alert>
            <Link to={`/scan${qs({ out })}`} className="btn primary">Scan again</Link>
          </>
        )}
        {!site && !resolveErr && <Spinner label="Checking QR code" />}
        {result && <ResultView result={result} tz={tz} headRef={headRef} onRetry={() => setResult(null)} />}
      </div>

      {site && result?.t !== 'done' && result?.t !== 'consent' && (
        <div className="card stack">
          <div>
            <div className="small muted">Site</div>
            <h2 style={{ margin: 0 }}>{site.name}</h2>
          </div>
          <Field label="Kind of check-in">
            {(p) => (
              <select value={kind} disabled={!!outRec || busy} onChange={(e) => setKind(e.target.value)} {...p}>
                {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            )}
          </Field>
          <Field label={kind === 'visitor' ? 'Visitor name or reference' : 'Room / asset / task reference (optional)'}>
            {(p) => <input type="text" maxLength={80} required={kind === 'visitor'} value={ref} disabled={!!outRec || busy} onChange={(e) => setRef(e.target.value)} {...p} />}
          </Field>
          {isOut && <Alert kind="info">You are checked in here{match?.site_name ? ` (${match.site_name})` : ''}. This will check you out.</Alert>}
          {phase === 'locating' && <div className="row" role="status"><span className="spinner" aria-hidden="true" /> Getting your location…</div>}
          {phase === 'sending' && <div className="row" role="status"><span className="spinner" aria-hidden="true" /> Sending…</div>}
          {geoErr && (
            <Alert kind="bad">{geoErr}</Alert>
          )}
          <Button variant="primary" size="big" busy={busy} onClick={submit}>
            {geoErr && !busy ? 'Try again' : isOut ? 'Check out' : 'Check in'}
          </Button>
          <p className="small muted" style={{ margin: 0 }}>Your location is read once, when you press the button.</p>
        </div>
      )}
      {!result && <Button onClick={() => nav('/')}>Cancel</Button>}
    </div>
  );
}

function toFailure(e: any): Result {
  if (e instanceof ApiError) {
    if (e.status === 403 && e.code === 'CONSENT_REQUIRED') return { t: 'consent' };
    if (e.status === 422) return { t: 'rejected', lines: explain(e.data) };
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
  const links = (
    <div className="row">
      <Link to="/" className="btn primary">Back to home</Link>
      <Link to="/history" className="btn">View history</Link>
    </div>
  );
  if (result.t === 'done') {
    const { r, action } = result;
    const flagged = r.outcome === 'flagged';
    const c = r.checkin;
    const when = fmtTime(action === 'in' ? c.check_in_at : c.check_out_at, tz);
    return (
      <div className="stack">
        <Alert kind={flagged ? 'warn' : 'ok'}>
          <h2 ref={headRef} tabIndex={-1} style={{ margin: 0 }}>
            {action === 'in' ? 'Checked in' : 'Checked out'} at {r.siteName} · {when}
          </h2>
          {flagged && (
            <div className="stack-sm" style={{ marginTop: '0.5rem' }}>
              <div>Accepted, but marked for HR review:</div>
              <div className="row">{r.reasons.map((x) => <Badge key={x} kind="warn">{flagLabel(x)}</Badge>)}</div>
            </div>
          )}
          {action === 'out' && (
            <p style={{ margin: '0.5rem 0 0' }}>
              Worked {fmtMinutes(c.work_minutes)}
              {c.late_minutes ? ` · Late ${c.late_minutes} min` : ''}
              {c.overtime_minutes ? ` · Overtime ${c.overtime_minutes} min` : ''}
            </p>
          )}
        </Alert>
        {links}
      </div>
    );
  }
  if (result.t === 'consent') {
    return (
      <div className="stack">
        <h2 ref={headRef} tabIndex={-1} style={{ margin: 0 }}>Consent needed</h2>
        <Alert kind="warn">Location consent is required before checking in. <Link to="/">Go to Home to review and agree.</Link></Alert>
      </div>
    );
  }
  const lines = result.t === 'rejected' ? result.lines : [result.message];
  return (
    <div className="stack">
      <Alert kind="bad">
        <h2 ref={headRef} tabIndex={-1} style={{ margin: 0 }}>{result.t === 'rejected' ? 'Not accepted' : 'Could not complete'}</h2>
        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
      </Alert>
      <div className="row">
        <Button variant="primary" onClick={onRetry}>Try again</Button>
        <Link to="/" className="btn">Back to home</Link>
      </div>
    </div>
  );
}
