import { describe, expect, it } from 'vitest';
import { InMemoryPaymentMethodReleaseRuleRepository } from '../../../infrastructure/persistence/in-memory/in-memory-payment-method-release-rule-repository.ts';
import {
  PaymentMethodReleaseRule,
  type ReleaseRule,
} from '../domain/payment-method-release-rule.ts';
import { ListPaymentMethodReleaseRules } from './list-payment-method-release-rules.ts';

function rule(
  paymentMethodId: string,
  release: ReleaseRule,
  registeredAt = '2026-09-18T12:00:00.000Z',
) {
  return PaymentMethodReleaseRule.register({
    paymentMethodId,
    release,
    registeredAt: new Date(registeredAt),
  });
}

describe('ListPaymentMethodReleaseRules', () => {
  it('answers every rule configured, by payment method (IN-06, REQ-090)', async () => {
    const releaseRules = new InMemoryPaymentMethodReleaseRuleRepository();
    // The two values of REQ-091 as the business registers them: the names are
    // data, and nothing in the system knows what "credit" means.
    await releaseRules.save(rule('credit', 'IMMEDIATE'));
    await releaseRules.save(rule('bank-slip', 'REQUIRES_RECEIPT_CONFIRMATION'));

    const listed = await new ListPaymentMethodReleaseRules({ releaseRules }).execute();

    expect(listed.map((line) => line.paymentMethodId)).toEqual(['bank-slip', 'credit']);
    expect(listed.map((line) => line.release)).toEqual([
      'REQUIRES_RECEIPT_CONFIRMATION',
      'IMMEDIATE',
    ]);
  });

  it('leaves out a payment method nobody configured (DEC-002)', async () => {
    const releaseRules = new InMemoryPaymentMethodReleaseRuleRepository();
    await releaseRules.save(rule('credit', 'IMMEDIATE'));

    const listed = await new ListPaymentMethodReleaseRules({ releaseRules }).execute();

    // Pix has no rule because DEC-002 has not decided it. The listing says so
    // by absence; it does not invent a default to have something to show.
    expect(listed.map((line) => line.paymentMethodId)).not.toContain('pix');
  });

  it('shows the current rule of a method registered twice, only once (CA-024)', async () => {
    const releaseRules = new InMemoryPaymentMethodReleaseRuleRepository();
    await releaseRules.save(rule('bank-slip', 'IMMEDIATE', '2026-09-18T12:00:00.000Z'));
    await releaseRules.save(
      rule('bank-slip', 'REQUIRES_RECEIPT_CONFIRMATION', '2026-09-19T12:00:00.000Z'),
    );

    const listed = await new ListPaymentMethodReleaseRules({ releaseRules }).execute();

    expect(listed).toHaveLength(1);
    expect(listed[0]?.release).toBe('REQUIRES_RECEIPT_CONFIRMATION');
    expect(listed[0]?.registeredAt).toBe('2026-09-19T12:00:00.000Z');
  });

  it('answers an empty configuration rather than failing', async () => {
    const useCase = new ListPaymentMethodReleaseRules({
      releaseRules: new InMemoryPaymentMethodReleaseRuleRepository(),
    });

    await expect(useCase.execute()).resolves.toEqual([]);
  });
});
