import { describe, expect, it } from 'vitest';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import type { ReleaseRule } from './payment-method-release-rule.ts';
import { Settlement } from './settlement.ts';

const OPENED_AT = new Date('2026-10-02T10:00:00.000Z');
const LATER = new Date('2026-10-09T10:00:00.000Z');

function open(releaseRule: ReleaseRule, firstInstallmentPaid: boolean): Settlement {
  return Settlement.open(
    {
      id: 'settlement-1',
      policyId: 'policy-1',
      brokerId: 'broker-1',
      amount: Money.fromString('20.00'),
      releaseRule,
      openedAt: OPENED_AT,
    },
    firstInstallmentPaid,
  );
}

const PAYMENT = {
  paidAt: LATER,
  amount: Money.fromString('20.00'),
  proofReference: 'comprovante-001',
  userId: 'user-1',
};

describe('Settlement', () => {
  describe('open', () => {
    it('releases at once for a payment method with immediate release (REQ-091, CA-022)', () => {
      const settlement = open('IMMEDIATE', false);

      expect(settlement.status).toBe('RELEASED');
      expect(settlement.releasedAt).toBe(OPENED_AT);
    });

    it('holds a method that requires confirmation (REQ-091, CA-023, EX-07)', () => {
      const settlement = open('REQUIRES_RECEIPT_CONFIRMATION', false);

      expect(settlement.status).toBe('AWAITING_CONFIRMATION');
      expect(settlement.releasedAt).toBeNull();
    });

    it('releases when the first installment was already confirmed (REQ-091)', () => {
      const settlement = open('REQUIRES_RECEIPT_CONFIRMATION', true);

      expect(settlement.status).toBe('RELEASED');
    });

    it('carries the rule it was opened under, so a later edit does not rewrite it (REQ-090)', () => {
      expect(open('REQUIRES_RECEIPT_CONFIRMATION', false).releaseRule).toBe(
        'REQUIRES_RECEIPT_CONFIRMATION',
      );
    });
  });

  describe('release', () => {
    it('releases once the first installment is confirmed paid (FP-03 step 3, REQ-092)', () => {
      const released = open('REQUIRES_RECEIPT_CONFIRMATION', false).release(true, LATER);

      expect(released.status).toBe('RELEASED');
      expect(released.releasedAt).toBe(LATER);
    });

    it('refuses to release without the confirmation registered (REJ-009, EX-07)', () => {
      expect(() => open('REQUIRES_RECEIPT_CONFIRMATION', false).release(false, LATER)).toThrow(
        BusinessRuleViolation,
      );
    });

    it('only applies to a transfer that is waiting (section 10.6)', () => {
      expect(() => open('IMMEDIATE', false).release(true, LATER)).toThrow(BusinessRuleViolation);
    });
  });

  describe('registerPayment', () => {
    it('records date, amount, proof and user (REQ-095, CA-028, REQ-123)', () => {
      const paid = open('IMMEDIATE', false).registerPayment(PAYMENT);

      expect(paid.status).toBe('PAID');
      expect(paid.payment?.paidAt).toBe(LATER);
      expect(paid.payment?.amount.toString()).toBe('20.00');
      expect(paid.payment?.proofReference).toBe('comprovante-001');
      expect(paid.payment?.userId).toBe('user-1');
    });

    it('keeps the paid amount even when it differs from the expected one (REQ-002, REQ-075)', () => {
      const paid = open('IMMEDIATE', false).registerPayment({
        ...PAYMENT,
        amount: Money.fromString('19.50'),
      });

      expect(paid.amount.toString()).toBe('20.00');
      expect(paid.payment?.amount.toString()).toBe('19.50');
    });

    it('refuses to pay a transfer still awaiting confirmation (REJ-009, section 10.6)', () => {
      expect(() => open('REQUIRES_RECEIPT_CONFIRMATION', false).registerPayment(PAYMENT)).toThrow(
        BusinessRuleViolation,
      );
    });

    it('requires the attached proof (REQ-095)', () => {
      expect(() =>
        open('IMMEDIATE', false).registerPayment({ ...PAYMENT, proofReference: '  ' }),
      ).toThrow(BusinessRuleViolation);
    });

    it('requires the user who registered it (REQ-123)', () => {
      expect(() => open('IMMEDIATE', false).registerPayment({ ...PAYMENT, userId: '' })).toThrow(
        BusinessRuleViolation,
      );
    });
  });
});
