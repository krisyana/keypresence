import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Alert, Badge, Button, Card, Empty, Field, Icon, Modal, Page, Spinner, useToast } from '../ui';
import { A, Async, Confirm, ENFORCEMENT_LABEL, errMsg, fieldErrors, useLoad, type Site } from './shared';

function SiteForm({ site, onClose, onSaved }: { site: Site | null; onClose: () => void; onSaved: (name: string, created: boolean) => void }) {
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
  const [fe, setFe] = useState<Record<string, string>>({});

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
    setErr(null); setFe({});
    const body = { name, lat: Number(lat), lng: Number(lng), radiusM: Number(radius), maxAccuracyM: Number(acc), enforcement: enf, active };
    if (lat === '' || lng === '' || !Number.isFinite(body.lat) || !Number.isFinite(body.lng)) { setFe({ lat: 'Required.', lng: 'Required.' }); return; }
    setBusy(true);
    try {
      await api(site ? `${A}/sites/${site.id}` : `${A}/sites`, { method: site ? 'PATCH' : 'POST', body });
      onSaved(name, !site);
    } catch (x) { const f = fieldErrors(x); setFe(f); setErr(Object.keys(f).length ? null : errMsg(x)); } finally { setBusy(false); }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      {err && <Alert kind="bad">{err}</Alert>}
      <Field label="Name" error={fe.name}>{(p) => <input {...p} required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <div className="form-grid">
        <Field label="Latitude" error={fe.lat}>{(p) => <input {...p} type="number" step="any" min={-90} max={90} required value={lat} onChange={(e) => setLat(e.target.value)} />}</Field>
        <Field label="Longitude" error={fe.lng}>{(p) => <input {...p} type="number" step="any" min={-180} max={180} required value={lng} onChange={(e) => setLng(e.target.value)} />}</Field>
      </div>
      <div><Button onClick={useHere} busy={geoBusy}><Icon name="pin" size={16} />Use my current position</Button></div>
      <div className="form-grid">
        <Field label="Radius (metres)" hint="How far from the point counts as on site." error={fe.radiusM}>{(p) => <input {...p} type="number" min={5} max={5000} step={1} required value={radius} onChange={(e) => setRadius(e.target.value)} />}</Field>
        <Field label="Max GPS accuracy (metres)" hint="Less precise fixes are treated as unreliable." error={fe.maxAccuracyM}>{(p) => <input {...p} type="number" min={5} max={1000} step={1} required value={acc} onChange={(e) => setAcc(e.target.value)} />}</Field>
      </div>
      <Field label="Outside the fence" error={fe.enforcement}>
        {(p) => <select {...p} value={enf} onChange={(e) => setEnf(e.target.value as Site['enforcement'])}>
          {Object.entries(ENFORCEMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>}
      </Field>
      <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
      <div className="confirm-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={busy}>{site ? 'Save changes' : 'Create site'}</Button>
      </div>
    </form>
  );
}

interface QrData { siteName: string; day: string; url: string; svg: string }

function QrView({ site, onClose }: { site: Site; onClose: () => void }) {
  const toast = useToast();
  const [qr, setQr] = useState<QrData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => api<QrData>(`${A}/sites/${site.id}/qr`).then((d) => { setQr(d); setErr(null); }).catch((e) => setErr(errMsg(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [site.id]);

  async function copy() {
    if (!qr) return;
    try { await navigator.clipboard.writeText(qr.url); setCopied(true); toast('Link copied'); setTimeout(() => setCopied(false), 2500); }
    catch { setErr('Could not copy automatically. Select the link text and copy it by hand.'); }
  }
  async function rotate() {
    setBusy(true); setErr(null);
    try { await api(`${A}/sites/${site.id}/qr/rotate`, { method: 'POST', body: {} }); setConfirm(false); setQr(null); await load(); toast(`QR code for "${site.name}" rotated. Print the new one.`); }
    catch (e) { setConfirm(false); setErr(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      {err && <Alert kind="bad">{err}</Alert>}
      {!qr && !err && <Spinner />}
      {qr && (
        <div className="qr-center">
          <div><strong style={{ fontSize: '1.2rem' }}>{qr.siteName}</strong><div className="muted small">Valid on {qr.day}</div></div>
          <div className="qr-box" dangerouslySetInnerHTML={{ __html: qr.svg }} role="img" aria-label={`QR code for ${qr.siteName}, valid ${qr.day}`} />
          <div className="noprint stack-sm" style={{ width: '100%' }}>
            <div className="link-box"><span className="small muted">Link </span><code className="mono">{qr.url}</code></div>
            <div className="row" style={{ justifyContent: 'center' }}>
              <Button onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</Button>
              <Button onClick={() => window.print()}><Icon name="download" size={16} />Print</Button>
            </div>
          </div>
        </div>
      )}
      <div className="noprint confirm-actions">
        <Button variant="danger" onClick={() => setConfirm(true)}><Icon name="swap" size={16} />Rotate QR code</Button>
        <Button onClick={onClose}>Close</Button>
      </div>
      <Confirm open={confirm} danger busy={busy} title={`Rotate QR code for ${site.name}?`} confirmLabel="Rotate now" onClose={() => setConfirm(false)} onConfirm={() => void rotate()}>
        Every printed or shown code for this site stops working immediately, including today&apos;s.
      </Confirm>
    </div>
  );
}

const ENF_KIND: Record<string, 'ok' | 'warn' | ''> = { reject: 'ok', flag: 'warn', off: '' };

const ruleText = (s: Site) => s.enforcement === 'reject' ? `Rejects check-ins more than ${s.radiusM} m from the site.` : s.enforcement === 'flag' ? `Accepts check-ins more than ${s.radiusM} m away, but flags them for review.` : `Fence of ${s.radiusM} m is not enforced.`;

export default function Sites() {
  const toast = useToast();
  const list = useLoad<{ items: Site[] }>(`${A}/sites`);
  const [editing, setEditing] = useState<{ site: Site | null } | null>(null);
  const [qrSite, setQrSite] = useState<Site | null>(null);
  return (
    <>
      <div className="noprint">
        <Page title="Sites" subtitle="Places people check in, with QR codes and geofences." actions={<Button variant="primary" onClick={() => setEditing({ site: null })}><Icon name="plus" size={16} />Add site</Button>}>
          <Async loading={list.loading} error={list.error} hasData={!!list.data}>
            {list.data && (list.data.items.length === 0 ? (
              <Card><Empty icon="pin" title="No sites yet" action={<Button variant="primary" onClick={() => setEditing({ site: null })}>Add site</Button>}>Add your first site to generate a QR code.</Empty></Card>
            ) : (
              <Card flush>
                <div className="table-wrap"><table className="responsive">
                  <caption className="sr-only">Sites and geofences</caption>
                  <thead><tr><th scope="col">Site</th><th scope="col">Check-in rule</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>{list.data.items.map((s) => (
                    <tr key={s.id}>
                      <td><strong>{s.name}</strong>{!s.active && <> <Badge kind="">Inactive</Badge></>}</td>
                      <td className="wrap"><span className="rule-main">{ruleText(s)}</span><span className="cell-sub">{s.enforcement === 'off' ? 'Only the QR code is checked.' : `GPS accuracy must be within ${s.maxAccuracyM} m.`}</span></td>
                      <td><div className="row" style={{ gap: 8, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                        <Button size="sm" aria-label={`QR code for ${s.name}`} onClick={() => setQrSite(s)}><Icon name="qr" size={16} />QR code</Button>
                        <Button size="sm" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => setEditing({ site: s })}>Edit</Button>
                      </div></td>
                    </tr>))}</tbody>
                </table></div>
              </Card>
            ))}
          </Async>
        </Page>
      </div>
      <Modal title={editing?.site ? 'Edit site' : 'Add site'} open={!!editing} onClose={() => setEditing(null)}>
        {editing && <SiteForm site={editing.site} onClose={() => setEditing(null)} onSaved={(n, created) => { setEditing(null); toast(created ? `Site "${n}" created` : `Site "${n}" saved`); list.reload(); }} />}
      </Modal>
      <Modal title={qrSite ? `QR code: ${qrSite.name}` : 'QR code'} open={!!qrSite} onClose={() => setQrSite(null)}>
        {qrSite && <QrView site={qrSite} onClose={() => setQrSite(null)} />}
      </Modal>
    </>
  );
}
