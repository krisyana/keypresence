import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { migrate, openDb } from './db';
import { startScheduler } from './jobs';

const config = loadConfig();
const db = await openDb(config.databaseUrl);
const applied = await migrate(db);
if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`);
const deps = { db, config, clock: () => new Date() };
const app = createApp(deps, { webDir: join(process.cwd(), 'dist', 'web') });
serve({ fetch: app.fetch, port: config.port }, (i) => console.log(`KeyPresence API on http://localhost:${i.port} (${db.kind})`));
if (config.jobsInProcess) startScheduler(deps);
const stop = async () => { await db.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
