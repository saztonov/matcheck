import { pino } from 'pino';
import { loadEnv } from './env.js';

const env = loadEnv();

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'password',
      'currentPassword',
      'newPassword',
      'authorization',
      'cookie',
      'token',
      'refreshToken',
      'apiKey',
      'api_key',
      '*.password',
      '*.token',
      'headers.authorization',
      'headers.cookie',
    ],
    censor: '[REDACTED]',
  },
  ...(env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }
    : {}),
});
