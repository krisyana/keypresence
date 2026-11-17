import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { migrate, openDb } from './db';
import { startScheduler } from './jobs';
import { seedDemo } from './seed';

const config = loadConfig();
const db = await openDb(config.databaseUrl, config.pgliteDir);
const applied = await migrate(db);
if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`);
const deps = { db, config, clock: () => new Date() };
if (process.env.SEED_DEMO === '1' && (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM users'))[0]!.n === 0) {
  const r = await seedDemo(deps, { today: process.env.SEED_TODAY !== '0' });
  console.log(`Seeded demo data. Sign in as ${r.adminEmail} or ${r.employees[0]} with password ${r.password} (fictional, demo only)`);
}
const app = createApp(deps, { webDir: join(process.cwd(), 'dist', 'web') });
serve({ fetch: app.fetch, port: config.port }, (i) => console.log(`KeyPresence API on http://localhost:${i.port} (${db.kind})`));
if (config.jobsInProcess) startScheduler(deps);
const stop = async () => { await db.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
