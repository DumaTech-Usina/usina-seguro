import {
  type IssueInvitationDependencies,
  type IssuedInvitation,
  issueInvitation,
} from './issue-invitation.ts';

export type { IssuedInvitation } from './issue-invitation.ts';

export type IssueFirstAdministratorInvitationDependencies = IssueInvitationDependencies;

/**
 * REQ-405: the first administrator is born of a command run on the server,
 * which issues an administrator invitation and shows it to whoever ran it.
 * There is no default user or password (REJ-407).
 *
 * Nobody signs it — no user exists yet, and whoever runs a command on the
 * server already holds the system — so `invitedBy` is empty. For the same
 * reason the command is not limited to the first run: it is also how the
 * Usina gets an administrator back if it ever has none.
 */
export class IssueFirstAdministratorInvitation {
  private readonly deps: IssueFirstAdministratorInvitationDependencies;

  constructor(deps: IssueFirstAdministratorInvitationDependencies) {
    this.deps = deps;
  }

  execute(input: { email: string }): Promise<IssuedInvitation> {
    return issueInvitation(this.deps, {
      email: input.email,
      role: 'ADMINISTRATOR',
      invitedBy: null,
    });
  }
}
