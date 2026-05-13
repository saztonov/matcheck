import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { settings } from '../../db/schema.js';
import type { UpdParseMode } from '@matcheck/contracts';

export const UPD_PARSE_MODE_KEY = 'upd.parse_mode';

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  if (!row) return fallback;
  return row.value as T;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value: value as unknown })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: value as unknown, updatedAt: new Date() },
    });
}

export async function getUpdParseMode(): Promise<UpdParseMode> {
  return getSetting<UpdParseMode>(UPD_PARSE_MODE_KEY, 'llm');
}

export async function setUpdParseMode(mode: UpdParseMode): Promise<void> {
  await setSetting<UpdParseMode>(UPD_PARSE_MODE_KEY, mode);
}
