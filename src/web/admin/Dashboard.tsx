import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { addDaysStr, todayIn } from '../tz';
import { Alert, Badge, Button, Empty, Page, Spinner, flagLabel, fmtDateTime, fmtMinutes } from '../ui';
import { A, Async, errMsg, fmtDist, useLoad, useOrgTz } from './shared';

interface Summary {
  from: string; to: string;
  attendance: { presentDays: number; checkins: number; lateCount: number; lateMinutes: number; overtimeMinutes: number; flagged: number; autoClosed: number; stillOpen: number; absentDays: number };
  byDay: { day: string; checkins: number; late: number; absent: number }[];
  rejectedAttempts: number; pendingReviews: number; pendingCorrections: number;
}
interface Attempt { id: string; at: string; action: string; kind: string; outcome: string; reasons: string[]; distance_m: number | null; accuracy_m: number | null; user_name: string; site_name: string | null }
interface Anomaly { type: string; severity: 'info' | 'warn'; title: string; explanation: string }

function Stat({ n, l, to }: { n: string | number; l: string; to?: string }) {
  const body = <><div className="n">{n}</div><div className="l">{l}</div></>;
  return <div className="stat">{to ? <Link to={to} style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>{body}<span className="small">Review →</span></Link> : body}</div>;
}

function Stats({ s, title }: { s: Summary; title: string }) {
  const a = s.attendance;
  return (
    <section className="stack-sm" aria-label={title}>
      <h2 style={{ margin: 0 }}>{title}</h2>
      <div className="stats">
        <Stat n={a.presentDays} l="Present (person-days)" />
        <Stat n={`${a.lateCount} (${a.lateMinutes} min)`} l="Late arrivals (minutes)" />
        <Stat n={a.absentDays} l="Absent" />
        <Stat n={fmtMinutes(a.overtimeMinutes)} l="Overtime" />
        <Stat n={a.flagged} l="Flagged records" />
        <Stat n={a.autoClosed} l="Auto-closed" />
        <Stat n={a.stillOpen} l="Still open" />
        <Stat n={s.rejectedAttempts} l="Rejected attempts" />
        <Stat n={s.pendingReviews} l="Pending reviews" to="/admin/records?review=pending" />
        <Stat n={s.pendingCorrections} l="Pending corrections" to="/admin/corrections" />
      </div>
    </section>
  );
}

function Chart({ s }: { s: Summary }) {
  const max = Math.max(1, ...s.byDay.map((d) => d.checkins));
  const summary = `Check-ins and late arrivals per day from ${s.from} to ${s.to}`;
  return (
    <section className="card stack-sm" aria-labelledby="chart-h">
      <h2 id="chart-h" style={{ margin: 0 }}>Check-ins per day</h2>
      <p className="small muted" style={{ margin: 0 }}>Blue bars are check-ins, darker bars are late arrivals. Exact numbers are in the table below.</p>
      <div className="bars" role="img" aria-label={summary + ': ' + s.byDay.map((d) => `${d.day} ${d.checkins} check-ins, ${d.late} late`).join('; ')}>
        {s.byDay.map((d) => (
          <div key={d.day} style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 2, height: '100%' }}>
            <span title={`${d.day}: ${d.checkins} check-ins`} style={{ height: `${(d.checkins / max) * 100}%` }} />
            <span className="late" title={`${d.day}: ${d.late} late`} style={{ height: `${(d.late / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="row between small muted" aria-hidden="true"><span>{s.from}</span><span>{s.to}</span></div>
      <details>
        <summary>Show as table</summary>
        <div className="table-wrap"><table>
          <caption className="sr-only">{summary}</caption>
          <thead><tr><th scope="col">Day</th><th scope="col">Check-ins</th><th scope="col">Late</th><th scope="col">Absent</th></tr></thead>
          <tbody>{s.byDay.map((d) => <tr key={d.day}><th scope="row" style={{ textTransform: 'none', background: 'none' }}>{d.day}</th><td>{d.checkins}</td><td>{d.late}</td><td>{d.absent}</td></tr>)}</tbody>
        </table></div>
      </details>
    </section>
  );
}

export default function Dashboard() {
  const tz = useOrgTz();
  const today = todayIn(tz);
  const from7 = addDaysStr(today, -6);
  const day = useLoad<Summary>(`${A}/summary${qs({ from: today, to: today })}`);
  const week = useLoad<Summary>(`${A}/summary${qs({ from: from7, to: today })}`);
  const attempts = useLoad<{ items: Attempt[] }>(`${A}/attempts`);
  const anomalies = useLoad<{ items: Anomaly[] }>(`${A}/ai/anomalies`);
  const [running, setRunning] = useState(false);
  const [jobs, setJobs] = useState<Record<string, unknown> | null>(null);
  const [jobErr, setJobErr] = useState<string | null>(null);

  async function run() {
    setRunning(true); setJobErr(null);
    try { setJobs(await api(`${A}/jobs/run`, { method: 'POST', body: {} })); day.reload(); week.reload(); attempts.reload(); }
    catch (e) { setJobErr(errMsg(e)); } finally { setRunning(false); }
  }

  return (
    <Page title="Overview" actions={<Button onClick={() => void run()} busy={running}>Run automation now</Button>}>
      {jobErr && <Alert kind="bad">{jobErr}</Alert>}
      {jobs && (
        <Alert kind="ok">
          Automation finished: {Object.entries(jobs).map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${String(v)}`).join(', ') || 'nothing to do'}.
        </Alert>
      )}
      <Async loading={day.loading} error={day.error} hasData={!!day.data}>{day.data && <Stats s={day.data} title={`Today (${today})`} />}</Async>
      <Async loading={week.loading} error={week.error} hasData={!!week.data}>
        {week.data && <><Stats s={week.data} title={`Last 7 days (${from7} to ${today})`} /><Chart s={week.data} /></>}
      </Async>

      <section className="card flush" aria-labelledby="att-h">
        <div style={{ padding: '1rem 1rem 0' }}><h2 id="att-h" style={{ margin: 0 }}>Recent rejected or flagged attempts</h2></div>
        <Async loading={attempts.loading} error={attempts.error} hasData={!!attempts.data}>
          {attempts.data && (attempts.data.items.length === 0 ? <Empty>No rejected or flagged attempts.</Empty> : (
            <div className="table-wrap"><table>
              <caption className="sr-only">Recent rejected or flagged check-in attempts</caption>
              <thead><tr><th scope="col">When</th><th scope="col">Employee</th><th scope="col">Site</th><th scope="col">Action</th><th scope="col">Outcome</th><th scope="col">Reasons</th><th scope="col">Distance</th></tr></thead>
              <tbody>{attempts.data.items.slice(0, 10).map((a) => (
                <tr key={a.id}>
                  <td>{fmtDateTime(a.at, tz)}</td><td>{a.user_name}</td><td>{a.site_name ?? '–'}</td><td>{a.action}</td>
                  <td><Badge kind={a.outcome === 'rejected' ? 'bad' : 'warn'}>{a.outcome}</Badge></td>
                  <td>{(a.reasons ?? []).map((r) => <Badge key={r} kind="">{flagLabel(r)}</Badge>)}</td>
                  <td>{fmtDist(a.distance_m)}</td>
                </tr>))}</tbody>
            </table></div>
          ))}
        </Async>
      </section>

      <section className="card stack-sm" aria-labelledby="an-h">
        <div className="row between"><h2 id="an-h" style={{ margin: 0 }}>Anomalies worth a look</h2><Link to="/admin/ask">Ask the assistant →</Link></div>
        {anomalies.loading && !anomalies.data ? <Spinner /> : anomalies.error ? <Alert kind="bad">{anomalies.error}</Alert> :
          anomalies.data && anomalies.data.items.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing unusual in the last 14 days.</p> :
          <ul className="stack-sm" style={{ margin: 0, paddingLeft: '1.2rem' }}>
            {anomalies.data?.items.slice(0, 3).map((a, i) => (
              <li key={i}><Badge kind={a.severity === 'warn' ? 'warn' : 'info'}>{a.severity === 'warn' ? 'Warning' : 'Info'}</Badge> <strong>{a.title}</strong><div className="small muted">{a.explanation}</div></li>
            ))}
          </ul>}
      </section>
    </Page>
  );
}
