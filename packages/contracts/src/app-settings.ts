import { z } from 'zod';

export const UpdParseModeSchema = z.enum(['llm', 'local']);
export type UpdParseMode = z.infer<typeof UpdParseModeSchema>;

export const AppSettingsSchema = z.object({
  updParseMode: UpdParseModeSchema,
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const AppSettingsUpdateSchema = AppSettingsSchema.partial();
export type AppSettingsUpdate = z.infer<typeof AppSettingsUpdateSchema>;
