import { describe, expect, it } from 'vitest';
import { Authorship } from './authorship.ts';
import { CalendarDate } from './calendar-date.ts';
import { BusinessRuleViolation } from './errors.ts';
import { Money } from './money.ts';
import { Percentage } from './percentage.ts';
import { Proposal, type ProposalRegistration } from './proposal.ts';
import type { Receipt } from './receipt.ts';

const REGISTERED_AT = new Date('2026-09-22T12:00:00.000Z');
const REVISED_AT = new Date('2026-09-23T09:30:00.000Z');

const THROUGH_INTERMEDIARY: Receipt = {
  kind: 'INTERMEDIARY',
  intermediaryId: 'intermediary-1',
  ctu: Percentage.fromString('50'),
};

function registration(overrides: Partial<ProposalRegistration> = {}): ProposalRegistration {
  return {
    id: 'proposal-1',
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'product-1',
    paymentMethodId: 'bank-slip',
    proposalNumber: 'PRP-9001',
    netPremium: Money.fromString('100.00'),
    coverageStart: CalendarDate.fromString('2026-10-01'),
    coverageEnd: CalendarDate.fromString('2027-10-01'),
    installments: [
      { amount: Money.fromString('50.00'), dueDate: CalendarDate.fromString('2026-10-10') },
      { amount: Money.fromString('50.00'), dueDate: null },
    ],
    workedCommission: Percentage.fromString('20'),
    workedCommissionMode: 'INTEGRAL',
    receipt: { kind: 'DIRECT' },
    registeredBy: 'ana.souza',
    registeredAt: REGISTERED_AT,
    ...overrides,
  };
}

function registered(overrides: Partial<ProposalRegistration> = {}): Proposal {
  return Proposal.register(registration(overrides));
}

function ruleOf(work: () => unknown): string {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(BusinessRuleViolation);
    return (error as BusinessRuleViolation).rule;
  }
  throw new Error('should have thrown');
}

describe('Proposal.register', () => {
  it('registers the proposal as AWAITING_ISSUANCE (REQ-250, FP-01 step 6)', () => {
    expect(registered().status).toBe('AWAITING_ISSUANCE');
  });

  it('keeps every standardized datum informed at registration (REQ-202, REQ-206)', () => {
    const proposal = registered();

    expect(proposal.proposalNumber).toBe('PRP-9001');
    expect(proposal.netPremium.toString()).toBe('100.00');
    expect(proposal.coverageStart.toString()).toBe('2026-10-01');
    expect(proposal.coverageEnd.toString()).toBe('2027-10-01');
    expect(proposal.workedCommission.toString()).toBe('20');
    expect(proposal.workedCommissionMode).toBe('INTEGRAL');
  });

  it('keeps the proposal number without the blanks around it', () => {
    expect(registered({ proposalNumber: '  PRP-9001 ' }).proposalNumber).toBe('PRP-9001');
  });

  it('has the renewal date equal to the end of coverage, never informed apart (REQ-203, CA-206)', () => {
    expect(registered().renewalDate.toString()).toBe('2027-10-01');
  });

  it('keeps the installments in order, with the due date optional (REQ-204, CA-208, FA-205)', () => {
    const [first, second] = registered().installments;

    expect(first?.amount.toString()).toBe('50.00');
    expect(first?.dueDate?.toString()).toBe('2026-10-10');
    expect(second?.dueDate).toBeNull();
  });

  it('accepts a proposal with no installments (REQ-202, CA-216)', () => {
    expect(registered({ installments: [] }).installments).toEqual([]);
  });

  it('records who informed the CT and when (REQ-215, CA-204)', () => {
    const [entry] = registered().workedCommissionHistory;

    expect(entry?.informed.author).toBe('ana.souza');
    expect(entry?.informed.at).toEqual(REGISTERED_AT);
  });

  it('records who declared the receipt and when (REQ-223)', () => {
    const [declaration] = registered({ receipt: THROUGH_INTERMEDIARY }).receiptHistory;

    expect(declaration?.receipt).toEqual(THROUGH_INTERMEDIARY);
    expect(declaration?.declared.author).toBe('ana.souza');
    expect(declaration?.declared.at).toEqual(REGISTERED_AT);
  });

  it('rejects registration without a payment method (REQ-040, REQ-201)', () => {
    expect(ruleOf(() => registered({ paymentMethodId: '  ' }))).toBe('REQ-040');
  });

  it.each(['clientId', 'brokerId', 'insurerId', 'productId'] as const)(
    'rejects registration without %s (REQ-201)',
    (field) => {
      try {
        registered({ [field]: ' ' });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect((error as BusinessRuleViolation).rule).toBe('REQ-201');
        expect((error as BusinessRuleViolation).params).toEqual({ field });
      }
    },
  );

  it('rejects registration without the proposal number (REQ-202, REQ-206, CA-216)', () => {
    expect(ruleOf(() => registered({ proposalNumber: '   ' }))).toBe('REQ-202');
  });

  it.each(['0.00', '-50.00'])('rejects a net premium of %s (REQ-217, CA-218)', (premium) => {
    expect(ruleOf(() => registered({ netPremium: Money.fromString(premium) }))).toBe('REQ-217');
  });

  it.each([
    ['ends before it starts', '2027-10-01', '2026-10-01'],
    ['ends the day it starts', '2026-10-01', '2026-10-01'],
  ])('rejects a coverage that %s (REQ-202, REJ-214)', (_case, start, end) => {
    expect(
      ruleOf(() =>
        registered({
          coverageStart: CalendarDate.fromString(start),
          coverageEnd: CalendarDate.fromString(end),
        }),
      ),
    ).toBe('REQ-202');
  });

  it.each(['0.00', '-10.00'])('rejects an installment of %s (REQ-204, REJ-215)', (amount) => {
    expect(
      ruleOf(() =>
        registered({
          installments: [
            { amount: Money.fromString('100.00'), dueDate: null },
            { amount: Money.fromString(amount), dueDate: null },
          ],
        }),
      ),
    ).toBe('REQ-204');
  });

  it('rejects registration without a signature (REQ-216, REJ-206)', () => {
    expect(ruleOf(() => registered({ registeredBy: ' ' }))).toBe('REQ-216');
  });

  it('restores a persisted record without re-applying the creation rules (REQ-124)', () => {
    const informed = Authorship.of('ana.souza', REGISTERED_AT);
    const proposal = Proposal.restore(registration({ paymentMethodId: ' ' }), {
      status: 'REJECTED',
      workedCommissionHistory: [{ rate: Percentage.fromString('20'), mode: 'INTEGRAL', informed }],
      installmentHistory: [{ installments: [], informed }],
      receiptHistory: [{ receipt: { kind: 'DIRECT' }, declared: informed }],
      rejectionReason: 'perfil de risco',
    });

    expect(proposal.status).toBe('REJECTED');
    expect(proposal.rejectionReason).toBe('perfil de risco');
  });
});

describe('Proposal.expectedReceipt', () => {
  it('shows what the Usina expects before issuance (REQ-232, CA-201, CA-203)', () => {
    const expected = registered().expectedReceipt();

    expect(expected.intermediary).toBeNull();
    expect(expected.usina.toString()).toBe('20.00');
  });

  it('chains CT and CTU when there is an intermediary (REQ-231, CA-202)', () => {
    const expected = registered({ receipt: THROUGH_INTERMEDIARY }).expectedReceipt();

    expect(expected.intermediary?.toString()).toBe('20.00');
    expect(expected.usina.toString()).toBe('10.00');
  });
});

describe('Proposal.reviseWorkedCommission', () => {
  it('corrects the CT and its mode while awaiting issuance (REQ-214, FA-203, CA-217)', () => {
    const revised = registered().reviseWorkedCommission({
      rate: Percentage.fromString('25'),
      mode: 'PARCELLED',
      subsequentRate: Percentage.fromString('10'),
      informed: Authorship.of('bruno.lima', REVISED_AT),
    });

    expect(revised.workedCommission.toString()).toBe('25');
    expect(revised.subsequentWorkedCommission?.toString()).toBe('10');
    expect(revised.workedCommissionMode).toBe('PARCELLED');
    expect(revised.expectedInstallmentReceipts()?.map((r) => r.usina.toString())).toEqual([
      '12.50',
      '5.00',
    ]);
  });

  it('keeps every earlier entry with its author: nothing is erased (REQ-215, REQ-124, CA-204)', () => {
    const history = registered().reviseWorkedCommission({
      rate: Percentage.fromString('25'),
      mode: 'INTEGRAL',
      informed: Authorship.of('bruno.lima', REVISED_AT),
    }).workedCommissionHistory;

    expect(history.map((entry) => entry.rate.toString())).toEqual(['20', '25']);
    expect(history.map((entry) => entry.informed.author)).toEqual(['ana.souza', 'bruno.lima']);
    expect(history[1]?.informed.at).toEqual(REVISED_AT);
  });

  it('leaves the original instance untouched', () => {
    const original = registered();

    original.reviseWorkedCommission({
      rate: Percentage.fromString('25'),
      mode: 'INTEGRAL',
      informed: Authorship.of('bruno.lima', REVISED_AT),
    });

    expect(original.workedCommission.toString()).toBe('20');
  });
});

describe('Proposal.reviseReceipt', () => {
  it('declares an intermediary before issuance (REQ-225, FA-204)', () => {
    const revised = registered().reviseReceipt({
      receipt: THROUGH_INTERMEDIARY,
      declared: Authorship.of('bruno.lima', REVISED_AT),
    });

    expect(revised.receipt).toEqual(THROUGH_INTERMEDIARY);
    expect(revised.expectedReceipt().usina.toString()).toBe('10.00');
  });

  it('removing the intermediary brings the expected value back to premium x CT (FA-209, CA-214)', () => {
    const revised = registered({ receipt: THROUGH_INTERMEDIARY }).reviseReceipt({
      receipt: { kind: 'DIRECT' },
      declared: Authorship.of('bruno.lima', REVISED_AT),
    });

    expect(revised.expectedReceipt().intermediary).toBeNull();
    expect(revised.expectedReceipt().usina.toString()).toBe('20.00');
  });

  it('keeps every earlier declaration with its author (REQ-223, REQ-124)', () => {
    const history = registered().reviseReceipt({
      receipt: THROUGH_INTERMEDIARY,
      declared: Authorship.of('bruno.lima', REVISED_AT),
    }).receiptHistory;

    expect(history.map((declaration) => declaration.receipt.kind)).toEqual([
      'DIRECT',
      'INTERMEDIARY',
    ]);
    expect(history.map((declaration) => declaration.declared.author)).toEqual([
      'ana.souza',
      'bruno.lima',
    ]);
  });
});

describe('Proposal.reject', () => {
  it('records the refusal with its reason and keeps the record (REQ-253, FA-208, CA-212)', () => {
    const rejected = registered().reject('  perfil de risco recusado ');

    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('perfil de risco recusado');
    expect(rejected.proposalNumber).toBe('PRP-9001');
  });

  it('rejects a refusal without a reason (REJ-208, EX-203)', () => {
    expect(ruleOf(() => registered().reject('   '))).toBe('REQ-253');
  });

  it('is final: nothing about a refused proposal changes (REQ-253, REJ-212)', () => {
    const rejected = registered().reject('motivo');
    const informed = Authorship.of('bruno.lima', REVISED_AT);

    expect(ruleOf(() => rejected.reject('outro motivo'))).toBe('REQ-253');
    expect(
      ruleOf(() =>
        rejected.reviseWorkedCommission({
          rate: Percentage.fromString('25'),
          mode: 'INTEGRAL',
          informed,
        }),
      ),
    ).toBe('REQ-253');
    expect(
      ruleOf(() => rejected.reviseReceipt({ receipt: { kind: 'DIRECT' }, declared: informed })),
    ).toBe('REQ-253');
  });
});

describe('Proposal.recognizeIssuance', () => {
  const RECOGNIZED_AT = new Date('2026-09-25T14:05:00.000Z');

  function recognized(): Authorship {
    return Authorship.of('carla.dias', RECOGNIZED_AT);
  }

  it('moves a proposal awaiting issuance to ISSUED (REQ-250, REQ-251, FP-01 step 8)', () => {
    expect(registered().recognizeIssuance(recognized()).status).toBe('ISSUED');
  });

  it('records who identified the issuance and when (REQ-209, CA-207)', () => {
    const issued = registered().recognizeIssuance(recognized());

    expect(issued.issuanceRecognition?.author).toBe('carla.dias');
    expect(issued.issuanceRecognition?.at).toEqual(RECOGNIZED_AT);
  });

  it('has no recognition while awaiting issuance or once refused', () => {
    expect(registered().issuanceRecognition).toBeNull();
    expect(registered().reject('motivo').issuanceRecognition).toBeNull();
  });

  it('does not let a refused proposal originate a policy (REJ-210)', () => {
    expect(ruleOf(() => registered().reject('motivo').recognizeIssuance(recognized()))).toBe(
      'REQ-253',
    );
  });

  it('does not let a proposal originate a second policy (REQ-049)', () => {
    expect(
      ruleOf(() => registered().recognizeIssuance(recognized()).recognizeIssuance(recognized())),
    ).toBe('REQ-049');
  });

  it('freezes the proposal once issued (REQ-244, REQ-260, REJ-201, EX-201)', () => {
    const issued = registered().recognizeIssuance(recognized());
    const informed = Authorship.of('bruno.lima', REVISED_AT);

    expect(
      ruleOf(() =>
        issued.reviseWorkedCommission({
          rate: Percentage.fromString('25'),
          mode: 'INTEGRAL',
          informed,
        }),
      ),
    ).toBe('REQ-260');
    expect(
      ruleOf(() => issued.reviseReceipt({ receipt: { kind: 'DIRECT' }, declared: informed })),
    ).toBe('REQ-260');
    expect(ruleOf(() => issued.reject('motivo'))).toBe('REQ-260');
  });
});

/* ------------------------------------------------------------------ */
/* CT parcelada — V2 section 6A                                        */
/* ------------------------------------------------------------------ */

const ONE_HUNDRED_EACH = [
  { amount: Money.fromString('100.00'), dueDate: null },
  { amount: Money.fromString('100.00'), dueDate: null },
  { amount: Money.fromString('100.00'), dueDate: null },
];

function parcelled(overrides: Partial<ProposalRegistration> = {}): Proposal {
  return registered({
    workedCommissionMode: 'PARCELLED',
    workedCommission: Percentage.fromString('100'),
    subsequentWorkedCommission: Percentage.fromString('30'),
    installments: ONE_HUNDRED_EACH,
    ...overrides,
  });
}

function messageOf(work: () => unknown): string {
  try {
    work();
  } catch (error) {
    return (error as BusinessRuleViolation).messageKey;
  }
  throw new Error('should have thrown');
}

describe('Proposal.register with parcelled CT', () => {
  it('keeps the CT of the first and the CT of the subsequent installments (REQ-291, CA-245)', () => {
    const proposal = parcelled();

    expect(proposal.workedCommissionMode).toBe('PARCELLED');
    expect(proposal.workedCommission.toString()).toBe('100');
    expect(proposal.subsequentWorkedCommission?.toString()).toBe('30');
  });

  it('signs both CTs in the same history entry (REQ-215, REQ-297)', () => {
    const [entry] = parcelled().workedCommissionHistory;

    expect(entry?.rate.toString()).toBe('100');
    expect(entry?.subsequentRate?.toString()).toBe('30');
    expect(entry?.informed.author).toBe('ana.souza');
  });

  it('has no CT of the subsequent installments with integral CT (REQ-291)', () => {
    expect(registered().subsequentWorkedCommission).toBeNull();
  });

  it('refuses a parcelled CT without the CT of the subsequent installments (REQ-291, EX-209, REJ-233)', () => {
    expect(ruleOf(() => parcelled({ subsequentWorkedCommission: null }))).toBe('REQ-291');
    expect(messageOf(() => parcelled({ subsequentWorkedCommission: null }))).toBe(
      'proposal.parcelled_requires_subsequent_ct',
    );
  });

  it('refuses a second CT with integral CT: one field only (REQ-291)', () => {
    expect(
      messageOf(() => registered({ subsequentWorkedCommission: Percentage.fromString('30') })),
    ).toBe('proposal.integral_has_single_ct');
  });

  it('refuses a parcelled CT with fewer than two installments (REQ-292, CA-268, EX-208)', () => {
    expect(ruleOf(() => parcelled({ installments: [] }))).toBe('REQ-292');
    expect(
      messageOf(() =>
        parcelled({ installments: [{ amount: Money.fromString('100.00'), dueDate: null }] }),
      ),
    ).toBe('proposal.parcelled_requires_two_installments');
    expect(parcelled({ installments: ONE_HUNDRED_EACH.slice(0, 2) }).installments).toHaveLength(2);
  });

  it('refuses a parcelled CT received through an intermediary (REQ-296, REJ-230)', () => {
    expect(ruleOf(() => parcelled({ receipt: THROUGH_INTERMEDIARY }))).toBe('REQ-296');
    expect(messageOf(() => parcelled({ receipt: THROUGH_INTERMEDIARY }))).toBe(
      'proposal.parcelled_cannot_have_intermediary',
    );
  });

  it('accepts CTs above 100% on a parcelled proposal (REQ-295, CA-249)', () => {
    const proposal = parcelled({
      workedCommission: Percentage.fromStringWithoutCeiling('150'),
      subsequentWorkedCommission: Percentage.fromStringWithoutCeiling('120'),
    });

    expect(proposal.workedCommission.toString()).toBe('150');
  });

  it('keeps the integral CT within 100%, as before (REQ-290, CA-251)', () => {
    expect(
      messageOf(() => registered({ workedCommission: Percentage.fromStringWithoutCeiling('101') })),
    ).toBe('percentage.out_of_range');
  });
});

describe('Proposal expected value with parcelled CT', () => {
  it('is one value per installment, the first with its own CT (REQ-293, CA-246)', () => {
    const receipts = parcelled().expectedInstallmentReceipts();

    expect(receipts?.map((receipt) => [receipt.number, receipt.usina.toString()])).toEqual([
      [1, '100.00'],
      [2, '30.00'],
      [3, '30.00'],
    ]);
  });

  it('has no total expected value: nothing is accumulated (REQ-293, REJ-232)', () => {
    expect(() => parcelled().expectedReceipt()).toThrow();
  });

  it('has no value per installment with integral CT (REQ-235)', () => {
    expect(registered().expectedInstallmentReceipts()).toBeNull();
  });
});

describe('Proposal.reviseWorkedCommission and the mode (REQ-297, REQ-299)', () => {
  const informed = () => Authorship.of('bruno.lima', REVISED_AT);

  it('corrects both CTs of a parcelled proposal before issuance (REQ-297)', () => {
    const revised = parcelled().reviseWorkedCommission({
      rate: Percentage.fromString('90'),
      mode: 'PARCELLED',
      subsequentRate: Percentage.fromString('25'),
      informed: informed(),
    });

    expect(revised.workedCommission.toString()).toBe('90');
    expect(revised.subsequentWorkedCommission?.toString()).toBe('25');
    expect(revised.workedCommissionHistory).toHaveLength(2);
  });

  it('switches integral to parcelled when the receipt is direct and there are two installments (FA-219, CA-252)', () => {
    const revised = registered().reviseWorkedCommission({
      rate: Percentage.fromString('100'),
      mode: 'PARCELLED',
      subsequentRate: Percentage.fromString('30'),
      informed: informed(),
    });

    expect(revised.workedCommissionMode).toBe('PARCELLED');
  });

  it('refuses the switch to parcelled while an intermediary is declared (REQ-299, REQ-296, EX-210)', () => {
    expect(
      messageOf(() =>
        registered({ receipt: THROUGH_INTERMEDIARY }).reviseWorkedCommission({
          rate: Percentage.fromString('100'),
          mode: 'PARCELLED',
          subsequentRate: Percentage.fromString('30'),
          informed: informed(),
        }),
      ),
    ).toBe('proposal.parcelled_cannot_have_intermediary');
  });

  it('refuses the switch to parcelled with fewer than two installments (REQ-299, REQ-292, REJ-235)', () => {
    expect(
      messageOf(() =>
        registered({ installments: [] }).reviseWorkedCommission({
          rate: Percentage.fromString('100'),
          mode: 'PARCELLED',
          subsequentRate: Percentage.fromString('30'),
          informed: informed(),
        }),
      ),
    ).toBe('proposal.parcelled_requires_two_installments');
  });

  it('switches parcelled to integral with one CT on the net premium (FA-220, CA-253)', () => {
    const revised = parcelled().reviseWorkedCommission({
      rate: Percentage.fromString('20'),
      mode: 'INTEGRAL',
      informed: informed(),
    });

    expect(revised.workedCommissionMode).toBe('INTEGRAL');
    expect(revised.subsequentWorkedCommission).toBeNull();
    expect(revised.expectedReceipt().usina.toString()).toBe('20.00');
  });
});

describe('Proposal.reviseReceipt with parcelled CT', () => {
  it('refuses to declare an intermediary on a parcelled proposal (REQ-296, EX-207)', () => {
    expect(
      messageOf(() =>
        parcelled().reviseReceipt({
          receipt: THROUGH_INTERMEDIARY,
          declared: Authorship.of('bruno.lima', REVISED_AT),
        }),
      ),
    ).toBe('proposal.parcelled_cannot_have_intermediary');
  });
});

describe('Proposal.reviseInstallments (REQ-254)', () => {
  const informed = () => Authorship.of('bruno.lima', REVISED_AT);
  const three = [
    { amount: Money.fromString('40.00'), dueDate: null },
    { amount: Money.fromString('30.00'), dueDate: CalendarDate.fromString('2026-11-10') },
    { amount: Money.fromString('30.00'), dueDate: null },
  ];

  it('the installments of the registration are the first entry, signed by who registered (REQ-254)', () => {
    const [entry] = registered().installmentHistory;

    expect(entry?.installments).toHaveLength(2);
    expect(entry?.informed.author).toBe('ana.souza');
    expect(entry?.informed.at).toEqual(REGISTERED_AT);
  });

  it('includes, alters and removes installments of an integral proposal before issuance (FA-224, CA-261)', () => {
    const revised = registered().reviseInstallments({ installments: three, informed: informed() });

    expect(revised.installments.map((installment) => installment.amount.toString())).toEqual([
      '40.00',
      '30.00',
      '30.00',
    ]);
    expect(
      revised.reviseInstallments({ installments: [], informed: informed() }).installments,
    ).toEqual([]);
  });

  it('keeps every earlier list with who changed it and when: nothing is erased (REQ-254, REQ-124)', () => {
    const history = registered().reviseInstallments({
      installments: three,
      informed: informed(),
    }).installmentHistory;

    expect(history.map((entry) => entry.installments.length)).toEqual([2, 3]);
    expect(history.map((entry) => entry.informed.author)).toEqual(['ana.souza', 'bruno.lima']);
    expect(history[1]?.informed.at).toEqual(REVISED_AT);
  });

  it('keeps every installment worth something (REQ-204, REJ-215)', () => {
    expect(
      ruleOf(() =>
        registered().reviseInstallments({
          installments: [{ amount: Money.fromString('0.00'), dueDate: null }],
          informed: informed(),
        }),
      ),
    ).toBe('REQ-204');
  });

  it('refuses a removal that leaves a parcelled proposal with fewer than two (REQ-292, CA-268)', () => {
    expect(
      messageOf(() =>
        parcelled().reviseInstallments({
          installments: [{ amount: Money.fromString('100.00'), dueDate: null }],
          informed: informed(),
        }),
      ),
    ).toBe('proposal.parcelled_requires_two_installments');
  });

  it('recalculates the expected value of each installment of a parcelled proposal (REQ-293)', () => {
    const revised = parcelled().reviseInstallments({ installments: three, informed: informed() });

    expect(revised.expectedInstallmentReceipts()?.map((r) => r.usina.toString())).toEqual([
      '40.00',
      '9.00',
      '9.00',
    ]);
  });

  it('lets an integral proposal without installments gain them and switch to parcelled (REQ-254, REQ-299)', () => {
    const switched = registered({ installments: [] })
      .reviseInstallments({ installments: three, informed: informed() })
      .reviseWorkedCommission({
        rate: Percentage.fromString('100'),
        mode: 'PARCELLED',
        subsequentRate: Percentage.fromString('30'),
        informed: informed(),
      });

    expect(switched.workedCommissionMode).toBe('PARCELLED');
  });

  it('changes nothing once issued or refused (REQ-260, REQ-253)', () => {
    const issued = registered().recognizeIssuance(Authorship.of('carla', REVISED_AT));
    const refused = registered().reject('motivo');

    expect(
      ruleOf(() => issued.reviseInstallments({ installments: three, informed: informed() })),
    ).toBe('REQ-260');
    expect(
      ruleOf(() => refused.reviseInstallments({ installments: three, informed: informed() })),
    ).toBe('REQ-253');
  });
});
