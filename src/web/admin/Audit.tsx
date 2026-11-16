import { Empty, Page, fmtDateTime } from '../ui';
import { A, Async, kv, useLoad, useOrgTz } from './shared';

interface Row { id: number; at: string; action: string; entity: string; entity_id: string | null; detail: unknown; actor_name: string | null }

export default function Audit() {
  const tz = useOrgTz();
  const list = useLoad<{ items: Row[] }>(`${A}/audit`);
  return (
    <Page title="Audit log">
      <p className="muted small" style={{ margin: 0 }}>The latest 200 admin and system actions.</p>
      <Async loading={list.loading} error={list.error} hasData={!!list.data}>
        {list.data && (list.data.items.length === 0 ? <Empty>No audit entries yet.</Empty> : (
          <div className="card flush table-wrap"><table>
            <caption className="sr-only">Audit log</caption>
            <thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Entity</th><th scope="col">Details</th></tr></thead>
            <tbody>{list.data.items.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.at, tz)}</td>
                <td>{r.actor_name ?? 'System'}</td>
                <td className="mono">{r.action}</td>
                <td>{r.entity}{r.entity_id && <div className="small muted mono">{r.entity_id.slice(0, 8)}</div>}</td>
                <td>
                  <div className="small" style={{ overflowWrap: 'anywhere' }}>{kv(r.detail)}</div>
                  {r.detail !== null && r.detail !== undefined && <details><summary className="small">Raw JSON</summary><pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(r.detail, null, 2)}</pre></details>}
                </td>
              </tr>))}</tbody>
          </table></div>
        ))}
      </Async>
    </Page>
  );
}
