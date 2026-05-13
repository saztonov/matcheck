import type { preHandlerHookHandler } from 'fastify';

type Noun = 'входа' | 'регистрации';

export interface BurstyRateLimitOptions {
  burst: number;
  burstWindowSec: number;
  slowWindowSec: number;
  keyPrefix: string;
  noun: Noun;
}

export function createBurstyRateLimit(opts: BurstyRateLimitOptions): preHandlerHookHandler {
  const { burst, burstWindowSec, slowWindowSec, keyPrefix, noun } = opts;

  return async function burstyRateLimit(req, reply) {
    const app = req.server;
    const ip = req.ip;
    const slowKey = `matcheck-rl:${keyPrefix}:slow:${ip}`;
    const fastKey = `matcheck-rl:${keyPrefix}:fast:${ip}`;

    try {
      const count = await app.redis.incr(slowKey);
      if (count === 1) {
        await app.redis.expire(slowKey, burstWindowSec);
      }
      if (count <= burst) return;

      const fcount = await app.redis.incr(fastKey);
      if (fcount === 1) {
        await app.redis.expire(fastKey, slowWindowSec);
      }
      if (fcount <= 1) return;

      const ttl = await app.redis.ttl(fastKey);
      const retryAfter = ttl > 0 ? ttl : slowWindowSec;
      reply.header('Retry-After', String(retryAfter));
      return reply.code(429).send({
        error: 'rate_limit_exceeded',
        message: `Слишком много попыток ${noun}. Повторите через ${retryAfter} сек.`,
      });
    } catch (err) {
      app.log.warn({ err, keyPrefix, ip }, 'bursty rate limit skipped (redis error)');
    }
  };
}
