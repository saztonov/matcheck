import { z } from 'zod';

export const ResponsiblePersonSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  phone: z.string().nullable(),
  position: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ResponsiblePerson = z.infer<typeof ResponsiblePersonSchema>;

export const ResponsiblePersonUpsertSchema = z.object({
  fullName: z.string().min(1).max(500),
  phone: z.string().max(64).nullable().optional(),
  position: z.string().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type ResponsiblePersonUpsert = z.infer<typeof ResponsiblePersonUpsertSchema>;

export const ResponsiblePersonListResponseSchema = z.object({
  items: z.array(ResponsiblePersonSchema),
  total: z.number(),
});

export const ResponsiblePersonImportErrorSchema = z.object({
  row: z.number().int().positive(),
  reason: z.string(),
});
export type ResponsiblePersonImportError = z.infer<typeof ResponsiblePersonImportErrorSchema>;

export const ResponsiblePersonImportResponseSchema = z.object({
  created: z.number().int().nonnegative(),
  skippedDuplicates: z.number().int().nonnegative(),
  errors: z.array(ResponsiblePersonImportErrorSchema),
});
export type ResponsiblePersonImportResponse = z.infer<typeof ResponsiblePersonImportResponseSchema>;
