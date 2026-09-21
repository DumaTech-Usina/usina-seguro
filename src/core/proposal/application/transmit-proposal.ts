import { BusinessRuleViolation, PROPOSAL_MESSAGES, RecordNotFound } from '../domain/errors.ts';
import { Percentage } from '../domain/percentage.ts';
import type { ProposalRepository } from './proposal-repository.ts';

export interface TransmitProposalInput {
  readonly proposalId: string;
  /** Number issued by the insurer (glossary 5.1, REQ-022). */
  readonly proposalNumber: string;
  /** Worked commission the insurer informed when it issued it (REQ-041). */
  readonly workedCommission: string;
}

export interface TransmitProposalOutput {
  readonly id: string;
  readonly status: string;
  readonly proposalNumber: string | null;
  readonly workedCommission: string | null;
  readonly transmittedAt: string | null;
}

export interface TransmitProposalDependencies {
  readonly proposals: ProposalRepository;
  readonly now: () => Date;
}

/**
 * FP-01, step 4: records that the insurer issued the proposal, with the
 * number and the worked commission it handed back (REQ-041, REQ-042).
 *
 * The Usina does not produce either value — it registers what came back
 * (REQ-002). The insurer returns more fields than these two; inventorying them
 * is `DEC-015`.
 *
 * The transition rules live in `Proposal.transmit`; the use case only loads,
 * delegates and persists.
 */
export class TransmitProposal {
  private readonly deps: TransmitProposalDependencies;

  constructor(deps: TransmitProposalDependencies) {
    this.deps = deps;
  }

  async execute(input: TransmitProposalInput): Promise<TransmitProposalOutput> {
    const proposal = await this.deps.proposals.findById(input.proposalId);

    if (proposal === null) {
      throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: input.proposalId });
    }

    // REQ-082, CA-019: a report line that brings only the proposal number
    // reaches the policy through this number, so it has to identify one
    // proposal. The uniqueness needs the other proposals, which the aggregate
    // cannot see, so the check lives here.
    const proposalNumber = input.proposalNumber.trim();
    const registered = await this.deps.proposals.findByProposalNumber(proposalNumber);

    if (registered !== null && registered.id !== proposal.id) {
      throw new BusinessRuleViolation(
        'REQ-082',
        PROPOSAL_MESSAGES.PROPOSAL_NUMBER_ALREADY_REGISTERED,
        { proposalNumber },
      );
    }

    const transmitted = proposal.transmit({
      proposalNumber: input.proposalNumber,
      workedCommission: Percentage.fromString(input.workedCommission),
      transmittedAt: this.deps.now(),
    });

    await this.deps.proposals.save(transmitted);

    return {
      id: transmitted.id,
      status: transmitted.status,
      proposalNumber: transmitted.proposalNumber,
      workedCommission: transmitted.workedCommission?.toString() ?? null,
      transmittedAt: transmitted.transmittedAt?.toISOString() ?? null,
    };
  }
}
