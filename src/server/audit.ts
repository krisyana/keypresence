import type { Db } from './db';

export async function audit(
  db: Db, actorId: string | null, action: string, entity: string, entityId: string | null, detail: Record<string, unknown> = {},
): Promise<void> {
  await db.query('INSERT INTO audit_log(actor_id, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5::jsonb)', [
    actorId, action, entity, entityId, JSON.stringify(detail),
  ]);
}

export async function notify(
  db: Db, userId: string, type: string, title: string, body: string, dedupeKey: string,
): Promise<boolean> {
  const r = await db.query(
    'INSERT INTO notifications(user_id, type, title, body, dedupe_key) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING id',
    [userId, type, title, body, dedupeKey],
  );
  return r.length > 0;
}
