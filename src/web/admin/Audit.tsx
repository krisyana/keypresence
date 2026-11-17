import { useMemo, useState } from 'react';
import { Badge, Card, Empty, Field, Page, fmtTime } from '../ui';
import { A, Async, kv, useLoad, useOrgTz } from './shared';

interface Row { id: number; at: string; action: string; entity: string; entity_id: string | null; detail: unknown; actor_name: string | null }

const actionKind = (a: string): 'ok' | 'warn' | 'info' => (/delete|reject|rotate|override|deactivate|denied/i.test(a) ? 'warn' : /create|approve|add|login/i.test(a) ? 'ok' : 'info');

export default function Audit() {
  const tz = useOrgTz();
  const list = useLoad<{ items: Row[] }>(`${A}/audit`);
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (list.data?.items ?? []).filter((r) => !s || `${r.action} ${r.entity} ${r.actor_name ?? 'system'}`.toLowerCase().includes(s));
  }, [list.data, q]);
  const dayOf = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
  const groups = rows.reduce<{ day: string; rows: Row[] }[]>((acc, r) => { const d = dayOf(r.at); const g = acc[acc.length - 1]; if (g && g.day === d) g.rows.push(r); else acc.push({ day: d, rows: [r] }); return acc; }, []);
  return (
    <Page title="Audit log" subtitle="The latest 200 admin and system actions.">
      <Async loading={list.loading} error={list.error} hasData={!!list.data}>
        {list.data && (list.data.items.length === 0 ? <Card><Empty icon="shield" title="No entries yet">Admin actions such as creating a site, overriding a record or rotating a QR code are recorded here.</Empty></Card> : (
          <>
            <div className="list-controls" role="search" aria-label="Filter audit log">
              <Field label="Search">{(p) => <input {...p} type="search" placeholder="Action, entity or person" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
            </div>
            <Card flush>
              {rows.length === 0 ? <Empty icon="shield" title="No matches" /> : (
                <div className="table-wrap"><table className="table-compact rec-table responsive">
                  <caption className="sr-only">Audit log, grouped by day</caption>
                  <thead><tr><th scope="col">Time and person</th><th scope="col">What happened</th><th scope="col">Details</th></tr></thead>
                  {groups.map((g) => (
                    <tbody key={g.day}>
                      <tr className="day-row"><th scope="colgroup" colSpan={3}>{g.day} <span className="muted">{g.rows.length}</span></th></tr>
                      {g.rows.map((r) => (
                        <tr key={r.id}>
                          <td className="num-cell">{fmtTime(r.at, tz)}<span className="cell-sub">{r.actor_name ?? 'System'}</span></td>
                          <td><Badge kind={actionKind(r.action)}><span className="mono">{r.action}</span></Badge><span className="cell-sub">{r.entity}{r.entity_id && <span className="mono"> {r.entity_id.slice(0, 8)}</span>}</span></td>
                          <td className="wrap">
                            <div className="small" style={{ overflowWrap: 'anywhere' }}>{kv(r.detail)}</div>
                            {r.detail !== null && r.detail !== undefined && <details><summary className="small muted">Raw JSON</summary><pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(r.detail, null, 2)}</pre></details>}
                          </td>
                        </tr>))}
                    </tbody>
                  ))}
                </table></div>
              )}
            </Card>
          </>
        ))}
      </Async>
    </Page>
  );
}
