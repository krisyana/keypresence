import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Alert, Badge, Button, Empty, Field, Modal, Page, Spinner } from '../ui';
import { A, Async, ENFORCEMENT_LABEL, errMsg, useLoad, type Site } from './shared';

function SiteForm({ site, onClose, onSaved }: { site: Site | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(site?.name ?? '');
  const [lat, setLat] = useState(site ? String(site.lat) : '');
  const [lng, setLng] = useState(site ? String(site.lng) : '');
  const [radius, setRadius] = useState(String(site?.radiusM ?? 100));
  const [acc, setAcc] = useState(String(site?.maxAccuracyM ?? 50));
  const [enf, setEnf] = useState<Site['enforcement']>(site?.enforcement ?? 'reject');
  const [active, setActive] = useState(site?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function useHere() {
    setErr(null);
    if (!navigator.geolocation) { setErr('This browser cannot provide your position. Enter the coordinates by hand.'); return; }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLat(p.coords.latitude.toFixed(6)); setLng(p.coords.longitude.toFixed(6)); setGeoBusy(false); },
      (e) => { setErr(`Could not get your position (${e.message}). Allow location access or enter the coordinates by hand.`); setGeoBusy(false); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const body = { name, lat: Number(lat), lng: Number(lng), radiusM: Number(radius), maxAccuracyM: Number(acc), enforcement: enf, active };
    if (lat === '' || lng === '' || !Number.isFinite(body.lat) || !Number.isFinite(body.lng)) { setErr('Latitude and longitude are required.'); return; }
    setBusy(true);
    try {
      await api(site ? `${A}/sites/${site.id}` : `${A}/sites`, { method: site ? 'PATCH' : 'POST', body });
      onSaved();
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      {err && <Alert kind="bad">{err}</Alert>}
      <Field label="Name">{(p) => <input {...p} required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <div className="form-grid">
        <Field label="Latitude">{(p) => <input {...p} type="number" step="any" min={-90} max={90} required value={lat} onChange={(e) => setLat(e.target.value)} />}</Field>
        <Field label="Longitude">{(p) => <input {...p} type="number" step="any" min={-180} max={180} required value={lng} onChange={(e) => setLng(e.target.value)} />}</Field>
      </div>
      <div><Button onClick={useHere} busy={geoBusy}>Use my current position</Button></div>
      <div className="form-grid">
        <Field label="Radius (metres)" hint="5 to 5000. How far from the point counts as on site.">{(p) => <input {...p} type="number" min={5} max={5000} step={1} required value={radius} onChange={(e) => setRadius(e.target.value)} />}</Field>
        <Field label="Max GPS accuracy (metres)" hint="5 to 1000. Fixes less precise than this are treated as unreliable.">{(p) => <input {...p} type="number" min={5} max={1000} step={1} required value={acc} onChange={(e) => setAcc(e.target.value)} />}</Field>
      </div>
      <Field label="Outside the fence">
        {(p) => <select {...p} value={enf} onChange={(e) => setEnf(e.target.value as Site['enforcement'])}>
          {Object.entries(ENFORCEMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>}
      </Field>
      <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
      <div className="row between">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={busy}>{site ? 'Save changes' : 'Create site'}</Button>
      </div>
    </form>
  );
}

interface QrData { siteName: string; day: string; url: string; svg: string }

function QrView({ site, onClose }: { site: Site; onClose: () => void }) {
  const [qr, setQr] = useState<QrData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rotated, setRotated] = useState(false);

  const load = () => api<QrData>(`${A}/sites/${site.id}/qr`).then((d) => { setQr(d); setErr(null); }).catch((e) => setErr(errMsg(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [site.id]);

  async function copy() {
    if (!qr) return;
    try { await navigator.clipboard.writeText(qr.url); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setErr('Could not copy automatically. Select the link text and copy it by hand.'); }
  }
  async function rotate() {
    setBusy(true); setErr(null);
    try { await api(`${A}/sites/${site.id}/qr/rotate`, { method: 'POST', body: {} }); setConfirm(false); setRotated(true); setQr(null); await load(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      {err && <Alert kind="bad">{err}</Alert>}
      {rotated && <Alert kind="ok">QR code rotated. Every earlier printed or shown code for this site is now invalid. Print the new one.</Alert>}
      {!qr && !err && <Spinner />}
      {qr && (
        <div className="stack" style={{ textAlign: 'center', justifyItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Scan to check in</h3>
          <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{qr.siteName}</div>
          <div className="muted">Valid on {qr.day}</div>
          <div className="qr-box" dangerouslySetInnerHTML={{ __html: qr.svg }} role="img" aria-label={`QR code for ${qr.siteName}, valid ${qr.day}`} />
          <div className="noprint stack-sm" style={{ width: '100%' }}>
            <span className="small muted">Link: </span>
            <code className="mono" style={{ overflowWrap: 'anywhere' }}>{qr.url}</code>
            <div className="row" style={{ justifyContent: 'center' }}>
              <Button onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</Button>
              <Button onClick={() => window.print()}>Print</Button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>Codes change automatically every day, so print or display a fresh one each morning. A code only works together with a location check.</p>
          </div>
        </div>
      )}
      <div className="noprint stack-sm">
        {confirm ? (
          <Alert kind="warn">
            <p style={{ marginTop: 0 }}><strong>Rotate the QR code for {site.name}?</strong> This immediately invalidates every printed or shown code for this site, including today&apos;s. Use it if a code leaked.</p>
            <div className="row"><Button variant="danger" busy={busy} onClick={() => void rotate()}>Yes, rotate now</Button><Button onClick={() => setConfirm(false)}>Keep current code</Button></div>
          </Alert>
        ) : <div><Button variant="danger" onClick={() => setConfirm(true)}>Rotate QR code</Button></div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><Button onClick={onClose}>Close</Button></div>
      </div>
    </div>
  );
}

export default function Sites() {
  const list = useLoad<{ items: Site[] }>(`${A}/sites`);
  const [editing, setEditing] = useState<{ site: Site | null } | null>(null);
  const [qrSite, setQrSite] = useState<Site | null>(null);
  const [saved, setSaved] = useState(false);
  return (
    <>
      <div className="noprint">
        <Page title="Sites" actions={<Button variant="primary" onClick={() => { setSaved(false); setEditing({ site: null }); }}>Add site</Button>}>
          {saved && <Alert kind="ok">Saved.</Alert>}
          <Async loading={list.loading} error={list.error} hasData={!!list.data}>
            {list.data && (list.data.items.length === 0 ? <Empty>No sites yet. Add the first one to generate a QR code.</Empty> : (
              <div className="card flush table-wrap"><table>
                <caption className="sr-only">Sites and geofences</caption>
                <thead><tr><th scope="col">Name</th><th scope="col">Geofence</th><th scope="col">Outside the fence</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>{list.data.items.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.radiusM} m radius, GPS accuracy up to {s.maxAccuracyM} m</td>
                    <td>{ENFORCEMENT_LABEL[s.enforcement]}</td>
                    <td><Badge kind={s.active ? 'ok' : ''}>{s.active ? 'Active' : 'Inactive'}</Badge></td>
                    <td><div className="row" style={{ gap: '0.4rem' }}>
                      <Button size="sm" aria-label={`QR code for ${s.name}`} onClick={() => setQrSite(s)}>QR code</Button>
                      <Button size="sm" aria-label={`Edit ${s.name}`} onClick={() => { setSaved(false); setEditing({ site: s }); }}>Edit</Button>
                    </div></td>
                  </tr>))}</tbody>
              </table></div>
            ))}
          </Async>
        </Page>
      </div>
      <Modal title={editing?.site ? 'Edit site' : 'Add site'} open={!!editing} onClose={() => setEditing(null)}>
        {editing && <SiteForm site={editing.site} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setSaved(true); list.reload(); }} />}
      </Modal>
      <Modal title={qrSite ? `QR code: ${qrSite.name}` : 'QR code'} open={!!qrSite} onClose={() => setQrSite(null)}>
        {qrSite && <QrView site={qrSite} onClose={() => setQrSite(null)} />}
      </Modal>
    </>
  );
}
