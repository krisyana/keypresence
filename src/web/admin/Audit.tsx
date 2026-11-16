import { useMemo, useState } from 'react';
import { Badge, Card, Empty, Field, Page, fmtDateTime } from '../ui';
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
  return (
    <Page title="Audit log" subtitle="The latest 200 admin and system actions.">
      <Async loading={list.loading} error={list.error} hasData={!!list.data}>
        {list.data && (list.data.items.length === 0 ? <Card><Empty icon="shield" title="No entries yet" /></Card> : (
          <Card flush>
            <div className="toolbar" role="search" aria-label="Filter audit log">
              <Field label="Search">{(p) => <input {...p} type="search" placeholder="Action, entity or person" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
            </div>
            {rows.length === 0 ? <Empty icon="shield" title="No matches" /> : (
              <div className="table-wrap"><table className="table-compact">
                <caption className="sr-only">Audit log</caption>
                <thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Entity</th><th scope="col">Details</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.id}>
                    <td className="num-cell">{fmtDateTime(r.at, tz)}</td>
                    <td>{r.actor_name ?? <span className="muted">System</span>}</td>
                    <td><Badge kind={actionKind(r.action)}><span className="mono">{r.action}</span></Badge></td>
                    <td>{r.entity}{r.entity_id && <span className="cell-sub mono">{r.entity_id.slice(0, 8)}</span>}</td>
                    <td>
                      <div className="small" style={{ overflowWrap: 'anywhere' }}>{kv(r.detail)}</div>
                      {r.detail !== null && r.detail !== undefined && <details><summary className="small muted">Raw JSON</summary><pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(r.detail, null, 2)}</pre></details>}
                    </td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </Card>
        ))}
      </Async>
    </Page>
  );
}
