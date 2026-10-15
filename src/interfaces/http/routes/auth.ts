import type { FastifyInstance, FastifySchema } from 'fastify';
import type { UseCases } from '../../../composition-root.ts';
import type { AcceptInvitationInput } from '../../../core/identity/application/accept-invitation.ts';
import { IDENTITY_MESSAGES } from '../../../core/identity/domain/errors.ts';
import { translate } from '../../../i18n/messages.ts';
import { SESSION_COOKIE, type SessionCookie } from '../authentication.ts';

const logInSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: {
      email: { type: 'string' },
      password: { type: 'string' },
    },
  },
};

const acceptInvitationSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['token', 'password'],
    additionalProperties: false,
    properties: {
      token: { type: 'string' },
      password: { type: 'string' },
      name: { type: ['string', 'null'] },
    },
  },
};

const requestResetSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['email'],
    additionalProperties: false,
    properties: { email: { type: 'string' } },
  },
};

const resetPasswordSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['token', 'password'],
    additionalProperties: false,
    properties: { token: { type: 'string' }, password: { type: 'string' } },
  },
};

/**
 * Access to the system (V2 section 9C). The login, the logout and the
 * acceptance of an invitation are the exceptions of REQ-410: they are what a
 * person without a session needs to get one.
 */
export function registerAuthRoutes(
  app: FastifyInstance,
  useCases: UseCases,
  cookie: SessionCookie,
): void {
  // REQ-411: the token goes into the cookie and nowhere else; the body says who.
  app.post(
    '/auth/login',
    { schema: logInSchema, config: { public: true } },
    async (request, reply) => {
      const session = await useCases.logIn.execute(
        request.body as { email: string; password: string },
      );
      cookie.set(reply, session.token, session.expiresAt);
      return { user: session.user };
    },
  );

  // REQ-411: ends the session on the server. Without one there is nothing to
  // end, and the answer is the same.
  app.post('/auth/logout', { config: { public: true } }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token !== undefined && token !== '') {
      await useCases.logOut.execute({ token });
    }
    cookie.clear(reply);
    return reply.code(204).send();
  });

  // Who is logged in (REQ-400): what the app bar shows.
  app.get('/auth/me', { config: { requires: 'USER' } }, async (request) => request.user);

  // REQ-422: the invitation link's page posts here.
  app.post(
    '/auth/invitation/acceptance',
    { schema: acceptInvitationSchema, config: { public: true } },
    async (request, reply) => {
      const user = await useCases.acceptInvitation.execute(request.body as AcceptInvitationInput);
      return reply.code(201).send(user);
    },
  );

  // REQ-425: one answer, whether the e-mail has an account or not (REJ-406).
  app.post(
    '/auth/password-reset/request',
    { schema: requestResetSchema, config: { public: true } },
    async (request, reply) => {
      await useCases.requestPasswordReset.execute(request.body as { email: string });
      return reply.code(202).send({ message: translate(IDENTITY_MESSAGES.RESET_REQUESTED) });
    },
  );

  // REQ-426: the new password through the link of the e-mail.
  app.post(
    '/auth/password-reset',
    { schema: resetPasswordSchema, config: { public: true } },
    async (request, reply) => {
      await useCases.resetPassword.execute(request.body as { token: string; password: string });
      return reply.code(204).send();
    },
  );
}
