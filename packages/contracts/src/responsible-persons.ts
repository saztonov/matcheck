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
