import { z } from 'zod';

export const MaterialSchema = z.object({
  id: z.string().uuid(),
  code: z.string().nullable(),
  name: z.string(),
  unit: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Material = z.infer<typeof MaterialSchema>;

export const MaterialUpsertSchema = z.object({
  code: z.string().max(64).nullable().optional(),
  name: z.string().min(1).max(500),
  unit: z.string().min(1).max(16).default('шт'),
});
export type MaterialUpsert = z.infer<typeof MaterialUpsertSchema>;

export const MaterialListResponseSchema = z.object({
  items: z.array(MaterialSchema),
  total: z.number(),
});

export const MaterialJournalEntrySchema = z.object({
  id: z.string(),
  deliveryId: z.string().uuid(),
  materialId: z.string().uuid().nullable(),
  materialName: z.string(),
  unit: z.string(),
  qty: z.string(),
  supplierId: z.string().uuid().nullable(),
  supplierName: z.string().nullable(),
  sourceDocumentId: z.string().uuid().nullable(),
  docNumber: z.string().nullable(),
  docDate: z.string().nullable(),
  arrivedAt: z.string().nullable(),
});
export type MaterialJournalEntry = z.infer<typeof MaterialJournalEntrySchema>;

export const MaterialJournalResponseSchema = z.object({
  items: z.array(MaterialJournalEntrySchema),
  total: z.number(),
});
