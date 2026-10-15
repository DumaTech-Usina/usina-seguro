import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { IDENTITY_MESSAGES } from '../domain/errors.ts';
import { Invitation } from '../domain/invitation.ts';
import type { Role } from '../domain/role.ts';
import { normalizeEmail } from '../domain/user.ts';
import type { InvitationRepository } from './invitation-repository.ts';
import type { SecretGenerator } from './secret-generator.ts';
import type { UserRepository } from './user-repository.ts';

/** An invitation as it leaves the core: the token goes into the link, once. */
export interface IssuedInvitation {
  readonly email: string;
  readonly token: string;
  readonly expiresAt: string;
}

export interface IssueInvitationDependencies {
  readonly users: UserRepository;
  readonly invitations: InvitationRepository;
  readonly secrets: SecretGenerator;
  readonly newId: () => string;
  readonly now: () => Date;
}

/**
 * Issues an invitation, whoever asks for it (REQ-405, REQ-420, REQ-421).
 *
 * - the e-mail of an active user is refused;
 * - a newer invitation for the same e-mail supersedes the pending ones, so
 *   only the last link works;
 * - only the digest of the token is stored (REQ-416).
 */
export async function issueInvitation(
  deps: IssueInvitationDependencies,
  input: { email: string; role: Role; invitedBy: string | null },
): Promise<IssuedInvitation> {
  const email = normalizeEmail(input.email);

  if ((await deps.users.findActiveByEmail(email)) !== null) {
    throw new BusinessRuleViolation('REQ-421', IDENTITY_MESSAGES.EMAIL_ALREADY_ACTIVE);
  }

  for (const pending of await deps.invitations.listPendingByEmail(email)) {
    await deps.invitations.save(pending.supersede());
  }

  const token = deps.secrets.generate();
  const invitation = Invitation.issue({
    id: deps.newId(),
    email,
    role: input.role,
    tokenDigest: deps.secrets.digest(token),
    invitedBy: input.invitedBy,
    invitedAt: deps.now(),
  });

  await deps.invitations.save(invitation);

  return { email, token, expiresAt: invitation.expiresAt.toISOString() };
}
