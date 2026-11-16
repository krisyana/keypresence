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
    <main className="login" id="main">
      <section className="login-brand" aria-hidden="true">
        <img src="/icon.svg" alt="" width={56} height={56} />
        <h2>Check in anywhere that counts.</h2>
        <p>Scan the site QR, confirm your location, done.</p>
      </section>
      <section className="login-form">
        <div className="stack" style={{ width: '100%', maxWidth: 380 }}>
          <div className="stack-xs"><h1>Sign in</h1><p className="muted">to KeyPresence</p></div>
          <form className="stack" onSubmit={submit}>
            {err && <Alert kind="bad">{err}</Alert>}
            <Field label="Email">{(p) => <input {...p} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
            <Field label="Password">{(p) => <input {...p} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
            <Button variant="primary" size="big" type="submit" busy={busy}>Sign in</Button>
          </form>
          <p className="muted small">Demo build with fictional data.</p>
        </div>
      </section>
    </main>
  );
}
