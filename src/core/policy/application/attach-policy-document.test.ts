import { describe, expect, it } from 'vitest';
import { ImmediateTransaction } from '../../../infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryDocumentStorage } from '../../../infrastructure/persistence/in-memory/in-memory-document-storage.ts';
import { InMemoryPolicyRepository } from '../../../infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from '../../../infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { CalendarDate } from '../../proposal/domain/calendar-date.ts';
import { BusinessRuleViolation, RecordNotFound } from '../../proposal/domain/errors.ts';
import { Money } from '../../proposal/domain/money.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { Proposal } from '../../proposal/domain/proposal.ts';
import { Policy } from '../domain/policy.ts';
import { AttachPolicyDocument } from './attach-policy-document.ts';
import { GetPolicyDocument } from './get-policy-document.ts';
import { RegisterPolicy } from './register-policy.ts';

const RECOGNIZED_AT = new Date('2026-09-20T10:00:00.000Z');
const FIRST_SENT_AT = new Date('2026-09-21T10:00:00.000Z');
const SECOND_SENT_AT = new Date('2026-09-22T10:00:00.000Z');

/** REQ-247: the PDF every recognition carries. */
const ISSUED = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x30]);
const FIRST = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x31]);
const SECOND = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x32]);

async function scenario() {
  const proposals = new InMemoryProposalRepository();
  const policies = new InMemoryPolicyRepository();
  const documents = new InMemoryDocumentStorage();
  const clock = [RECOGNIZED_AT, FIRST_SENT_AT, SECOND_SENT_AT];
  let sequence = 0;
  const newId = () => `id-${++sequence}`;
  const now = () => clock.shift() ?? SECOND_SENT_AT;

  await proposals.save(
    Proposal.register({
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
      installments: [],
      workedCommission: Percentage.fromString('40'),
      workedCommissionMode: 'INTEGRAL',
      receipt: { kind: 'DIRECT' },
      registeredBy: 'operator',
      registeredAt: new Date('2026-09-17T12:00:00.000Z'),
    }),
  );

  const policy = await new RegisterPolicy({
    proposals,
    policies,
    documents,
    transaction: new ImmediateTransaction(),
    // FP-01 step 7 belongs to other modules; this test is about the PDF.
    agreedCommission: { calculateFor: async () => {} },
    notifier: { notify: async () => {} },
    newId,
    now,
  }).execute({
    proposalId: 'proposal-1',
    userId: 'carla.dias',
    policyNumber: 'APL-1',
    document: { fileName: 'apolice-emitida.pdf', content: ISSUED },
  });

  return {
    policyId: policy.id,
    policies,
    documents,
    attach: new AttachPolicyDocument({ proposals, policies, documents, newId, now }),
    read: new GetPolicyDocument({ policies, documents }),
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

describe('AttachPolicyDocument — the PDF sent after the policy exists (REQ-247)', () => {
  it('keeps the PDF, signed by who sent it at the moment it is recorded (CA-243)', async () => {
    const { policyId, attach, read } = await scenario();

    const output = await attach.execute({
      policyId,
      userId: 'ana.souza',
      document: { fileName: 'apolice.pdf', content: FIRST },
    });

    expect(output.document).toEqual({
      fileName: 'apolice.pdf',
      attachedBy: 'ana.souza',
      attachedAt: FIRST_SENT_AT.toISOString(),
    });
    expect(await read.execute(policyId)).toMatchObject({
      fileName: 'apolice.pdf',
      // Treated as a PDF; the content is not read (DEC-213).
      contentType: 'application/pdf',
      content: FIRST,
    });
  });

  it('keeps only the last PDF sent, and the earlier bytes stay stored (CA-244, REQ-124)', async () => {
    const { policyId, policies, documents, attach, read } = await scenario();

    await attach.execute({
      policyId,
      userId: 'ana.souza',
      document: { fileName: 'apolice.pdf', content: FIRST },
    });
    const earlierId = (await policies.findById(policyId))?.document?.documentId ?? '';

    const output = await attach.execute({
      policyId,
      userId: 'bruno.lima',
      document: { fileName: 'apolice-corrigida.pdf', content: SECOND },
    });

    expect(output.document).toEqual({
      fileName: 'apolice-corrigida.pdf',
      attachedBy: 'bruno.lima',
      attachedAt: SECOND_SENT_AT.toISOString(),
    });
    expect((await read.execute(policyId)).content).toEqual(SECOND);
    expect((await documents.findById(earlierId))?.content).toEqual(FIRST);
  });

  it('refuses a sending nobody signed, and keeps the PDF of the recognition (REQ-216)', async () => {
    const { policyId, policies, attach } = await scenario();

    expect(
      await ruleOf(
        attach.execute({
          policyId,
          userId: '  ',
          document: { fileName: 'apolice.pdf', content: FIRST },
        }),
      ),
    ).toBe('REQ-216');

    expect((await policies.findById(policyId))?.document?.fileName).toBe('apolice-emitida.pdf');
  });

  it('reports an unknown policy as not found', async () => {
    const { attach } = await scenario();

    await expect(
      attach.execute({
        policyId: 'ghost',
        userId: 'ana.souza',
        document: { fileName: 'apolice.pdf', content: FIRST },
      }),
    ).rejects.toThrow(RecordNotFound);
  });
});

describe('GetPolicyDocument (REQ-247)', () => {
  it('answers the PDF sent with the recognition (REQ-247, CA-243)', async () => {
    const { policyId, read } = await scenario();

    expect(await read.execute(policyId)).toMatchObject({
      fileName: 'apolice-emitida.pdf',
      content: ISSUED,
    });
  });

  it('answers not found for a policy recorded before the PDF was required', async () => {
    const { policies, read } = await scenario();
    await policies.save(
      Policy.register({
        id: 'legacy-policy',
        proposalId: 'proposal-legacy',
        policyNumber: 'PRP-OLD',
        premium: Money.fromString('100.00'),
        coverageStart: CalendarDate.fromString('2026-10-01'),
        coverageEnd: CalendarDate.fromString('2027-10-01'),
        renewalDate: CalendarDate.fromString('2027-10-01'),
        installments: [],
        document: null,
        registeredAt: RECOGNIZED_AT,
      }),
    );

    await expect(read.execute('legacy-policy')).rejects.toThrow(RecordNotFound);
  });

  it('answers not found for an unknown policy', async () => {
    const { read } = await scenario();

    await expect(read.execute('ghost')).rejects.toThrow(RecordNotFound);
  });
});
