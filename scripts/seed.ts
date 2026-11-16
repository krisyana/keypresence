import { loadConfig } from '../src/server/config';
import { migrate, openDb } from '../src/server/db';
import { seedDemo } from '../src/server/seed';

const config = loadConfig();
const db = await openDb(config.databaseUrl, config.pgliteDir);
await migrate(db);
const [{ n }] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM users');
if (n > 0 && !process.argv.includes('--reset')) {
  console.log('Database already has users. Re-run with --reset to wipe and reseed (demo databases only).');
} else {
  if (n > 0) {
    await db.exec('TRUNCATE users, shifts, sites, settings, audit_log, ai_queries, job_runs, daily_summaries, attempts RESTART IDENTITY CASCADE');
  }
  const r = await seedDemo({ db, config, clock: () => new Date() });
  console.log(`Seeded demo data.\n  admin:    ${r.adminEmail}\n  employee: ${r.employees[0]}\n  password: ${r.password}  (fictional, demo only)`);
}
await db.close();
