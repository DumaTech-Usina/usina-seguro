import type { FastifyInstance } from 'fastify';

/**
 * Liveness probe. Does not touch the domain.
 */
export function registerHealthRoute(app: FastifyInstance): void {
  // REQ-410: one of the exceptions that need no session.
  app.get('/health', { config: { public: true } }, async () => ({ status: 'ok' }));
}
