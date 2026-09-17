import type { FastifyInstance } from 'fastify';

/**
 * Liveness probe. Does not touch the domain.
 */
export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/health', async () => ({ status: 'ok' }));
}
