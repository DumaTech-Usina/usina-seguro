import { describe, expect, it } from 'vitest';
import type { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Notification, type NotificationData } from './notification.ts';

const OCCURRED_AT = new Date('2026-09-21T13:00:00.000Z');

function data(overrides: Partial<Omit<NotificationData, 'event'>> = {}) {
  return {
    id: 'notification-1',
    recipientId: 'broker-1',
    policyId: 'policy-1',
    policyNumber: 'APL-4711',
    content: {
      client: { id: 'client-1', name: 'Maria Souza' },
      broker: { id: 'broker-1', name: 'Corretora Alfa' },
      product: { id: 'auto', name: 'Automovel' },
      workedCommission: Percentage.fromString('32.5'),
      netPremium: Money.fromString('1200.00'),
    },
    occurredAt: OCCURRED_AT,
    ...overrides,
  };
}

describe('Notification', () => {
  it('records the five fields REQ-100 requires, plus who and when (REQ-105)', () => {
    const notification = Notification.issue(data());

    expect(notification.event).toBe('POLICY_ISSUED');
    expect(notification.recipientId).toBe('broker-1');
    expect(notification.occurredAt).toBe(OCCURRED_AT);
    expect(notification.content.client.name).toBe('Maria Souza');
    expect(notification.content.broker.name).toBe('Corretora Alfa');
    expect(notification.content.product.name).toBe('Automovel');
    expect(notification.content.workedCommission?.toString()).toBe('32.5');
    expect(notification.content.netPremium.toString()).toBe('1200.00');
  });

  it('refuses a notification with no recipient (REQ-105)', () => {
    try {
      Notification.issue(data({ recipientId: '   ' }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BusinessRuleViolation).rule).toBe('REQ-105');
    }
  });

  it('stores the recipient trimmed, the way every reference is matched', () => {
    expect(Notification.issue(data({ recipientId: '  broker-1  ' })).recipientId).toBe('broker-1');
  });

  it('is produced for a reference nobody registered (IN-01, REQ-002)', () => {
    // The registry gives a name; it does not authorise a business. A client
    // with no record is a notification carrying the identifier, not a refusal.
    const notification = Notification.issue(
      data({
        content: {
          client: { id: 'client-9', name: null },
          broker: { id: 'broker-1', name: null },
          product: { id: 'auto', name: null },
          workedCommission: Percentage.fromString('40'),
          netPremium: Money.fromString('100.00'),
        },
      }),
    );

    expect(notification.content.client).toEqual({ id: 'client-9', name: null });
  });

  it('rebuilds a stored record without re-applying the rules (REQ-124)', () => {
    const stored = Notification.restore({
      ...data({ recipientId: ' broker-1 ' }),
      event: 'POLICY_ISSUED',
    });

    expect(stored.recipientId).toBe(' broker-1 ');
  });
});
