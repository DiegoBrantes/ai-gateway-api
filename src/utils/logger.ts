import pino from 'pino';
import { env, isProduction, isTest } from '../config/env';

/**
 * Structured logger shared across the app. Pretty-printed in dev,
 * JSON in production (ready for shipping to Loki/Datadog/etc.),
 * silent during tests to keep output clean.
 */
export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
  redact: {
    paths: ['req.headers.authorization', 'req.headers["x-api-key"]'],
    censor: '[redacted]',
  },
});
