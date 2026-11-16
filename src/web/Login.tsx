import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { Alert, Button, Field } from './ui';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await login(email, password);
      nav((loc.state as any)?.from ?? '/', { replace: true });
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <main className="main narrow" id="main">
      <div className="stack" style={{ marginTop: '10vh' }}>
        <div className="row"><img src="/icon.svg" alt="" width={40} height={40} /><h1 style={{ margin: 0 }}>KeyPresence</h1></div>
        <p className="muted">Sign in to check in and out. Your location is read only at the moment you check in or out.</p>
        <form className="card stack" onSubmit={submit}>
          {err && <Alert kind="bad">{err}</Alert>}
          <Field label="Email">{(p) => <input {...p} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field label="Password">{(p) => <input {...p} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          <Button variant="primary" type="submit" busy={busy}>Sign in</Button>
        </form>
        <p className="muted small">Demo build with fictional data. See the README for demo accounts.</p>
      </div>
    </main>
  );
}
