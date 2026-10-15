import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * Where the web interface lives.
 *
 * The API owns the root (`GET /policies/:id` answers JSON), so the pages hang
 * off a prefix of their own. Moving the API under `/api` instead would break
 * every contract already published in the README and exercised by the e2e
 * suite, for no gain.
 */
export const WEB_PREFIX = '/app/';

/**
 * Serves the operator's pages from the same process and the same port.
 *
 * There is no build step (see the technical decisions in the README), so what
 * is served is what is written: plain HTML, CSS and ES modules. That is also
 * why the browser code is `.js` and not `.ts` — Node strips types for what it
 * runs itself, and the browser receives the file as it is on disk.
 *
 * This adapter holds no business rule. It does not even know the use cases:
 * the pages talk to the same HTTP API any other client would use.
 */
export function registerWebInterface(app: FastifyInstance): void {
  // Whoever starts the service types the bare host, not `/app/`. The root
  // belongs to the API, which answers on named routes and has nothing to show
  // at `/`, so it points at the interface instead of answering 404.
  app.get('/', { config: { public: true } }, async (_request, reply) =>
    reply.redirect(WEB_PREFIX, 302),
  );

  app.register(fastifyStatic, {
    root: path.join(import.meta.dirname, 'public'),
    prefix: WEB_PREFIX,
    // `/app` answers a redirect to `/app/`, so a directory resolves its index.
    redirect: true,
    index: ['index.html'],
  });
}
