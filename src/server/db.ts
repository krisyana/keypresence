import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

/** Minimal database interface. Two adapters: node-postgres and PGlite (ADR-0001). */
export interface Db {
  readonly kind: 'pg' | 'pglite';
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const DATE_OID = 1082;
const INT8_OID = 20;

export async function openDb(databaseUrl: string | null, dataDir = '.data/pglite'): Promise<Db> {
  if (databaseUrl) return openPg(databaseUrl);
  return openPglite(dataDir === ':memory:' ? undefined : dataDir);
}

function openPg(url: string): Db {
  const types = {
    getTypeParser: (oid: number, format?: any) =>
      oid === DATE_OID ? (v: string) => v : oid === INT8_OID ? (v: string) => Number(v) : pg.types.getTypeParser(oid, format),
  };
  const pool = new pg.Pool({ connectionString: url, max: 10, types: types as any });
  const wrap = (c: pg.Pool | pg.PoolClient, inTx: boolean): Db => ({
    kind: 'pg',
    async query(sql, params) {
      return (await c.query(sql, params as any[])).rows;
    },
    async exec(sql) {
      await c.query(sql);
    },
    async tx(fn) {
      if (inTx) return fn(this);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client, true));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      if (!inTx) await pool.end();
    },
  });
  return wrap(pool, false);
}

async function openPglite(dir?: string): Promise<Db> {
  const lite = new PGlite(dir, { parsers: { [DATE_OID]: (v: string) => v, [INT8_OID]: (v: string) => Number(v) } });
  await lite.waitReady;
  const wrap = (c: Pick<PGlite, 'query' | 'exec'>, inTx: boolean): Db => ({
    kind: 'pglite',
    async query(sql, params) {
      return (await c.query(sql, params as any[])).rows as any[];
    },
    async exec(sql) {
      await c.exec(sql);
    },
    async tx(fn) {
      if (inTx) return fn(this);
      return lite.transaction((t) => fn(wrap(t as any, true)));
    },
    async close() {
      if (!inTx) await lite.close();
    },
  });
  return wrap(lite, false);
}

/** Applies migrations/*.sql in filename order, once each. Returns names applied now. */
export async function migrate(db: Db, dir = join(process.cwd(), 'migrations')): Promise<string[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(join(dir, f), 'utf8');
    await db.tx(async (t) => {
      await t.exec(sql);
      await t.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
    });
    applied.push(f);
  }
  return applied;
}

export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as any).code === '23505';
}
