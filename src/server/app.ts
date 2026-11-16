import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { Hono } from 'hono';
import type { Deps } from './deps';
import type { Planner } from './ai';
import { csrf, onError, requestLogger } from './http';
import { requireRole, type Env } from './auth';
import { publicRoutes } from './routes/public';
import { adminRoutes } from './routes/admin';

export interface AppOptions { log?: (line: string) => void; planner?: Planner; webDir?: string }

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png',
  json: 'application/json', webmanifest: 'application/manifest+json', ico: 'image/x-icon', txt: 'text/plain',
};

export function createApp(deps: Deps, opts: AppOptions = {}) {
  const log = opts.log ?? ((l: string) => console.log(l));
  const app = new Hono<Env>();
  app.use('*', requestLogger(log));
  app.use('/api/*', csrf(deps.config.appUrl));
  app.use('/api/*', async (c, next) => {
    await next();
    c.res.headers.set('cache-control', 'no-store');
    c.res.headers.set('x-content-type-options', 'nosniff');
  });
  app.onError(onError(log));

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api', publicRoutes(deps));
  const admin = new Hono<Env>();
  admin.use('*', requireRole(deps.db, deps.clock, 'admin'));
  admin.route('/', adminRoutes(deps, opts.planner));
  app.route('/api/admin', admin);
  app.all('/api/*', (c) => c.json({ error: 'NOT_FOUND' }, 404));

  // Static web build (production / e2e). In dev the Vite server serves the UI and proxies /api.
  const webDir = opts.webDir;
  if (webDir && existsSync(webDir)) {
    app.get('*', async (c) => {
      const path = normalize(new URL(c.req.url).pathname).replace(/^(\.\.[/\\])+/, '');
      let file = join(webDir, path);
      if (!file.startsWith(webDir) || !existsSync(file) || path === '/' || path.endsWith('/')) file = join(webDir, 'index.html');
      const ext = file.split('.').pop() ?? '';
      const headers: Record<string, string> = { 'content-type': MIME[ext] ?? 'application/octet-stream' };
      if (file.endsWith('sw.js') || file.endsWith('index.html')) headers['cache-control'] = 'no-cache';
      headers['content-security-policy'] = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'";
      headers['referrer-policy'] = 'no-referrer';
      headers['permissions-policy'] = 'geolocation=(self), camera=(self)';
      return new Response(await readFile(file), { headers });
    });
  }
  return app;
}
