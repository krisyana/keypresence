import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { migrate, openDb } from '../src/server/db';

it('creates missing parent directories for the embedded database (fresh clone has no .data)', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'kp-')), 'a', 'b', 'pglite');
  const db = await openDb(null, dir);
  expect((await migrate(db)).length).toBeGreaterThan(0);
  await db.close();
});
