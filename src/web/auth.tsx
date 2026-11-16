import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

export interface Me {
  user: { id: string; email: string; name: string; role: 'admin' | 'employee'; location_consent_at: string | null };
  timezone: string;
  shift: { name: string; start_time: string; end_time: string } | null;
  open: { id: string; kind: string; subject_ref: string | null; check_in_at: string; in_flags: string[]; site_name: string }[];
  unread: number;
}

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
const Ctx = createContext<AuthCtx>(null as never);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try { setMe(await api<Me>('/api/me')); } catch { setMe(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const h = () => setMe(null);
    window.addEventListener('kp:unauthenticated', h);
    return () => window.removeEventListener('kp:unauthenticated', h);
  }, []);
  const value = useMemo<AuthCtx>(() => ({
    me, loading, refresh,
    async login(email, password) { await api('/api/auth/login', { body: { email, password } }); await refresh(); },
    async logout() { await api('/api/auth/logout', { body: {} }).catch(() => {}); setMe(null); },
  }), [me, loading, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
