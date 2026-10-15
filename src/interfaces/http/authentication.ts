import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import type { UseCases } from '../../composition-root.ts';
import type { UserView } from '../../core/identity/application/user-view.ts';
import { IDENTITY_MESSAGES } from '../../core/identity/domain/errors.ts';
import type { Role } from '../../core/identity/domain/role.ts';
import { translate } from '../../i18n/messages.ts';

/** The cookie that carries the session token (REQ-411). */
export const SESSION_COOKIE = 'usina_session';

declare module 'fastify' {
  interface FastifyRequest {
    /** Who is logged in; `null` only on the routes open to everyone (REQ-410). */
    user: UserView | null;
  }

  interface FastifyContextConfig {
    /** REQ-410: one of the exceptions that need no session. */
    public?: boolean;
    /**
     * REQ-430: the role the route requires. `USER` lets both roles in — the
     * Administrador does everything the Usuário does (REQ-401);
     * `ADMINISTRATOR` lets only administrators in.
     */
    requires?: Role;
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
 *   the pages under `/app/` are open because they hold no data. Checked on
 *   `onRequest`, so a refused request is refused before its body is read.
 * - **REQ-430**: every other route declares the role it `requires`, and a
 *   user without it is refused with 403. A route that declares neither stops
 *   the server from starting: it can never be served by accident.
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

  // The options are kept and read when the server is ready: a group may still
  // add `requires` to a route after this hook has seen it (see `server.ts`).
  const routes: RouteOptions[] = [];
  app.addHook('onRoute', (route) => {
    routes.push(route);
  });
  app.addHook('onReady', async () => {
    const undeclared = routes
      .filter((route) => !isOpenToEveryone(route) && route.config?.requires === undefined)
      .map((route) => `${[route.method].flat().join(',')} ${route.url}`);

    if (undeclared.length > 0) {
      throw new Error(`Routes with no access declared (REQ-430): ${undeclared.join('; ')}`);
    }
  });

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

    if (!allows(request.routeOptions.config.requires, request.user.role)) {
      return reply.code(403).send({
        error: 'forbidden',
        messageKey: IDENTITY_MESSAGES.ADMINISTRATOR_ONLY,
        message: translate(IDENTITY_MESSAGES.ADMINISTRATOR_ONLY),
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

/** The pages under `/app/` and the routes declared `public` (REQ-410). */
function isOpenToEveryone(route: RouteOptions): boolean {
  return route.config?.public === true || route.url.startsWith('/app');
}

/** REQ-401: the Administrador does everything the Usuário does, and more. */
function allows(requires: Role | undefined, role: Role): boolean {
  return requires === 'USER' || (requires === 'ADMINISTRATOR' && role === 'ADMINISTRATOR');
}

/**
 * Declares, for every route the group registers from here on that does not
 * say otherwise, the role it requires (REQ-430).
 */
export function requireRole(scope: FastifyInstance, role: Role): void {
  scope.addHook('onRoute', (route) => {
    if (route.config?.public !== true && route.config?.requires === undefined) {
      route.config = { ...route.config, requires: role };
    }
  });
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
