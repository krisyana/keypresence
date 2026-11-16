import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Alert, Badge, Button, Card, Empty, Field, Icon, Page, useToast } from '../ui';
import { A, Async, errMsg, useLoad } from './shared';

interface AskResult { outcome: 'answered' | 'refused' | 'invalid_plan'; answer: string; plan?: unknown; rows?: { label: string; value: number }[]; redactions: number }
interface Anomaly { type: string; severity: 'info' | 'warn'; title: string; explanation: string; evidence: Record<string, unknown> }

const EXAMPLES = ['Late arrivals by site last week', 'Who had the most overtime in the last 14 days?', 'How many check-ins yesterday?', 'Absences per day this week', 'Flagged records by site this month'];

export default function Ask() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [asked, setAsked] = useState('');
  const [res, setRes] = useState<AskResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const anomalies = useLoad<{ from: string; to: string; items: Anomaly[] }>(`${A}/ai/anomalies`);

  async function ask(question: string) {
    if (!question.trim()) { setErr('Type a question first.'); return; }
    setBusy(true); setErr(null); setAsked(question);
    try { setRes(await api<AskResult>(`${A}/ai/ask`, { body: { question } })); } catch (e) { const m = errMsg(e); setErr(m); toast(m, 'bad'); setRes(null); } finally { setBusy(false); }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); void ask(q); };

  return (
    <Page title="Ask the assistant" subtitle="Read-only answers. People appear as aliases, never names.">
      <Card>
        <form className="stack" onSubmit={submit}>
          <Field label="Your question" error={err ?? undefined}>
            {(p) => <textarea {...p} rows={2} maxLength={300} placeholder="Late arrivals by site last week" value={q} onChange={(e) => setQ(e.target.value)} />}
          </Field>
          <div className="row between">
            <div className="chips" role="group" aria-label="Example questions">
              {EXAMPLES.map((x) => <Button key={x} size="sm" disabled={busy} onClick={() => { setQ(x); void ask(x); }}>{x}</Button>)}
            </div>
            <Button type="submit" variant="primary" busy={busy}><Icon name="sparkle" size={16} />Ask</Button>
          </div>
        </form>
      </Card>

      <div aria-live="polite" className="stack">
        {res && (
          <>
            <div className="bubble-q">{asked}</div>
            <section aria-label="Answer">
              <Card>
                <div className="stack-sm">
                  {res.outcome !== 'answered' && <Alert kind={res.outcome === 'refused' ? 'info' : 'warn'}>{res.outcome === 'refused' ? 'The assistant declined this question.' : 'This could not be turned into a supported query.'}</Alert>}
                  <p className="answer-text">{res.answer}</p>
                  {res.rows && res.rows.length > 0 && (
                    <div className="table-wrap"><table className="table-compact">
                      <caption className="sr-only">Answer data</caption>
                      <thead><tr><th scope="col">Label</th><th scope="col">Value</th></tr></thead>
                      <tbody>{res.rows.map((r, i) => <tr key={i}><td>{r.label}</td><td className="num-cell">{r.value}</td></tr>)}</tbody>
                    </table></div>
                  )}
                  {res.redactions > 0 && <p className="small muted">{res.redactions} item(s) redacted by the privacy filter.</p>}
                  {res.plan !== undefined && <details className="info"><summary><Icon name="info" size={16} />How this was answered</summary><pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{JSON.stringify(res.plan, null, 2)}</pre></details>}
                </div>
              </Card>
            </section>
          </>
        )}
      </div>

      <Card title="Anomalies in the last 14 days">
        <Async loading={anomalies.loading} error={anomalies.error} hasData={!!anomalies.data}>
          {anomalies.data && (anomalies.data.items.length === 0 ? <Empty icon="check" title="Nothing unusual">Between {anomalies.data.from} and {anomalies.data.to}.</Empty> : (
            <ul className="stack-sm" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {anomalies.data.items.map((a, i) => (
                <li key={i} className={`sev ${a.severity}`}>
                  <Icon name={a.severity === 'warn' ? 'alert' : 'info'} size={20} />
                  <div>
                    <strong>{a.title}</strong> <Badge kind={a.severity === 'warn' ? 'warn' : 'info'}>{a.severity === 'warn' ? 'Warning' : 'Info'}</Badge>
                    <p>{a.explanation}</p>
                    <details><summary>Evidence</summary><dl className="small" style={{ margin: 0 }}>{Object.entries(a.evidence).map(([k, v]) => <div key={k} className="row" style={{ gap: 6 }}><dt>{k}:</dt><dd style={{ margin: 0 }}>{String(v)}</dd></div>)}</dl></details>
                  </div>
                </li>
              ))}
            </ul>
          ))}
        </Async>
      </Card>
    </Page>
  );
}
