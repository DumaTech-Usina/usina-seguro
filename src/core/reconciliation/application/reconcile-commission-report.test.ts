import { describe, expect, it } from 'vitest';
import { ImmediateTransaction } from '../../../infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryCommissionRepository } from '../../../infrastructure/persistence/in-memory/in-memory-commission-repository.ts';
import { InMemoryPolicyRepository } from '../../../infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { InMemoryReconciliationPendencyRepository } from '../../../infrastructure/persistence/in-memory/in-memory-reconciliation-pendency-repository.ts';
import type { CommissionBasis } from '../../commission/domain/commission-basis.ts';
import { Commission } from '../../commission/domain/commission.ts';
import { CalendarDate } from '../../policy/domain/calendar-date.ts';
import { Installment } from '../../policy/domain/installment.ts';
import { Policy } from '../../policy/domain/policy.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal } from '../../proposal/domain/proposal.ts';
import { ReconcileCommissionReport } from './reconcile-commission-report.ts';

const NOW = new Date('2026-10-02T10:00:00.000Z');

const BASIS: CommissionBasis = {
  premium: Money.fromString('100.00'),
  insurerRate: Percentage.fromString('40'),
  insurerAmount: Money.fromString('40.00'),
  intermediaryId: null,
  intermediaryRate: null,
  brokerBase: 'USINA',
  brokerBaseAmount: Money.fromString('40.00'),
  brokerRate: Percentage.fromString('50'),
};

function scenario() {
  const proposals = new InMemoryProposalRepository();
  const policies = new InMemoryPolicyRepository();
  const commissions = new InMemoryCommissionRepository();
  const pendencies = new InMemoryReconciliationPendencyRepository();
  let sequence = 0;

  const useCase = new ReconcileCommissionReport({
    proposals,
    policies,
    commissions,
    pendencies,
    transaction: new ImmediateTransaction(),
    newId: () => `pendency-${++sequence}`,
    now: () => NOW,
  });

  return { proposals, policies, commissions, pendencies, useCase };
}

/** A policy 'APL-1' from proposal 'PRP-1', with an agreed commission of 40.00. */
async function registeredPolicy(
  proposals: InMemoryProposalRepository,
  policies: InMemoryPolicyRepository,
  commissions: InMemoryCommissionRepository,
): Promise<void> {
  await proposals.save(
    Proposal.register({
      id: 'proposal-1',
      clientId: 'client-1',
      brokerId: 'broker-1',
      insurerId: 'insurer-1',
      productId: 'auto',
      paymentMethodId: 'credit',
      customerAccepted: true,
      netPremium: Money.fromString('100.00'),
      registeredAt: new Date('2026-09-17T12:00:00.000Z'),
    })
      .transmit({
        proposalNumber: 'PRP-1',
        workedCommission: Percentage.fromString('40'),
        transmittedAt: new Date('2026-09-18T12:00:00.000Z'),
      })
      .accept(),
  );

  await policies.save(
    Policy.register({
      id: 'policy-1',
      proposalId: 'proposal-1',
      policyNumber: 'APL-1',
      premium: Money.fromString('100.00'),
      coverageStart: CalendarDate.fromString('2026-10-01'),
      coverageEnd: CalendarDate.fromString('2027-09-30'),
      renewalDate: CalendarDate.fromString('2027-09-30'),
      registeredAt: new Date('2026-09-20T10:00:00.000Z'),
      installments: [
        Installment.create({
          id: 'installment-1',
          policyId: 'policy-1',
          number: 1,
          amount: Money.fromString('100.00'),
          dueDate: CalendarDate.fromString('2026-10-10'),
        }),
      ],
    }),
  );

  await commissions.save(
    Commission.forecast({
      id: 'commission-1',
      policyId: 'policy-1',
      basis: BASIS,
      agreedReceivable: Money.fromString('40.00'),
      agreedPayable: Money.fromString('20.00'),
      calculatedAt: new Date('2026-09-20T10:00:00.000Z'),
    }),
  );
}

describe('ReconcileCommissionReport', () => {
  it('matches a line by the policy number (REQ-082, CA-018)', async () => {
    const { proposals, policies, commissions, useCase } = scenario();
    await registeredPolicy(proposals, policies, commissions);

    const output = await useCase.execute({
      competence: '2026-10',
      lines: [{ policyNumber: 'APL-1', proposalNumber: 'PRP-1', producerCommission: '40.00' }],
    });

    expect(output.lines[0]?.outcome).toBe('RECONCILED');
    expect(output.reconciled).toBe(1);

    const commission = await commissions.findByPolicyId('policy-1');
    expect(commission?.status).toBe('RECONCILED');
    expect(commission?.realReceivable?.toString()).toBe('40.00');
  });

  it('matches a line that brings only the proposal number (REQ-082, CA-019)', async () => {
    const { proposals, policies, commissions, useCase } = scenario();
    await registeredPolicy(proposals, policies, commissions);

    const output = await useCase.execute({
      competence: '2026-10',
      lines: [{ proposalNumber: 'PRP-1', producerCommission: '40.00' }],
    });

    expect(output.lines[0]?.outcome).toBe('RECONCILED');
    expect(output.lines[0]?.policyId).toBe('policy-1');
    // The answer names the policy the line reached through REQ-050.
    expect(output.lines[0]?.policyNumber).toBe('APL-1');
  });

  it('signals a divergence without blocking the import (REQ-076, REQ-077, EX-02)', async () => {
    const { proposals, policies, commissions, useCase } = scenario();
    await registeredPolicy(proposals, policies, commissions);

    const output = await useCase.execute({
      competence: '2026-10',
      lines: [{ policyNumber: 'APL-1', proposalNumber: 'PRP-1', producerCommission: '35.00' }],
    });

    expect(output.lines[0]?.outcome).toBe('DIVERGENT');
    expect(output.divergent).toBe(1);

    const commission = await commissions.findByPolicyId('policy-1');
    expect(commission?.status).toBe('DIVERGENT');
    expect(commission?.realReceivable?.toString()).toBe('35.00');
  });

  it('opens a pendency for a line with no matching policy (REQ-083, CA-020, EX-01)', async () => {
    const { proposals, policies, commissions, pendencies, useCase } = scenario();
    await registeredPolicy(proposals, policies, commissions);

    const output = await useCase.execute({
      competence: '2026-10',
      lines: [{ policyNumber: 'APL-999', proposalNumber: 'PRP-999', producerCommission: '12.34' }],
    });

    expect(output.lines[0]?.outcome).toBe('PENDING');
    expect(output.pending).toBe(1);

    const open = await pendencies.listOpen();
    expect(open).toHaveLength(1);
    expect(open[0]?.proposalNumber).toBe('PRP-999');
    expect(open[0]?.reportedCommission.toString()).toBe('12.34');
  });

  it('generates no commission entry for an unmatched line (REQ-083, REJ-013)', async () => {
    const { proposals, policies, commissions, useCase } = scenario();
    await registeredPolicy(proposals, policies, commissions);

    await useCase.execute({
      competence: '2026-10',
      lines: [{ proposalNumber: 'PRP-999', producerCommission: '12.34' }],
    });

    const commission = await commissions.findByPolicyId('policy-1');
    expect(commission?.status).toBe('FORECAST');
    expect(commission?.realReceivable).toBeNull();
  });

  it('does not duplicate entries when the same report is imported again (REQ-086, CA-021, REJ-012, EX-05)', async () => {
    const { proposals, policies, commissions, useCase } = scenario();
    await registeredPolicy(proposals, policies, commissions);

    const report = {
      competence: '2026-10',
      lines: [{ policyNumber: 'APL-1', proposalNumber: 'PRP-1', producerCommission: '40.00' }],
    };

    await useCase.execute(report);
    const second = await useCase.execute(report);

    expect(second.lines[0]?.outcome).toBe('DUPLICATE');
    expect(second.duplicated).toBe(1);
    expect(second.reconciled).toBe(0);
  });

  it('carries on past a divergent line to the rest of the report (REQ-077)', async () => {
    const { proposals, policies, commissions, pendencies, useCase } = scenario();
    await registeredPolicy(proposals, policies, commissions);

    const output = await useCase.execute({
      competence: '2026-10',
      lines: [
        { policyNumber: 'APL-1', proposalNumber: 'PRP-1', producerCommission: '35.00' },
        { proposalNumber: 'PRP-999', producerCommission: '9.99' },
      ],
    });

    expect(output.divergent).toBe(1);
    expect(output.pending).toBe(1);
    expect(await pendencies.listOpen()).toHaveLength(1);
  });

  it('reports a matched policy that has no commission to compare against', async () => {
    const { proposals, policies, commissions, useCase } = scenario();
    await registeredPolicy(proposals, policies, commissions);
    const withoutCommission = new InMemoryCommissionRepository();

    const useCaseWithoutCommission = new ReconcileCommissionReport({
      proposals,
      policies,
      commissions: withoutCommission,
      pendencies: new InMemoryReconciliationPendencyRepository(),
      transaction: new ImmediateTransaction(),
      newId: () => 'pendency-1',
      now: () => NOW,
    });

    const output = await useCaseWithoutCommission.execute({
      competence: '2026-10',
      lines: [{ policyNumber: 'APL-1', proposalNumber: 'PRP-1', producerCommission: '40.00' }],
    });

    expect(output.lines[0]?.outcome).toBe('NO_COMMISSION');
  });

  it('requires a competence (REQ-086)', async () => {
    const { useCase } = scenario();

    await expect(
      useCase.execute({
        competence: '   ',
        lines: [{ proposalNumber: 'PRP-1', producerCommission: '40.00' }],
      }),
    ).rejects.toThrow(BusinessRuleViolation);
  });

  it('requires at least one line (REQ-080)', async () => {
    const { useCase } = scenario();

    await expect(useCase.execute({ competence: '2026-10', lines: [] })).rejects.toThrow(
      BusinessRuleViolation,
    );
  });
});
