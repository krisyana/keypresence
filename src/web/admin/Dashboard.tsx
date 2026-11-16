import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { addDaysStr, todayIn } from '../tz';
import { Alert, Badge, Button, Card, Empty, Icon, Page, Skeleton, Stat, flagLabel, fmtDateTime, fmtMinutes, useToast } from '../ui';
import { A, Async, Segmented, errMsg, fmtDist, useLoad, useOrgTz } from './shared';

interface Summary {
  from: string; to: string;
  attendance: { presentDays: number; checkins: number; lateCount: number; lateMinutes: number; overtimeMinutes: number; flagged: number; autoClosed: number; stillOpen: number; absentDays: number };
  byDay: { day: string; checkins: number; late: number; absent: number }[];
  rejectedAttempts: number; pendingReviews: number; pendingCorrections: number;
}
interface Attempt { id: string; at: string; action: string; kind: string; outcome: string; reasons: string[]; distance_m: number | null; accuracy_m: number | null; user_name: string; site_name: string | null }
interface Anomaly { type: string; severity: 'info' | 'warn'; title: string; explanation: string }

function Stats({ s }: { s: Summary }) {
  const a = s.attendance;
  return (
    <div className="stack">
      <div className="stats">
        <Stat icon="check" tone="ok" label="Present (person-days)" value={a.presentDays} />
        <Stat icon="clock" tone="warn" label="Late arrivals" value={a.lateCount} sub={`${a.lateMinutes} min in total`} />
        <Stat icon="user" label="Absent" value={a.absentDays} />
        <Stat icon="inbox" tone={s.pendingReviews ? 'bad' : undefined} label="Needs review" value={s.pendingReviews} to={<Link to="/admin/records?review=pending">Review records</Link>} />
      </div>
      <div className="stats stats-sm">
        <Stat icon="bolt" label="Overtime" value={fmtMinutes(a.overtimeMinutes)} />
        <Stat icon="flag" label="Flagged" value={a.flagged} />
        <Stat icon="swap" label="Auto-closed" value={a.autoClosed} />
        <Stat icon="shield" label="Rejected attempts" value={s.rejectedAttempts} />
        <Stat icon="inbox" label="Pending corrections" value={s.pendingCorrections} to={<Link to="/admin/corrections">Open</Link>} />
      </div>
    </div>
  );
}

function Chart({ s }: { s: Summary }) {
  const max = Math.max(1, ...s.byDay.map((d) => d.checkins));
  const summary = `Check-ins and late arrivals per day from ${s.from} to ${s.to}`;
  return (
    <Card title="Check-ins per day" actions={<div className="legend" aria-label="Legend"><span><i />Check-ins</span><span><i className="late" />Late arrivals</span></div>}>
      <div className="stack-sm">
        <div className="chart" role="img" aria-label={summary + ': ' + s.byDay.map((d) => `${d.day} ${d.checkins} check-ins, ${d.late} late`).join('; ')}>
          {s.byDay.map((d) => (
            <div key={d.day} className="chart-col" aria-hidden="true">
              <span className="chart-n">{d.checkins}{d.late ? ` / ${d.late}` : ''}</span>
              <div className="chart-bars">
                <span title={`${d.day}: ${d.checkins} check-ins`} style={{ height: `${(d.checkins / max) * 100}%` }} />
                <span className="late" title={`${d.day}: ${d.late} late`} style={{ height: `${(d.late / max) * 100}%` }} />
              </div>
              <span className="chart-x">{d.day.slice(5)}</span>
            </div>
          ))}
        </div>
        <details>
          <summary className="small muted">Show as table</summary>
          <div className="table-wrap"><table className="table-compact">
            <caption className="sr-only">{summary}</caption>
            <thead><tr><th scope="col">Day</th><th scope="col">Check-ins</th><th scope="col">Late</th><th scope="col">Absent</th></tr></thead>
            <tbody>{s.byDay.map((d) => <tr key={d.day}><th scope="row" style={{ textTransform: 'none', background: 'none' }}>{d.day}</th><td>{d.checkins}</td><td>{d.late}</td><td>{d.absent}</td></tr>)}</tbody>
          </table></div>
        </details>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const tz = useOrgTz();
  const toast = useToast();
  const today = todayIn(tz);
  const from7 = addDaysStr(today, -6);
  const [range, setRange] = useState<'today' | 'week'>('today');
  const day = useLoad<Summary>(`${A}/summary${qs({ from: today, to: today })}`);
  const week = useLoad<Summary>(`${A}/summary${qs({ from: from7, to: today })}`);
  const attempts = useLoad<{ items: Attempt[] }>(`${A}/attempts`);
  const anomalies = useLoad<{ items: Anomaly[] }>(`${A}/ai/anomalies`);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      const jobs = await api<Record<string, unknown>>(`${A}/jobs/run`, { method: 'POST', body: {} });
      const parts = Object.entries(jobs).map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${String(v)}`);
      toast(parts.length ? `Automation finished (${parts.join(', ')})` : 'Automation finished, nothing to do');
      day.reload(); week.reload(); attempts.reload();
    } catch (e) { toast(errMsg(e), 'bad'); } finally { setRunning(false); }
  }

  const cur = range === 'today' ? day : week;
  return (
    <Page title="Overview" subtitle="Attendance across all sites." actions={<Button onClick={() => void run()} busy={running}><Icon name="bolt" size={16} />Run automation now</Button>}>
      <div className="section-head">
        <h2>{range === 'today' ? <>Today <span className="muted small">({today})</span></> : <>Last 7 days <span className="muted small">({from7} to {today})</span></>}</h2>
        <Segmented label="Time range" value={range} onChange={setRange} options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'Last 7 days' }]} />
      </div>
      <Async loading={cur.loading} error={cur.error} hasData={!!cur.data}>{cur.data && <Stats s={cur.data} />}</Async>
      {week.data && <Chart s={week.data} />}

      <Card title="Rejected or flagged attempts" flush actions={<Link to="/admin/records?flagged=1">All flagged records</Link>}>
        <Async loading={attempts.loading} error={attempts.error} hasData={!!attempts.data}>
          {attempts.data && (attempts.data.items.length === 0 ? <Empty icon="shield" title="All clear">No rejected or flagged attempts.</Empty> : (
            <div className="table-wrap"><table>
              <caption className="sr-only">Recent rejected or flagged check-in attempts</caption>
              <thead><tr><th scope="col">When</th><th scope="col">Employee</th><th scope="col">Site</th><th scope="col">Action</th><th scope="col">Outcome</th><th scope="col">Reasons</th><th scope="col">Distance</th></tr></thead>
              <tbody>{attempts.data.items.slice(0, 8).map((a) => (
                <tr key={a.id}>
                  <td className="num-cell">{fmtDateTime(a.at, tz)}</td><td>{a.user_name}</td><td>{a.site_name ?? '–'}</td><td>{a.action}</td>
                  <td><Badge dot kind={a.outcome === 'rejected' ? 'bad' : 'warn'}>{a.outcome}</Badge></td>
                  <td><div className="badges">{(a.reasons ?? []).map((r) => <Badge key={r} kind="">{flagLabel(r)}</Badge>)}</div></td>
                  <td className="num-cell">{fmtDist(a.distance_m)}</td>
                </tr>))}</tbody>
            </table></div>
          ))}
        </Async>
      </Card>

      <Card title="Anomalies worth a look" actions={<Link to="/admin/ask">Ask the assistant</Link>}>
        {anomalies.loading && !anomalies.data ? <Skeleton lines={2} /> : anomalies.error ? <Alert kind="bad">{anomalies.error}</Alert> :
          anomalies.data && anomalies.data.items.length === 0 ? <p className="muted">Nothing unusual in the last 14 days.</p> :
          <ul className="stack-sm" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {anomalies.data?.items.slice(0, 3).map((a, i) => (
              <li key={i} className={`sev ${a.severity}`}>
                <Icon name={a.severity === 'warn' ? 'alert' : 'info'} size={20} />
                <div><strong>{a.title}</strong> <Badge kind={a.severity === 'warn' ? 'warn' : 'info'}>{a.severity === 'warn' ? 'Warning' : 'Info'}</Badge><p className="small">{a.explanation}</p></div>
              </li>
            ))}
          </ul>}
      </Card>
    </Page>
  );
}
