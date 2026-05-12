import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  uptime: z.number(),
  timestamp: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
