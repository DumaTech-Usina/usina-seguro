import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { UseCases } from '../../composition-root.ts';
import type { UserView } from '../../core/identity/application/user-view.ts';
import { IDENTITY_MESSAGES } from '../../core/identity/domain/errors.ts';
import { translate } from '../../i18n/messages.ts';

/** The cookie that carries the session token (REQ-411). */
export const SESSION_COOKIE = 'usina_session';

declare module 'fastify' {
  interface FastifyRequest {
    /** Who is logged in; `null` only on the routes open to everyone (REQ-410). */
    user: UserView | null;
  }

  interface FastifyContextConfig {
    /** REQ-410: one of the exceptions that need no session. Absent means protected. */
    public?: boolean;
  }
}

export interface AuthenticationOptions {
  /** `Secure` on the cookie: only over https, which is what production runs on. */
  readonly secureCookies: boolean;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Access at the HTTP edge (V2 section 9C).
 *
 * - **REQ-417**: a request that changes data and declares an `Origin` must
 *   come from this very host. Checked first, so it also covers the login.
 * - **REQ-410**: every route needs a session unless it is declared `public`;
 *   the pages under `/app/` are open because they hold no data. A route added
 *   tomorrow without a word about it is protected. Checked on `onRequest`, so a
 *   refused request is refused before its body is read.
 *
 * The session itself is the core's (`ResolveSession`): this file only carries
 * the token between the cookie and the use case.
 */
export function registerAuthentication(
  app: FastifyInstance,
  useCases: UseCases,
  options: AuthenticationOptions,
): SessionCookie {
  app.register(fastifyCookie);
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request, reply) => {
    if (!SAFE_METHODS.has(request.method) && isForeignOrigin(request)) {
      return reply.code(403).send({
        error: 'forbidden_origin',
        messageKey: IDENTITY_MESSAGES.FOREIGN_ORIGIN,
        message: translate(IDENTITY_MESSAGES.FOREIGN_ORIGIN),
      });
    }

    if (isPublic(request)) {
      return;
    }

    const token = request.cookies[SESSION_COOKIE];
    request.user =
      token === undefined || token === '' ? null : await useCases.resolveSession.execute({ token });

    if (request.user === null) {
      return reply.code(401).send({
        error: 'unauthenticated',
        messageKey: IDENTITY_MESSAGES.AUTHENTICATION_REQUIRED,
        message: translate(IDENTITY_MESSAGES.AUTHENTICATION_REQUIRED),
      });
    }
  });

  return sessionCookie(options.secureCookies);
}

/** Writes and erases the session cookie, with the flags of this server. */
export interface SessionCookie {
  set(reply: FastifyReply, token: string, expiresAt: string): void;
  clear(reply: FastifyReply): void;
}

/** REQ-411, REQ-412: the token, readable by the server only, until the session expires. */
function sessionCookie(secure: boolean): SessionCookie {
  const flags = { httpOnly: true, sameSite: 'strict', path: '/', secure } as const;

  return {
    set: (reply, token, expiresAt) =>
      reply.setCookie(SESSION_COOKIE, token, { ...flags, expires: new Date(expiresAt) }),
    clear: (reply) => reply.clearCookie(SESSION_COOKIE, flags),
  };
}

function isPublic(request: FastifyRequest): boolean {
  const route = request.routeOptions;
  return route.config.public === true || (route.url ?? '').startsWith('/app');
}

/** A missing `Origin` is not foreign: browsers send it on every cross-site write. */
function isForeignOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) {
    return false;
  }

  try {
    return new URL(origin).host !== request.headers.host;
  } catch {
    return true;
  }
}
