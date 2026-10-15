import { composeApplication } from './composition-root.ts';
import { loadConfig } from './config/config.ts';
import { createHttpServer } from './interfaces/http/server.ts';

/**
 * Entry point: one command, one process, one port.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const application = composeApplication(config);
  const app = createHttpServer(application.useCases, {
    logger: true,
    // REQ-412: production runs on https, so the cookie never travels in clear.
    secureCookies: config.env === 'production',
    publicUrl: config.http.publicUrl,
  });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}, shutting down.`);
    await app.close();
    await application.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.http.port, host: config.http.host });
  app.log.info(`Persistence: ${config.persistence.driver} | Environment: ${config.env}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
