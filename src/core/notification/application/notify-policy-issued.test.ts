import { describe, expect, it } from 'vitest';
import { InMemoryBrokerRepository } from '../../../infrastructure/persistence/in-memory/in-memory-broker-repository.ts';
import { InMemoryClientRepository } from '../../../infrastructure/persistence/in-memory/in-memory-client-repository.ts';
import { InMemoryNotificationRepository } from '../../../infrastructure/persistence/in-memory/in-memory-notification-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { InMemoryReferenceRepository } from '../../../infrastructure/persistence/in-memory/in-memory-reference-repository.ts';
import type { PolicyIssuedEvent } from '../../policy/application/policy-issued-notifier.ts';
import { Authorship } from '../../proposal/domain/authorship.ts';
import { CalendarDate } from '../../proposal/domain/calendar-date.ts';
import { RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal, type ProposalRegistration } from '../../proposal/domain/proposal.ts';
import { Broker } from '../../registry/domain/broker.ts';
import { Client } from '../../registry/domain/client.ts';
import { Reference, type ReferenceKind } from '../../registry/domain/reference.ts';
import type { NotificationChannel } from './notification-channel.ts';
import type { NotificationView } from './notification-view.ts';
import { NotifyPolicyIssued } from './notify-policy-issued.ts';

const ISSUED_AT = new Date('2026-09-21T13:00:00.000Z');

/**
 * A channel of REQ-103. It is a stub of the port and nothing more: the point
 * of CA-030 is that a new one plugs in without a single rule changing, and
 * this file is what proves it.
 */
class RecordingChannel implements NotificationChannel {
  readonly name: string;
  readonly published: NotificationView[] = [];

  constructor(name: string) {
    this.name = name;
  }

  async publish(notification: NotificationView): Promise<void> {
    this.published.push(notification);
  }
}

function scenario(channels: readonly NotificationChannel[] = []) {
  const notifications = new InMemoryNotificationRepository();
  const proposals = new InMemoryProposalRepository();
  const references = new InMemoryReferenceRepository();
  const brokers = new InMemoryBrokerRepository();
  const clients = new InMemoryClientRepository();
  let sequence = 0;

  const useCase = new NotifyPolicyIssued({
    notifications,
    proposals,
    references,
    brokers,
    clients,
    channels,
    newId: () => `notification-${++sequence}`,
  });

  return { notifications, proposals, references, brokers, clients, useCase };
}

function transmitted(overrides: Partial<ProposalRegistration> = {}): Proposal {
  return Proposal.register({
    id: 'proposal-1',
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'auto',
    paymentMethodId: 'bank-slip',
    proposalNumber: 'PRP-9001',
    netPremium: Money.fromString('1200.00'),
    coverageStart: CalendarDate.fromString('2026-10-01'),
    coverageEnd: CalendarDate.fromString('2027-10-01'),
    installments: [],
    workedCommission: Percentage.fromString('32.5'),
    workedCommissionMode: 'INTEGRAL',
    receipt: { kind: 'DIRECT' },
    registeredBy: 'operator',
    registeredAt: new Date('2026-09-17T12:00:00.000Z'),
    ...overrides,
  });
}

async function registerNames(
  references: InMemoryReferenceRepository,
  brokers: InMemoryBrokerRepository,
  clients: InMemoryClientRepository,
): Promise<void> {
  // REQ-318: the client's name comes from the client registry (V2 section 9E).
  await clients.save(
    Client.register({
      id: 'client-1',
      name: 'Maria Souza',
      cpf: '52998224725',
      signed: Authorship.of('operator', new Date('2026-09-01T00:00:00.000Z')),
    }),
  );

  // REQ-308: the broker's name comes from the broker registry (V2 section 9D).
  await brokers.save(
    Broker.register({
      id: 'broker-1',
      name: 'Corretora Alfa',
      cpf: '52998224725',
      signed: Authorship.of('operator', new Date('2026-09-01T00:00:00.000Z')),
    }),
  );

  const named: readonly [ReferenceKind, string, string][] = [['PRODUCT', 'auto', 'Automovel']];

  for (const [kind, id, name] of named) {
    await references.save(
      Reference.register({ kind, id, name, registeredAt: new Date('2026-09-01T00:00:00.000Z') }),
    );
  }
}

function event(overrides: Partial<PolicyIssuedEvent> = {}): PolicyIssuedEvent {
  return {
    policyId: 'policy-1',
    proposalId: 'proposal-1',
    policyNumber: 'APL-4711',
    issuedAt: ISSUED_AT,
    ...overrides,
  };
}

describe('NotifyPolicyIssued', () => {
  it('notifies the broker with the five fields of REQ-100 (CA-029)', async () => {
    const { notifications, proposals, references, brokers, clients, useCase } = scenario();
    await proposals.save(transmitted());
    await registerNames(references, brokers, clients);

    await useCase.notify(event());

    const [recorded] = await notifications.list({});
    expect(recorded?.recipientId).toBe('broker-1');
    expect(recorded?.content).toMatchObject({
      client: { id: 'client-1', name: 'Maria Souza' },
      broker: { id: 'broker-1', name: 'Corretora Alfa' },
      product: { id: 'auto', name: 'Automovel' },
    });
    // REQ-212 and REQ-202: the worked percentage and the net value.
    expect(recorded?.content.workedCommission?.toString()).toBe('32.5');
    expect(recorded?.content.netPremium.toString()).toBe('1200.00');
  });

  it('records what was notified, to whom and when (REQ-105)', async () => {
    const { notifications, proposals, references, brokers, clients, useCase } = scenario();
    await proposals.save(transmitted());
    await registerNames(references, brokers, clients);

    await useCase.notify(event());

    const [recorded] = await notifications.list({});
    expect(recorded).toMatchObject({
      id: 'notification-1',
      event: 'POLICY_ISSUED',
      recipientId: 'broker-1',
      policyId: 'policy-1',
      policyNumber: 'APL-4711',
      occurredAt: ISSUED_AT,
    });
  });

  it('copies the names instead of joining them later (REQ-105, REJ-011)', async () => {
    const { notifications, proposals, references, brokers, clients, useCase } = scenario();
    await proposals.save(transmitted());
    await registerNames(references, brokers, clients);

    await useCase.notify(event());

    // The registry is corrected afterwards. What the broker was told does not
    // change, for the same reason a calculated commission keeps its rates.
    const client = await clients.findById('client-1');
    await clients.save(
      (client as Client).change({
        name: 'Maria Souza Lima',
        cpf: '52998224725',
        signed: Authorship.of('operator', new Date('2026-09-22T00:00:00.000Z')),
      }),
    );

    const [recorded] = await notifications.list({});
    expect(recorded?.content.client.name).toBe('Maria Souza');
  });

  it('notifies all the same when nothing is registered in IN-01 (REQ-002)', async () => {
    const { notifications, proposals, useCase } = scenario();
    await proposals.save(transmitted());

    await useCase.notify(event());

    const [recorded] = await notifications.list({});
    expect(recorded?.content.client).toEqual({ id: 'client-1', name: null });
    expect(recorded?.recipientId).toBe('broker-1');
  });

  it('publishes through the single contract, whatever the channel (REQ-101)', async () => {
    const email = new RecordingChannel('email');
    const { proposals, references, brokers, clients, useCase } = scenario([email]);
    await proposals.save(transmitted());
    await registerNames(references, brokers, clients);

    await useCase.notify(event());

    expect(email.published).toHaveLength(1);
    // REQ-103, REQ-104: the payload is plain data, which is what an adapter
    // puts in a message body or on a queue.
    expect(email.published[0]).toMatchObject({
      recipientId: 'broker-1',
      policyNumber: 'APL-4711',
      client: { id: 'client-1', name: 'Maria Souza' },
      workedCommission: '32.5',
      netPremium: '1200.00',
    });
  });

  it('adds a second channel without changing a rule (CA-030, REQ-103)', async () => {
    const email = new RecordingChannel('email');
    const whatsapp = new RecordingChannel('whatsapp');
    const { notifications, proposals, useCase } = scenario([email, whatsapp]);
    await proposals.save(transmitted());

    await useCase.notify(event());

    expect(email.published).toHaveLength(1);
    expect(whatsapp.published).toHaveLength(1);
    // And the record of REQ-105 is one, not one per channel.
    expect(await notifications.list({})).toHaveLength(1);
  });

  it('records the notification even with no channel configured (REQ-102, REQ-105)', async () => {
    const { notifications, proposals, useCase } = scenario([]);
    await proposals.save(transmitted());

    await useCase.notify(event());

    // The in-app notification is the record itself: with no outbound channel
    // wired, OUT-10 still has something to show.
    expect(await notifications.list({})).toHaveLength(1);
  });

  it('reports an unknown proposal as not found', async () => {
    const { useCase } = scenario();

    await expect(useCase.notify(event({ proposalId: 'ghost' }))).rejects.toThrow(RecordNotFound);
  });
});

describe('NotifyPolicyIssued with parcelled CT (REQ-228)', () => {
  it('carries both CTs: the first and the subsequent installments (REQ-228)', async () => {
    const email = new RecordingChannel('email');
    const { notifications, proposals, useCase } = scenario([email]);
    await proposals.save(
      transmitted({
        installments: [
          { amount: Money.fromString('100.00'), dueDate: null },
          { amount: Money.fromString('100.00'), dueDate: null },
        ],
        workedCommission: Percentage.fromStringWithoutCeiling('150'),
        subsequentWorkedCommission: Percentage.fromString('30'),
        workedCommissionMode: 'PARCELLED',
      }),
    );

    await useCase.notify(event());

    const [recorded] = await notifications.list({});
    expect(recorded?.content.workedCommission?.toString()).toBe('150');
    expect(recorded?.content.subsequentWorkedCommission?.toString()).toBe('30');
    expect(email.published[0]).toMatchObject({
      workedCommission: '150',
      subsequentWorkedCommission: '30',
    });
  });

  it('carries one CT with integral CT, as before', async () => {
    const email = new RecordingChannel('email');
    const { proposals, useCase } = scenario([email]);
    await proposals.save(transmitted());

    await useCase.notify(event());

    expect(email.published[0]).toMatchObject({
      workedCommission: '32.5',
      subsequentWorkedCommission: null,
    });
  });
});
