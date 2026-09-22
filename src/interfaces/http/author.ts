import type { FastifyRequest } from 'fastify';

/**
 * How an audited action is signed at the HTTP boundary (REQ-216).
 *
 * There is no login yet, so the author is the identifier the user types, and
 * it travels in the body as `userId` — the same field the other signed forms
 * already use. When login exists, the author becomes the session's username,
 * and this file is what changes: the routes only spread these two constants and
 * call `authorOf`, and the core only receives an author string.
 */
export const SIGNATURE_PROPERTIES = { userId: { type: 'string' } } as const;

export const SIGNATURE_REQUIRED = ['userId'] as const;

export function authorOf(request: FastifyRequest): string {
  return (request.body as { userId: string }).userId;
}
