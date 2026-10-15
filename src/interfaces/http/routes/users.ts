import type { FastifyInstance, FastifySchema } from 'fastify';
import type { UseCases } from '../../../composition-root.ts';
import type { HandedInvitation } from '../../../core/identity/application/invite-user.ts';
import type { Role } from '../../../core/identity/domain/role.ts';
import { authorOf } from '../author.ts';

const ROLES = ['ADMINISTRATOR', 'USER'] as const;

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string' } },
} as const;

const inviteSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['email', 'role'],
    additionalProperties: false,
    properties: { email: { type: 'string' }, role: { type: 'string', enum: ROLES } },
  },
};

const changeRoleSchema: FastifySchema = {
  params: idParams,
  body: {
    type: 'object',
    required: ['role'],
    additionalProperties: false,
    properties: { role: { type: 'string', enum: ROLES } },
  },
};

const ADMINISTRATOR = { requires: 'ADMINISTRATOR' } as const;

/**
 * The users of the system (V2 section 9C). The directory is for anyone logged
 * in; the management of REQ-440 only for administrators (REQ-401, REQ-430).
 *
 * `publicUrl` is where the invitation link points. While no e-mail is
 * configured the link goes back to the administrator, to hand over; once it
 * is, the link goes by e-mail only and `link` is `null` (REQ-436).
 */
export function registerUserRoutes(
  app: FastifyInstance,
  useCases: UseCases,
  publicUrl: string,
): void {
  const answer = (invitation: HandedInvitation) => ({
    email: invitation.email,
    expiresAt: invitation.expiresAt,
    link:
      invitation.token === null ? null : `${publicUrl}/app/invitation/?token=${invitation.token}`,
  });
  const actorOf = (request: Parameters<typeof authorOf>[0]) => ({
    id: authorOf(request),
    role: request.user?.role as Role,
  });

  // REQ-216, REQ-400: each id a record was signed with, and the name to show.
  app.get('/users/directory', async () => useCases.listUserDirectory.execute());

  // REQ-440: users with their situation, and the pending invitations.
  app.get('/users', { config: ADMINISTRATOR }, async (request) =>
    useCases.listUsers.execute({ actor: actorOf(request) }),
  );

  // REQ-420, REQ-421.
  app.post(
    '/users/invitations',
    { schema: inviteSchema, config: ADMINISTRATOR },
    async (request, reply) => {
      const { email, role } = request.body as { email: string; role: Role };
      const invitation = await useCases.inviteUser.execute({
        actor: actorOf(request),
        email,
        role,
      });
      return reply.code(201).send(answer(invitation));
    },
  );

  // REQ-440, FA-401: a new link; the previous one stops working.
  app.post(
    '/users/invitations/:id/resend',
    { schema: { params: idParams }, config: ADMINISTRATOR },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const invitation = await useCases.resendInvitation.execute({
        actor: actorOf(request),
        invitationId: id,
      });
      return reply.code(201).send(answer(invitation));
    },
  );

  // REQ-403, REQ-406.
  app.post(
    '/users/:id/deactivation',
    { schema: { params: idParams }, config: ADMINISTRATOR },
    async (request) => {
      const { id } = request.params as { id: string };
      return useCases.deactivateUser.execute({ actor: actorOf(request), userId: id });
    },
  );

  // REQ-404, REQ-406.
  app.post(
    '/users/:id/role',
    { schema: changeRoleSchema, config: ADMINISTRATOR },
    async (request) => {
      const { id } = request.params as { id: string };
      const { role } = request.body as { role: Role };
      return useCases.changeUserRole.execute({ actor: actorOf(request), userId: id, role });
    },
  );
}
