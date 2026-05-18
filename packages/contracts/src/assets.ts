import { z } from 'zod';

export const AssetSchema = z.object({
  id: z.string().uuid(),
  code: z.string().nullable(),
  name: z.string(),
  unit: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Asset = z.infer<typeof AssetSchema>;

export const AssetUpsertSchema = z.object({
  code: z.string().max(64).nullable().optional(),
  name: z.string().min(1).max(500),
  unit: z.string().min(1).max(16).default('шт'),
  isActive: z.boolean().optional(),
});
export type AssetUpsert = z.infer<typeof AssetUpsertSchema>;

export const AssetListResponseSchema = z.object({
  items: z.array(AssetSchema),
  total: z.number(),
});
