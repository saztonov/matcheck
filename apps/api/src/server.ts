import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { loadEnv } from './lib/env.js';
import { logger } from './lib/logger.js';
import { healthRoutes } from './routes/health.js';

export async function buildServer() {
  const env = loadEnv();

  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: env.NODE_ENV === 'production',
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(healthRoutes);

  return app;
}
