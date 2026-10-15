import type { PolicyRepository } from '../../policy/application/policy-repository.ts';
import { POLICY_MESSAGES } from '../../policy/domain/errors.ts';
import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../../proposal/domain/errors.ts';
import { clientNameOf } from '../../registry/application/client-name.ts';
import type { ClientRepository } from '../../registry/application/client-repository.ts';
import { ReferenceNames } from '../../registry/application/reference-names.ts';
import type { ReferenceRepository } from '../../registry/application/reference-repository.ts';
import type { CommissionStatus } from '../domain/commission.ts';
import type { CommissionRepository } from './commission-repository.ts';
import { type CommissionListItemView, toCommissionListItemView } from './commission-view.ts';

export interface ListCommissionsInput {
  /**
   * When present, only commissions in that state are listed.
   */
  readonly status?: CommissionStatus;
}

export interface ListCommissionsDependencies {
  readonly commissions: CommissionRepository;
  readonly policies: PolicyRepository;
  readonly proposals: ProposalRepository;
  /** IN-01: the names the line is identified by (REQ-096). */
  readonly references: ReferenceRepository;
  /** REQ-318: the client's name, from the client registry. */
  readonly clients: ClientRepository;
}

/**
 * OUT-05: the agreed commission of every policy (REQ-236).
 *
 * `GetCommission` answers it for one policy; this is the same reading as a
 * list.
 *
 * Each line is completed with the policy and the proposal it belongs to,
 * because the commission holds the policy id and nothing a human recognises.
 * They are read one by one, through the ports that already exist, rather than
 * by a join: the listing is one line per policy of the Usina, and a query that
 * spanned three modules would put in the persistence layer a composition that
 * belongs here.
 */
export class ListCommissions {
  private readonly deps: ListCommissionsDependencies;

  constructor(deps: ListCommissionsDependencies) {
    this.deps = deps;
  }

  async execute(input: ListCommissionsInput = {}): Promise<readonly CommissionListItemView[]> {
    const commissions = await this.deps.commissions.list(input);
    const names = await ReferenceNames.load(this.deps.references);

    return Promise.all(
      commissions.map(async (commission) => {
        const policy = await this.deps.policies.findById(commission.policyId);

        // REQ-245: a commission without its policy is not a line to
        // hide from the panel, it is a broken record, and the reading says so.
        if (policy === null) {
          throw new RecordNotFound(POLICY_MESSAGES.NOT_FOUND, { id: commission.policyId });
        }

        const proposal = await this.deps.proposals.findById(policy.proposalId);

        if (proposal === null) {
          throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: policy.proposalId });
        }

        return toCommissionListItemView(
          commission,
          policy,
          proposal,
          names,
          await clientNameOf(this.deps.clients, proposal.clientId),
        );
      }),
    );
  }
}
