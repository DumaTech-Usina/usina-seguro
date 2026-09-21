import type {
  PolicyIssuedEvent,
  PolicyIssuedNotifier,
} from '../../policy/application/policy-issued-notifier.ts';
import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../../proposal/domain/errors.ts';
import { ReferenceNames } from '../../registry/application/reference-names.ts';
import type { ReferenceRepository } from '../../registry/application/reference-repository.ts';
import { Notification } from '../domain/notification.ts';
import type { NotificationChannel } from './notification-channel.ts';
import type { NotificationRepository } from './notification-repository.ts';
import { toNotificationView } from './notification-view.ts';

export interface NotifyPolicyIssuedDependencies {
  readonly notifications: NotificationRepository;
  readonly proposals: ProposalRepository;
  /** IN-01: the names REQ-100 requires the notification to carry. */
  readonly references: ReferenceRepository;
  /**
   * REQ-101, REQ-103: every channel the notification is published through.
   *
   * A list and not one channel, because REQ-103 adds channels without
   * replacing the ones already there. Empty is a valid configuration: REQ-102
   * makes the initial implementation the in-app notification, which is the
   * record this use case writes.
   */
  readonly channels: readonly NotificationChannel[];
  readonly newId: () => string;
}

/**
 * FP-01 step 7 / REQ-100 / CA-029: the emission was effectuated, so the broker
 * is notified with the client, the broker, the worked percentage, the net
 * value and the ramo.
 *
 * It implements the port the policy module declares, which is the whole of the
 * `notification -> policy` coupling: the policy hands over the emission and
 * learns nothing about notifications.
 *
 * Two things happen here and they are not the same thing:
 *
 * 1. the notification is **recorded** (REQ-105) — what was notified, to whom
 *    and when. The record is the core's obligation and does not depend on any
 *    channel being configured; it is also the in-app notification of REQ-102,
 *    which `ListNotifications` serves at OUT-10;
 * 2. the notification is **published** through the single contract of REQ-101,
 *    to every channel wired at composition time. Nothing here knows what a
 *    channel does with it (REJ-017).
 *
 * **A missing registry entry does not stop it.** IN-01 gives a reference a
 * name and REQ-002 does not let the system refuse a business over a missing
 * one, so an unregistered client becomes a notification carrying the
 * identifier rather than no notification at all — the same choice every
 * listing in the system already makes.
 */
export class NotifyPolicyIssued implements PolicyIssuedNotifier {
  private readonly deps: NotifyPolicyIssuedDependencies;

  constructor(deps: NotifyPolicyIssuedDependencies) {
    this.deps = deps;
  }

  async notify(event: PolicyIssuedEvent): Promise<void> {
    const proposal = await this.deps.proposals.findById(event.proposalId);

    if (proposal === null) {
      throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: event.proposalId });
    }

    const names = await ReferenceNames.load(this.deps.references);

    const notification = Notification.issue({
      id: this.deps.newId(),
      // REQ-100 notifies the broker, and the broker of a business is the one
      // the proposal records (REQ-022).
      recipientId: proposal.brokerId,
      policyId: event.policyId,
      policyNumber: event.policyNumber,
      content: {
        client: { id: proposal.clientId, name: names.of('CLIENT', proposal.clientId) },
        broker: { id: proposal.brokerId, name: names.of('BROKER', proposal.brokerId) },
        product: { id: proposal.productId, name: names.of('PRODUCT', proposal.productId) },
        workedCommission: proposal.workedCommission,
        netPremium: proposal.netPremium,
      },
      occurredAt: event.issuedAt,
    });

    await this.deps.notifications.save(notification);

    // REQ-101: one contract, whatever the channel. The payload is the same
    // view OUT-10 answers, so a channel added tomorrow reads what the record
    // already says instead of reaching into the domain.
    const published = toNotificationView(notification);

    for (const channel of this.deps.channels) {
      await channel.publish(published);
    }
  }
}
