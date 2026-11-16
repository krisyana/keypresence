import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Alert, Badge, Button, Empty, Field, Page } from '../ui';
import { A, Async, errMsg, useLoad } from './shared';

interface AskResult { outcome: 'answered' | 'refused' | 'invalid_plan'; answer: string; plan?: unknown; rows?: { label: string; value: number }[]; redactions: number }
interface Anomaly { type: string; severity: 'info' | 'warn'; title: string; explanation: string; evidence: Record<string, unknown> }

const EXAMPLES = ['Late arrivals by site last week', 'Who had the most overtime in the last 14 days?', 'How many check-ins yesterday?', 'Absences per day this week', 'Flagged records by site this month'];

export default function Ask() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<AskResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const anomalies = useLoad<{ from: string; to: string; items: Anomaly[] }>(`${A}/ai/anomalies`);

  async function ask(question: string) {
    if (!question.trim()) { setErr('Type a question first.'); return; }
    setBusy(true); setErr(null);
    try { setRes(await api<AskResult>(`${A}/ai/ask`, { body: { question } })); } catch (e) { setErr(errMsg(e)); setRes(null); } finally { setBusy(false); }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); void ask(q); };

  return (
    <Page title="Ask the assistant">
      <Alert kind="info">Read-only. Employees appear as aliases (e.g. E-7K2Q). No names, emails or locations are ever sent to or returned by the assistant.</Alert>
      <form className="card stack" onSubmit={submit}>
        <Field label="Your question" hint="For example: late arrivals by site last week.">
          {(p) => <textarea {...p} rows={2} maxLength={300} value={q} onChange={(e) => setQ(e.target.value)} />}
        </Field>
        <div className="row" role="group" aria-label="Example questions">
          {EXAMPLES.map((x) => <Button key={x} size="sm" disabled={busy} onClick={() => { setQ(x); void ask(x); }}>{x}</Button>)}
        </div>
        <div><Button type="submit" variant="primary" busy={busy}>Ask</Button></div>
      </form>
      {err && <Alert kind="bad">{err}</Alert>}
      <div aria-live="polite">
        {res && (
          <section className="card stack-sm" aria-label="Answer">
            {res.outcome !== 'answered' && <Alert kind={res.outcome === 'refused' ? 'info' : 'warn'}>{res.outcome === 'refused' ? 'The assistant declined this question.' : 'The assistant could not turn this into a supported query.'}</Alert>}
            <p style={{ margin: 0, fontSize: '1.1rem' }}>{res.answer}</p>
            {res.rows && res.rows.length > 0 && (
              <div className="table-wrap"><table>
                <caption className="sr-only">Answer data</caption>
                <thead><tr><th scope="col">Label</th><th scope="col">Value</th></tr></thead>
                <tbody>{res.rows.map((r, i) => <tr key={i}><td>{r.label}</td><td>{r.value}</td></tr>)}</tbody>
              </table></div>
            )}
            {res.redactions > 0 && <p className="small muted" style={{ margin: 0 }}>{res.redactions} item(s) were redacted by the privacy filter.</p>}
            {res.plan !== undefined && <details><summary>How this was answered</summary><p className="small muted">The question was converted into this validated, read-only query plan. Nothing else was run.</p><pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(res.plan, null, 2)}</pre></details>}
          </section>
        )}
      </div>

      <section className="stack-sm" aria-labelledby="an-h">
        <h2 id="an-h" style={{ margin: 0 }}>Anomalies in the last 14 days</h2>
        <Async loading={anomalies.loading} error={anomalies.error} hasData={!!anomalies.data}>
          {anomalies.data && (anomalies.data.items.length === 0 ? <Empty>Nothing unusual found between {anomalies.data.from} and {anomalies.data.to}.</Empty> : (
            <ul className="stack-sm" style={{ margin: 0, padding: 0 }}>
              {anomalies.data.items.map((a, i) => (
                <li key={i} className="card stack-sm" style={{ listStyle: 'none' }}>
                  <div className="row"><Badge kind={a.severity === 'warn' ? 'warn' : 'info'}>{a.severity === 'warn' ? 'Warning' : 'Info'}</Badge><strong>{a.title}</strong></div>
                  <div>{a.explanation}</div>
                  <details><summary className="small">Evidence</summary><dl className="small" style={{ margin: 0 }}>{Object.entries(a.evidence).map(([k, v]) => <div key={k} className="row" style={{ gap: '0.4rem' }}><dt className="muted">{k}:</dt><dd style={{ margin: 0 }}>{String(v)}</dd></div>)}</dl></details>
                </li>
              ))}
            </ul>
          ))}
        </Async>
      </section>
    </Page>
  );
}
