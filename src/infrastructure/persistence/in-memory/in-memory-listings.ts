import { containsIgnoringCase } from '../../../core/commission/application/list-eligible-payouts.ts';
import type { PayoutCommissionRepository } from '../../../core/commission/application/payout-commission-repository.ts';
import type {
  EligiblePayoutFilter,
  PayoutListing,
} from '../../../core/commission/application/payout-listing.ts';
import type {
  PolicyListing,
  PolicyListingFilter,
} from '../../../core/policy/application/policy-listing.ts';
import type { PolicyRepository } from '../../../core/policy/application/policy-repository.ts';
import type { Policy } from '../../../core/policy/domain/policy.ts';
import { type Page, type PageRequest, pageOf } from '../../../core/proposal/application/page.ts';
import type {
  ProposalListing,
  ProposalListingFilter,
} from '../../../core/proposal/application/proposal-listing.ts';
import type { ProposalRepository } from '../../../core/proposal/application/proposal-repository.ts';
import type { WorkedCommissionMode } from '../../../core/proposal/domain/worked-commission.ts';
import type { ClientRepository } from '../../../core/registry/application/client-repository.ts';
import { matchesClientQuery } from '../../../core/registry/application/list-clients.ts';

/**
 * The listing ports over the in-memory repositories: each listing is read
 * whole and cut into a page, which is all a unit test needs. The SQLite
 * driver answers the same questions with one query each (`SqliteListings`).
 */
export class InMemoryListings implements ProposalListing, PolicyListing, PayoutListing {
  private readonly deps: {
    readonly proposals: ProposalRepository;
    readonly policies: PolicyRepository;
    readonly clients: ClientRepository;
    readonly payouts: PayoutCommissionRepository;
  };

  constructor(deps: InMemoryListings['deps']) {
    this.deps = deps;
  }

  async proposals(filter: ProposalListingFilter, page: PageRequest): Promise<Page<string>> {
    const proposals = await this.deps.proposals.list(
      filter.status === undefined ? {} : { status: filter.status },
    );
    const clients = filter.client === undefined ? null : await this.matchingClients(filter.client);
    return pageOf(
      proposals.filter((p) => clients === null || clients.has(p.clientId)).map((p) => p.id),
      page,
    );
  }

  async policies(filter: PolicyListingFilter, page: PageRequest): Promise<Page<string>> {
    const policies = await this.deps.policies.list(
      filter.renewalUntil === undefined ? {} : { renewalUntil: filter.renewalUntil },
    );
    const clients = filter.client === undefined ? null : await this.matchingClients(filter.client);
    const kept: string[] = [];
    for (const policy of policies) {
      const proposal = await this.deps.proposals.findById(policy.proposalId);
      if (clients === null || (proposal !== null && clients.has(proposal.clientId))) {
        kept.push(policy.id);
      }
    }
    return pageOf(kept, page);
  }

  async policiesWithoutPayoutRate(page: PageRequest): Promise<Page<string>> {
    const informed = new Set((await this.deps.payouts.list()).map((payout) => payout.policyId));
    const kept = (await this.policiesWithMode('INTEGRAL')).filter((p) => !informed.has(p.id));
    return pageOf(
      kept.map((p) => p.id),
      page,
    );
  }

  async parcelledPolicies(page: PageRequest): Promise<Page<string>> {
    return pageOf(
      (await this.policiesWithMode('PARCELLED')).map((p) => p.id),
      page,
    );
  }

  async eligiblePayouts(filter: EligiblePayoutFilter, page: PageRequest): Promise<Page<string>> {
    const lines: { policyId: string; payoutId: string; at: number }[] = [];
    for (const payout of await this.deps.payouts.list()) {
      const statement = payout.statement;
      if (
        statement === null ||
        !containsIgnoringCase(statement.policyNumber, filter.policyNumber) ||
        !containsIgnoringCase(statement.broker, filter.broker) ||
        !containsIgnoringCase(statement.client, filter.client) ||
        (filter.eligibleFrom !== undefined && statement.eligibleAt < filter.eligibleFrom) ||
        (filter.eligibleBefore !== undefined && statement.eligibleAt >= filter.eligibleBefore)
      ) {
        continue;
      }
      const policy = await this.deps.policies.findById(payout.policyId);
      const month = policy?.renewalDate.toString().slice(0, 7) ?? '';
      if (
        (filter.renewalFrom !== undefined && month < filter.renewalFrom) ||
        (filter.renewalUntil !== undefined && month > filter.renewalUntil)
      ) {
        continue;
      }
      lines.push({
        policyId: payout.policyId,
        payoutId: payout.id,
        at: statement.eligibleAt.getTime(),
      });
    }
    lines.sort((a, b) => b.at - a.at || compare(b.payoutId, a.payoutId));
    return pageOf(
      lines.map((line) => line.policyId),
      page,
    );
  }

  private async matchingClients(query: string): Promise<ReadonlySet<string>> {
    return new Set(
      (await this.deps.clients.list())
        .filter((client) => matchesClientQuery(client.name, client.cpf.digits, query))
        .map((client) => client.id),
    );
  }

  /** In the order of the policy listing: nearest renewal first. */
  private async policiesWithMode(mode: WorkedCommissionMode): Promise<readonly Policy[]> {
    const kept: Policy[] = [];
    for (const policy of await this.deps.policies.list({})) {
      const proposal = await this.deps.proposals.findById(policy.proposalId);
      if (proposal?.workedCommissionMode === mode) {
        kept.push(policy);
      }
    }
    return kept;
  }
}

function compare(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
