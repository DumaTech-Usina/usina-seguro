import { Money } from '../domain/money.ts';
import { Proposal } from '../domain/proposal.ts';
import type { ProposalRepository } from './proposal-repository.ts';

/**
 * Use case input: raw data at the core boundary.
 *
 * `netPremium` arrives as a decimal string (REQ-120) and only becomes `Money`
 * in here — the caller does not need to know the value object.
 */
export interface RegisterProposalInput {
  readonly clientId: string;
  readonly brokerId: string;
  readonly insurerId: string;
  readonly productId: string;
  readonly paymentMethodId: string;
  readonly customerAccepted: boolean;
  readonly netPremium: string;
}

export interface RegisterProposalOutput {
  readonly id: string;
  readonly status: string;
  readonly netPremium: string;
  readonly registeredAt: string;
}

/**
 * Use case dependencies.
 *
 * `newId` and `now` are injected rather than called directly: they are the two
 * sources of non-determinism in this flow and the tests need to control them.
 * They are function types, not ceremonial interfaces.
 */
export interface RegisterProposalDependencies {
  readonly proposals: ProposalRepository;
  readonly newId: () => string;
  readonly now: () => Date;
}

/**
 * FP-01, step 3: registers the proposal from the customer's acceptance.
 *
 * The use case only orchestrates — the acceptance rule lives in
 * `Proposal.register` (REQ-040).
 */
export class RegisterProposal {
  private readonly deps: RegisterProposalDependencies;

  constructor(deps: RegisterProposalDependencies) {
    this.deps = deps;
  }

  async execute(input: RegisterProposalInput): Promise<RegisterProposalOutput> {
    const proposal = Proposal.register({
      id: this.deps.newId(),
      clientId: input.clientId,
      brokerId: input.brokerId,
      insurerId: input.insurerId,
      productId: input.productId,
      paymentMethodId: input.paymentMethodId,
      customerAccepted: input.customerAccepted,
      netPremium: Money.fromString(input.netPremium),
      registeredAt: this.deps.now(),
    });

    await this.deps.proposals.save(proposal);

    return {
      id: proposal.id,
      status: proposal.status,
      netPremium: proposal.netPremium.toString(),
      registeredAt: proposal.registeredAt.toISOString(),
    };
  }
}
