import { describe, expect, it } from 'vitest';
import { ImmediateTransaction } from '../../../infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryDocumentStorage } from '../../../infrastructure/persistence/in-memory/in-memory-document-storage.ts';
import { InMemoryPolicyRepository } from '../../../infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { CalendarDate } from '../../proposal/domain/calendar-date.ts';
import { BusinessRuleViolation, RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal, type ProposalRegistration } from '../../proposal/domain/proposal.ts';
import type {
  AgreedCommissionCalculator,
  AgreedCommissionRequest,
} from './agreed-commission-calculator.ts';
import type { PolicyIssuedEvent, PolicyIssuedNotifier } from './policy-issued-notifier.ts';
import { RegisterPolicy, type RegisterPolicyInput } from './register-policy.ts';
import type { Transaction } from './transaction.ts';

const NOW = new Date('2026-09-20T10:00:00.000Z');

/**
 * Stands in for the commission module (FP-01 step 7). The policy module is
 * tested against the port it declared, not against a real calculation: what
 * the agreed commission is worth is a rule of the other module.
 */
class RecordingCommissionCalculator implements AgreedCommissionCalculator {
  readonly requests: AgreedCommissionRequest[] = [];

  async calculateFor(request: AgreedCommissionRequest): Promise<void> {
    this.requests.push(request);
  }
}

/**
 * Stands in for the notification module (FP-01 step 7, REQ-100). Same reason
 * as above: what the broker is told, and through which channel, is the other
 * module's business — this one only has to hand over the emission.
 */
class RecordingNotifier implements PolicyIssuedNotifier {
  readonly events: PolicyIssuedEvent[] = [];

  async notify(event: PolicyIssuedEvent): Promise<void> {
    this.events.push(event);
  }
}

/**
 * A unit of work that says whether it is open, so a test can see what was
 * written inside it.
 */
function trackedTransaction() {
  const state = { open: false };
  return {
    state,
    transaction: {
      run: async <T>(work: () => Promise<T>): Promise<T> => {
        state.open = true;
        try {
          return await work();
        } finally {
          state.open = false;
        }
      },
    },
  };
}

/** Records, for each document stored, whether a unit of work was open. */
function recordSavesInside(documents: InMemoryDocumentStorage, state: { open: boolean }) {
  const inside: boolean[] = [];
  const save = documents.save.bind(documents);
  documents.save = async (document) => {
    inside.push(state.open);
    return save(document);
  };
  return inside;
}

function scenario(transaction: Transaction = new ImmediateTransaction()) {
  const proposals = new InMemoryProposalRepository();
  const policies = new InMemoryPolicyRepository();
  const documents = new InMemoryDocumentStorage();
  const agreedCommission = new RecordingCommissionCalculator();
  const notifier = new RecordingNotifier();
  let sequence = 0;

  const useCase = new RegisterPolicy({
    proposals,
    policies,
    documents,
    transaction,
    agreedCommission,
    notifier,
    newId: () => `id-${++sequence}`,
    now: () => NOW,
  });

  return { proposals, policies, documents, agreedCommission, notifier, useCase };
}

function awaiting(overrides: Partial<ProposalRegistration> = {}): Proposal {
  return Proposal.register({
    id: 'proposal-1',
    clientId: 'client-1',
    brokerId: 'broker-1',
    insurerId: 'insurer-1',
    productId: 'product-1',
    paymentMethodId: 'bank-slip',
    proposalNumber: 'PRP-9001',
    netPremium: Money.fromString('1200.00'),
    coverageStart: CalendarDate.fromString('2026-10-01'),
    coverageEnd: CalendarDate.fromString('2027-10-01'),
    installments: [
      { amount: Money.fromString('600.00'), dueDate: CalendarDate.fromString('2026-10-10') },
      { amount: Money.fromString('600.00'), dueDate: null },
    ],
    workedCommission: Percentage.fromString('40'),
    workedCommissionMode: 'INTEGRAL',
    receipt: { kind: 'DIRECT' },
    registeredBy: 'operator',
    registeredAt: new Date('2026-09-17T12:00:00.000Z'),
    ...overrides,
  });
}

const POLICY_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

/** REQ-247, REQ-248: the recognition carries the policy number and the policy PDF. */
function input(overrides: Partial<RegisterPolicyInput> = {}): RegisterPolicyInput {
  return {
    proposalId: 'proposal-1',
    userId: 'carla.dias',
    policyNumber: 'APL-5177',
    document: { fileName: 'apolice.pdf', content: POLICY_PDF },
    ...overrides,
  };
}

async function ruleOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(BusinessRuleViolation);
    return (error as BusinessRuleViolation).rule;
  }
  throw new Error('should have thrown');
}

describe('RegisterPolicy — the recognition of issuance (FP-01 steps 8 and 9)', () => {
  it('creates the policy with the informed number, inheriting every other datum of the proposal (REQ-240, REQ-241, REQ-248, CA-205, CA-271)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(awaiting());

    const output = await useCase.execute(input());

    expect(output).toMatchObject({
      // REQ-248: the policy number is informed; the proposal's stays consultable.
      policyNumber: 'APL-5177',
      proposalId: 'proposal-1',
      proposalNumber: 'PRP-9001',
      status: 'ACTIVE',
      premium: '1200.00',
      coverageStart: '2026-10-01',
      coverageEnd: '2027-10-01',
      // REQ-203, CA-206: the renewal is the end of coverage.
      renewalDate: '2027-10-01',
      registeredAt: NOW.toISOString(),
      // REQ-247: the PDF travels with the recognition, signed by it.
      document: { fileName: 'apolice.pdf', attachedBy: 'carla.dias' },
    });
    expect(output.installments).toEqual([
      {
        id: 'id-3',
        number: 1,
        amount: '600.00',
        dueDate: '2026-10-10',
        status: 'PENDING',
        // REQ-123: nobody has confirmed a receipt yet (IN-13).
        confirmedBy: null,
        confirmedAt: null,
      },
      {
        id: 'id-4',
        number: 2,
        amount: '600.00',
        // REQ-204, CA-208: inherited without a due date, as informed.
        dueDate: null,
        status: 'PENDING',
        confirmedBy: null,
        confirmedAt: null,
      },
    ]);
  });

  it('inherits an empty schedule from a proposal with no installments (REQ-241, CA-216)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(awaiting({ installments: [] }));

    const output = await useCase.execute(input());

    expect(output.installments).toEqual([]);
  });

  it('moves the proposal to ISSUED, signed by who identified it, at this moment (REQ-209, CA-207)', async () => {
    const { proposals, policies, useCase } = scenario();
    await proposals.save(awaiting());

    const output = await useCase.execute(input());

    const issued = await proposals.findById('proposal-1');
    expect(issued?.status).toBe('ISSUED');
    expect(issued?.issuanceRecognition?.author).toBe('carla.dias');
    expect(issued?.issuanceRecognition?.at).toEqual(NOW);
    expect((await policies.findById(output.id))?.policyNumber).toBe('APL-5177');
  });

  it('refuses a recognition nobody signed, and changes nothing (REJ-205, REQ-216)', async () => {
    const { proposals, policies, useCase } = scenario();
    await proposals.save(awaiting());

    expect(await ruleOf(useCase.execute(input({ userId: '  ' })))).toBe('REQ-216');

    expect((await proposals.findById('proposal-1'))?.status).toBe('AWAITING_ISSUANCE');
    expect(await policies.findByProposalId('proposal-1')).toBeNull();
  });

  it('does not create a policy for a refused proposal (REJ-210)', async () => {
    const { proposals, policies, useCase } = scenario();
    await proposals.save(awaiting().reject('perfil de risco'));

    expect(await ruleOf(useCase.execute(input()))).toBe('REQ-253');

    expect(await policies.findById('id-1')).toBeNull();
  });

  it('does not create a second policy for the same proposal (REQ-049)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(awaiting());
    await useCase.execute(input());

    expect(await ruleOf(useCase.execute(input()))).toBe('REQ-049');
  });

  it('accepts two policies with the same number, which is not checked for uniqueness (DEC-207, REQ-248)', async () => {
    const { proposals, policies, useCase } = scenario();
    await proposals.save(awaiting());
    await proposals.save(awaiting({ id: 'proposal-2' }));

    await useCase.execute(input());
    const second = await useCase.execute(input({ proposalId: 'proposal-2' }));

    expect(second.policyNumber).toBe('APL-5177');
    expect(await policies.findByProposalId('proposal-2')).not.toBeNull();
  });

  it('reports an unknown proposal as not found', async () => {
    const { useCase } = scenario();

    await expect(useCase.execute(input({ proposalId: 'ghost' }))).rejects.toThrow(RecordNotFound);
  });

  it('asks for the agreed commission once the policy is created', async () => {
    const { proposals, agreedCommission, useCase } = scenario();
    await proposals.save(awaiting());

    const policy = await useCase.execute(input());

    expect(agreedCommission.requests).toHaveLength(1);
    expect(agreedCommission.requests[0]).toEqual({
      policyId: policy.id,
      // REQ-236: the calculation reads the proposal, not the policy premium.
      proposalId: 'proposal-1',
      calculatedAt: NOW,
    });
  });

  it('asks for nothing when the recognition is refused', async () => {
    const { proposals, agreedCommission, notifier, useCase } = scenario();
    await proposals.save(awaiting().reject('perfil de risco'));

    await expect(useCase.execute(input())).rejects.toThrow(BusinessRuleViolation);

    expect(agreedCommission.requests).toEqual([]);
    expect(notifier.events).toEqual([]);
  });

  it('notifies the broker once the policy is created (REQ-100)', async () => {
    const { proposals, notifier, useCase } = scenario();
    await proposals.save(awaiting());

    const policy = await useCase.execute(input());

    expect(notifier.events).toHaveLength(1);
    expect(notifier.events[0]).toEqual({
      policyId: policy.id,
      proposalId: 'proposal-1',
      policyNumber: 'APL-5177',
      // REQ-105, REQ-209: the moment the issuance was recognised.
      issuedAt: NOW,
    });
  });

  it('keeps the PDF sent with the recognition, signed by who recognised it (REQ-247, CA-243)', async () => {
    const { proposals, policies, documents, useCase } = scenario();
    await proposals.save(awaiting());
    const content = POLICY_PDF;

    const output = await useCase.execute(input());

    expect(output.document).toEqual({
      fileName: 'apolice.pdf',
      attachedBy: 'carla.dias',
      attachedAt: NOW.toISOString(),
    });
    const stored = await policies.findById(output.id);
    expect(await documents.findById(stored?.document?.documentId ?? '')).toEqual({
      id: stored?.document?.documentId,
      fileName: 'apolice.pdf',
      // REQ-247: treated as a PDF; the content is not read (DEC-213).
      contentType: 'application/pdf',
      content,
    });
  });

  it('stores the PDF outside the unit of work: its storage may wait on the network', async () => {
    const tracked = trackedTransaction();
    const { proposals, documents, useCase } = scenario(tracked.transaction);
    await proposals.save(awaiting());
    const inside = recordSavesInside(documents, tracked.state);

    await useCase.execute(input());

    expect(inside).toEqual([false]);
  });

  it('keeps no PDF when the recognition is refused (REQ-247, REQ-216)', async () => {
    const { proposals, documents, useCase } = scenario();
    await proposals.save(awaiting());
    const content = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

    await expect(
      useCase.execute(input({ userId: '  ', document: { fileName: 'apolice.pdf', content } })),
    ).rejects.toThrow(BusinessRuleViolation);

    expect(await documents.findById('id-2')).toBeNull();
  });

  it('refuses a recognition without the policy PDF, and changes nothing (REQ-247, REJ-247)', async () => {
    const { proposals, policies, useCase } = scenario();
    await proposals.save(awaiting());

    expect(await ruleOf(useCase.execute(input({ document: null })))).toBe('REQ-247');

    expect((await proposals.findById('proposal-1'))?.status).toBe('AWAITING_ISSUANCE');
    expect(await policies.findByProposalId('proposal-1')).toBeNull();
  });

  it('refuses a recognition without the policy number, and changes nothing (REQ-248, REJ-248)', async () => {
    const { proposals, policies, useCase } = scenario();
    await proposals.save(awaiting());

    expect(await ruleOf(useCase.execute(input({ policyNumber: '  ' })))).toBe('REQ-248');

    expect((await proposals.findById('proposal-1'))?.status).toBe('AWAITING_ISSUANCE');
    expect(await policies.findByProposalId('proposal-1')).toBeNull();
  });

  it('keeps the number as informed, without the surrounding spaces (REQ-248)', async () => {
    const { proposals, useCase } = scenario();
    await proposals.save(awaiting());

    const output = await useCase.execute(input({ policyNumber: ' 5177202641312121285 ' }));

    expect(output.policyNumber).toBe('5177202641312121285');
  });
});
