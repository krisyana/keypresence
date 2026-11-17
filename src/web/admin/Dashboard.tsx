import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { addDaysStr, todayIn } from '../tz';
import { Alert, Badge, Button, Card, Empty, Icon, Page, Skeleton, flagLabel, fmtDateTime, fmtMinutes, fmtTime, useToast } from '../ui';
import { A, Async, PersonCell, errMsg, fmtDist, useLoad, useOrgTz, type Employee } from './shared';

interface Summary {
  from: string; to: string;
  attendance: { presentDays: number; checkins: number; lateCount: number; lateMinutes: number; overtimeMinutes: number; flagged: number; autoClosed: number; stillOpen: number; absentDays: number };
  byDay: { day: string; checkins: number; late: number; absent: number }[];
  rejectedAttempts: number; pendingReviews: number; pendingCorrections: number;
}
interface Attempt { id: string; at: string; action: string; kind: string; outcome: string; reasons: string[]; distance_m: number | null; accuracy_m: number | null; user_name: string; site_name: string | null }
interface Anomaly { type: string; severity: 'info' | 'warn'; title: string; explanation: string }

interface Rec { id: string; user_id: string; kind: string; check_in_at: string; check_out_at: string | null; late_minutes: number | null; work_minutes: number | null; in_flags: string[]; out_flags: string[]; review_status: string; site_name: string }
type Presence = 'in' | 'out' | 'waiting';
interface Row { emp: Employee; state: Presence; rec: Rec | null }

/** One row per active employee, from today's attendance records. No leave model exists, so "not in yet" is all we can say. */
function buildRoster(emps: Employee[], recs: Rec[]): Row[] {
  return emps.filter((e) => e.active && e.role === 'employee').map((emp) => {
    const mine = recs.filter((r) => r.user_id === emp.id && r.kind === 'attendance').sort((x, y) => y.check_in_at.localeCompare(x.check_in_at));
    const rec = mine[0] ?? null;
    return { emp, rec, state: !rec ? 'waiting' : rec.check_out_at ? 'out' : 'in' } as Row;
  });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Lead({ rows, s }: { rows: Row[]; s: Summary }) {
  const present = rows.filter((r) => r.state !== 'waiting').length;
  const late = rows.filter((r) => (r.rec?.late_minutes ?? 0) > 0).length;
  const waiting = rows.length - present;
  const headline = rows.length === 0 ? 'No employees yet.' : present === 0 ? 'Nobody has checked in yet.' : `${present} of ${rows.length} have checked in.`;
  const rest = [late ? `${plural(late, 'person', 'people')} arrived late.` : null, waiting && present ? `${waiting} not in yet.` : null, !late && present ? 'Nobody was late.' : null].filter(Boolean).join(' ');
  const tasks = [
    { n: s.pendingReviews, text: s.pendingReviews === 1 ? 'record to review' : 'records to review', to: '/admin/records?review=pending', cta: 'Review' },
    { n: s.pendingCorrections, text: s.pendingCorrections === 1 ? 'correction to decide' : 'corrections to decide', to: '/admin/corrections', cta: 'Decide' },
    { n: s.rejectedAttempts, text: s.rejectedAttempts === 1 ? 'rejected attempt today' : 'rejected attempts today', to: '/admin/records?flagged=1', cta: 'Look' },
  ].filter((t) => t.n > 0);
  const a = s.attendance;
  return (
    <div className="ov-lead">
      <div className="ov-sentence">
        <p className="ov-headline">{headline}</p>
        {rest && <p className="ov-rest">{rest}</p>}
        <p className="ov-also small muted">Overtime {fmtMinutes(a.overtimeMinutes)}. {plural(a.flagged, 'flagged record', 'flagged records')}. {plural(a.autoClosed, 'auto-closed record', 'auto-closed records')}.</p>
      </div>
      <section className="ov-tasks" aria-label="Waiting for you">
        <h2>Waiting for you</h2>
        {tasks.length === 0 ? <p className="muted">Nothing needs a decision.</p> : (
          <ul>{tasks.map((t) => (
            <li key={t.to}><span className="num ov-count">{t.n}</span><span>{t.text}</span><Link className="btn sm" to={t.to}>{t.cta}</Link></li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}

const GROUPS: { state: Presence; title: string }[] = [
  { state: 'in', title: 'Here now' }, { state: 'waiting', title: 'Not in yet' }, { state: 'out', title: 'Left for the day' },
];

function RollCall({ rows, tz, today }: { rows: Row[]; tz: string; today: string }) {
  const label = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(today + 'T12:00:00Z'));
  return (
    <Card flush title="Today" actions={<span className="muted small">{label}</span>}>
      {rows.length === 0 ? <Empty icon="users" title="No employees yet" action={<Link className="btn primary" to="/admin/employees">Add employees</Link>}>Add people to see who is in.</Empty> : (
        <div className="roll">
          {GROUPS.map((g) => {
            const attention = (r: Row) => ((r.rec?.late_minutes ?? 0) > 0 || (!!r.rec && r.rec.review_status === 'pending') ? 0 : 1);
            const list = rows.filter((r) => r.state === g.state).sort((x, y) => attention(x) - attention(y) || x.emp.name.localeCompare(y.emp.name));
            if (!list.length) return null;
            return (
              <section key={g.state} aria-label={g.title}>
                <h3 className="roll-h">{g.title} <span className="muted">{list.length}</span></h3>
                <ul>{list.map(({ emp, rec, state }) => {
                  const late = rec?.late_minutes ?? 0;
                  const flagged = !!rec && (rec.in_flags.length + rec.out_flags.length > 0 || rec.review_status === 'pending');
                  return (
                    <li key={emp.id} className={`roll-row ${state}`}>
                      <PersonCell name={emp.name} sub={emp.shift_name} />
                      <div className="roll-state">
                        {late > 0 && <Badge kind="warn">Late {late} min</Badge>}
                        {flagged && <Badge kind="bad">Review</Badge>}
                      </div>
                      <div className="roll-time num">
                        <span>{state === 'waiting' ? <span className="muted">No check-in</span> : state === 'in' ? <>In since <strong>{fmtTime(rec!.check_in_at, tz)}</strong></> : <><strong>{fmtTime(rec!.check_in_at, tz)}</strong> to <strong>{fmtTime(rec!.check_out_at, tz)}</strong> <span className="muted">({fmtMinutes(rec!.work_minutes)})</span></>}</span>
                        {rec && <span className="cell-sub">{rec.site_name}</span>}
                      </div>
                    </li>
                  );
                })}</ul>
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Chart({ s }: { s: Summary }) {
  const max = Math.max(1, ...s.byDay.map((d) => d.checkins));
  const summary = `Check-ins and late arrivals per day from ${s.from} to ${s.to}`;
  return (
    <Card title="Last 7 days" actions={<div className="legend" aria-label="Legend"><span><i />Check-ins</span><span><i className="late" />Late arrivals</span></div>}>
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
  const day = useLoad<Summary>(`${A}/summary${qs({ from: today, to: today })}`);
  const week = useLoad<Summary>(`${A}/summary${qs({ from: from7, to: today })}`);
  const emps = useLoad<{ items: Employee[] }>(`${A}/employees`);
  const recs = useLoad<{ items: Rec[] }>(`${A}/checkins${qs({ from: today, to: today, kind: 'attendance', limit: 500 })}`);
  const attempts = useLoad<{ items: Attempt[] }>(`${A}/attempts`);
  const anomalies = useLoad<{ items: Anomaly[] }>(`${A}/ai/anomalies`);
  const [running, setRunning] = useState(false);
  const rows = useMemo(() => (emps.data && recs.data ? buildRoster(emps.data.items, recs.data.items) : null), [emps.data, recs.data]);

  async function run() {
    setRunning(true);
    try {
      const jobs = await api<Record<string, unknown>>(`${A}/jobs/run`, { method: 'POST', body: {} });
      const parts = Object.entries(jobs).map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${String(v)}`);
      toast(parts.length ? `Automation finished (${parts.join(', ')})` : 'Automation finished, nothing to do');
      day.reload(); week.reload(); attempts.reload(); recs.reload();
    } catch (e) { toast(errMsg(e), 'bad'); } finally { setRunning(false); }
  }

  return (
    <Page title="Overview" actions={<Button onClick={() => void run()} busy={running}><Icon name="bolt" size={16} />Run automation now</Button>}>
      <Async loading={day.loading || emps.loading || recs.loading} error={day.error ?? emps.error ?? recs.error} hasData={!!(day.data && rows)}>
        {day.data && rows && <><Lead rows={rows} s={day.data} /><RollCall rows={rows} tz={tz} today={today} /></>}
      </Async>
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
