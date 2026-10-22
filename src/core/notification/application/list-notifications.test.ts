import { describe, expect, it } from 'vitest';
import { InMemoryNotificationRepository } from '../../../infrastructure/persistence/in-memory/in-memory-notification-repository.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Notification } from '../domain/notification.ts';
import { ListNotifications } from './list-notifications.ts';

function issued(id: string, recipientId: string, occurredAt: string): Notification {
  return Notification.issue({
    id,
    recipientId,
    policyId: `policy-${id}`,
    policyNumber: `APL-${id}`,
    content: {
      client: { id: 'client-1', name: 'Maria Souza' },
      broker: { id: recipientId, name: null },
      product: { id: 'auto', name: 'Automovel' },
      workedCommission: Percentage.fromString('32.5'),
      netPremium: Money.fromString('1200.00'),
    },
    occurredAt: new Date(occurredAt),
  });
}

async function scenario() {
  const notifications = new InMemoryNotificationRepository();

  await notifications.save(issued('1', 'broker-1', '2026-09-19T10:00:00.000Z'));
  await notifications.save(issued('2', 'broker-2', '2026-09-20T10:00:00.000Z'));
  await notifications.save(issued('3', 'broker-1', '2026-09-21T10:00:00.000Z'));

  return { notifications, useCase: new ListNotifications({ notifications }) };
}

describe('ListNotifications', () => {
  it('answers every notification, most recent first (OUT-10, REQ-105)', async () => {
    const { useCase } = await scenario();

    const listed = await useCase.execute();

    expect(listed.items.map((notification) => notification.id)).toEqual(['3', '2', '1']);
  });

  it('narrows to one recipient (OUT-10)', async () => {
    const { useCase } = await scenario();

    const listed = await useCase.execute({ recipientId: 'broker-1' });

    expect(listed.items.map((notification) => notification.id)).toEqual(['3', '1']);
  });

  it('reads a blank recipient as no filter, not as a recipient named ""', async () => {
    const { useCase } = await scenario();

    expect((await useCase.execute({ recipientId: '  ' })).total).toBe(3);
  });

  it('answers an empty list for a recipient with nothing (REQ-002)', async () => {
    const { useCase } = await scenario();

    expect(await useCase.execute({ recipientId: 'broker-9' })).toMatchObject({
      items: [],
      total: 0,
    });
  });

  it('carries the five fields of REQ-100 as decimal text (REQ-120, REQ-121)', async () => {
    const { useCase } = await scenario();

    const {
      items: [first],
    } = await useCase.execute({ recipientId: 'broker-1' });

    expect(first).toMatchObject({
      event: 'POLICY_ISSUED',
      recipientId: 'broker-1',
      policyId: 'policy-3',
      policyNumber: 'APL-3',
      client: { id: 'client-1', name: 'Maria Souza' },
      // IN-01 registered no name for this broker; the identifier is the answer.
      broker: { id: 'broker-1', name: null },
      product: { id: 'auto', name: 'Automovel' },
      workedCommission: '32.5',
      netPremium: '1200.00',
      occurredAt: '2026-09-21T10:00:00.000Z',
    });
  });
});
