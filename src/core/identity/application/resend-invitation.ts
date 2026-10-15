import { BusinessRuleViolation, RecordNotFound } from '../../proposal/domain/errors.ts';
import { IDENTITY_MESSAGES } from '../domain/errors.ts';
import type { Actor } from './actor.ts';
import { assertAdministrator } from './authorize.ts';
import { type HandedInvitation, type InviteUserDependencies, handOver } from './invite-user.ts';
import { issueInvitation } from './issue-invitation.ts';

/**
 * REQ-440, REQ-421: a new link for a pending invitation — expired or not —
 * with the same e-mail and role. Issuing it supersedes the previous one, so
 * only the newest link works. There is no cancellation: resending is it.
 */
export class ResendInvitation {
  private readonly deps: InviteUserDependencies;

  constructor(deps: InviteUserDependencies) {
    this.deps = deps;
  }

  async execute(input: { actor: Actor; invitationId: string }): Promise<HandedInvitation> {
    assertAdministrator(input.actor);

    const invitation = await this.deps.invitations.findById(input.invitationId);
    if (invitation === null) {
      throw new RecordNotFound(IDENTITY_MESSAGES.INVITATION_NOT_FOUND);
    }
    if (invitation.status !== 'PENDING') {
      throw new BusinessRuleViolation('REQ-421', IDENTITY_MESSAGES.INVITATION_NOT_PENDING);
    }

    const issued = await issueInvitation(this.deps, {
      email: invitation.email,
      role: invitation.role,
      invitedBy: input.actor.id,
    });
    return handOver(this.deps.mailer, issued);
  }
}
