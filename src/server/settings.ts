import { z } from 'zod';
import type { Db } from './db';
import { isValidTimezone } from './domain/time';

export const settingsSchema = z.object({
  timezone: z.string().refine(isValidTimezone, 'unknown timezone').default('Asia/Jakarta'),
  impossible_speed_kmh: z.number().min(20).max(1000).default(200),
  spoofing_action: z.enum(['flag', 'reject']).default('flag'),
  stale_fix_seconds: z.number().int().min(5).max(300).default(30),
  qr_grace_minutes: z.number().int().min(0).max(60).default(10),
  coord_retention_days: z.number().int().min(1).max(3650).default(90),
  daily_summary_hour: z.number().int().min(0).max(23).default(18),
  missing_checkin_reminder_minutes: z.number().int().min(0).max(240).default(30),
  checkout_reminder_minutes: z.number().int().min(0).max(240).default(30),
});
export type Settings = z.infer<typeof settingsSchema>;
const patchSchema = settingsSchema.partial().strict();

export const defaultSettings: Settings = settingsSchema.parse({});

export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.query<{ key: string; value: unknown }>('SELECT key, value FROM settings');
  const obj: Record<string, unknown> = {};
  for (const r of rows) obj[r.key] = r.value;
  const parsed = settingsSchema.safeParse(obj);
  return parsed.success ? parsed.data : defaultSettings;
}

export async function updateSettings(db: Db, patch: unknown): Promise<{ before: Settings; after: Settings }> {
  const p = patchSchema.parse(patch);
  const before = await getSettings(db);
  const after = settingsSchema.parse({ ...before, ...p });
  await db.tx(async (t) => {
    for (const [k, v] of Object.entries(p)) {
      await t.query(
        'INSERT INTO settings(key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
        [k, JSON.stringify(v)],
      );
    }
  });
  return { before, after };
}
