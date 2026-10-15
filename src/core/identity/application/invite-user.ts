import type { Role } from '../domain/role.ts';
import type { AccessMailer } from './access-mailer.ts';
import type { Actor } from './actor.ts';
import { assertAdministrator } from './authorize.ts';
import {
  type IssueInvitationDependencies,
  type IssuedInvitation,
  issueInvitation,
} from './issue-invitation.ts';

/**
 * An invitation as the administrator gets it back. `token` is there only when
 * no e-mail reaches people: the administrator hands the link over (REQ-436).
 */
export interface HandedInvitation {
  readonly email: string;
  readonly expiresAt: string;
  readonly token: string | null;
}

export interface InviteUserDependencies extends IssueInvitationDependencies {
  readonly mailer: AccessMailer;
}

/** REQ-435, REQ-436: by e-mail when it is configured; back to the administrator otherwise. */
export async function handOver(
  mailer: AccessMailer,
  issued: IssuedInvitation,
): Promise<HandedInvitation> {
  if (!mailer.delivers) {
    return issued;
  }

  await mailer.sendInvitation({
    to: issued.email,
    token: issued.token,
    expiresAt: issued.expiresAt,
  });
  return { email: issued.email, expiresAt: issued.expiresAt, token: null };
}

/** REQ-420: an administrator invites by e-mail and role; the invitation records who. */
export class InviteUser {
  private readonly deps: InviteUserDependencies;

  constructor(deps: InviteUserDependencies) {
    this.deps = deps;
  }

  async execute(input: { actor: Actor; email: string; role: Role }): Promise<HandedInvitation> {
    assertAdministrator(input.actor);
    const issued = await issueInvitation(this.deps, {
      email: input.email,
      role: input.role,
      invitedBy: input.actor.id,
    });
    return handOver(this.deps.mailer, issued);
  }
}
