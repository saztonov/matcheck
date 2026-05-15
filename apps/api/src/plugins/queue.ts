import fp from 'fastify-plugin';
import { Queue, type ConnectionOptions } from 'bullmq';
import { loadEnv } from '../lib/env.js';

export type UpdParseJobData = {
  sourceDocumentId: string;
  s3Key: string;
};

export const UPD_PARSE_QUEUE = 'upd-parse';

declare module 'fastify' {
  interface FastifyInstance {
    queues: {
      updParse: Queue<UpdParseJobData>;
    };
  }
}

// BullMQ требует отдельное подключение под Queue (то же самое верно для
// Worker — см. apps/api/src/worker.ts). Использовать общий ioredis из
// плагина redis.ts напрямую нельзя: BullMQ выставляет на нём своё
// maxRetriesPerRequest=null/enableReadyCheck=false.
export function buildQueueConnection(): ConnectionOptions {
  const env = loadEnv();
  const url = env.REDIS_URL ?? 'redis://localhost:6379';
  return { url, maxRetriesPerRequest: null };
}

export default fp(async (app) => {
  const updParse = new Queue<UpdParseJobData>(UPD_PARSE_QUEUE, {
    connection: buildQueueConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    },
  });

  app.decorate('queues', { updParse });
  app.addHook('onClose', async () => {
    try {
      await updParse.close();
    } catch {
      /* ignore */
    }
  });

  app.log.info({ queue: UPD_PARSE_QUEUE }, 'queue ready');
});
