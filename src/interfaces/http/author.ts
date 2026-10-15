import type { FastifyRequest } from 'fastify';

/**
 * Who signs an audited act at the HTTP boundary (REQ-216).
 *
 * The author is the user of the session, by id — never something the request
 * carries: a body that names an author is refused by the route's schema, and a
 * route that takes no body has nothing to read it from (CA-416). The routes
 * only call `authorOf`, and the core only receives an author string, so how
 * the user is identified can change here without touching a rule.
 *
 * Every route that signs is protected (REQ-410), so a user is always there by
 * the time a handler runs; finding none is a wiring mistake, not a request to
 * answer.
 */
export function authorOf(request: FastifyRequest): string {
  if (request.user === null) {
    throw new Error('A signed act reached its handler without a session.');
  }
  return request.user.id;
}
