import { buildApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';

/**
 * Process entrypoint: build the app, start listening and wire graceful
 * shutdown so in-flight requests drain and the cache connection closes.
 */
async function main(): Promise<void> {
  const app = await buildApp();

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
    logger.info(
      `AI Gateway ready → http://${env.HOST}:${env.PORT}  (docs: /docs · dashboard: /dashboard)`,
    );
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, async () => {
      logger.info(`${signal} received — shutting down gracefully`);
      await app.close();
      process.exit(0);
    });
  }
}

void main();
