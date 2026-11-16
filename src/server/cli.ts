import { loadConfig } from './config';
import { migrate, openDb } from './db';
import { runJobs } from './jobs';

const cmd = process.argv[2];
const config = loadConfig();
const db = await openDb(config.databaseUrl, config.pgliteDir);
if (cmd === 'migrate') console.log('applied:', await migrate(db));
else if (cmd === 'jobs') { await migrate(db); console.log(await runJobs({ db, config, clock: () => new Date() })); }
else console.log('usage: cli.ts migrate|jobs');
await db.close();
