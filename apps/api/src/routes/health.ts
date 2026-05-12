import type { FastifyInstance } from 'fastify';
import { HealthResponseSchema } from '@matcheck/contracts';

const SERVICE_NAME = '@matcheck/api';
const SERVICE_VERSION = '0.0.0';
const startedAt = Date.now();

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        response: { 200: HealthResponseSchema },
      },
    },
    async () => ({
      status: 'ok' as const,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      uptime: Math.round((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    }),
  );
}
