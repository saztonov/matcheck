import type { FastifyInstance } from 'fastify';
import { asZod } from '../../lib/fastify.js';
import { AppSettingsSchema, AppSettingsUpdateSchema } from '@matcheck/contracts';
import { getUpdParseMode, setUpdParseMode } from '../../domain/settings/app-settings.js';

export async function appSettingsRoutes(rawApp: FastifyInstance): Promise<void> {
  const app = asZod(rawApp);

  app.get(
    '/api/v1/admin/settings',
    {
      preHandler: [app.authenticate, app.authorize('admin', 'manager')],
      schema: { response: { 200: AppSettingsSchema } },
    },
    async () => {
      return { updParseMode: await getUpdParseMode() };
    },
  );

  app.put(
    '/api/v1/admin/settings',
    {
      preHandler: [app.authenticate, app.authorize('admin')],
      schema: {
        body: AppSettingsUpdateSchema,
        response: { 200: AppSettingsSchema },
      },
    },
    async (req) => {
      const body = req.body;
      if (body.updParseMode !== undefined) {
        await setUpdParseMode(body.updParseMode);
      }
      return { updParseMode: await getUpdParseMode() };
    },
  );
}
