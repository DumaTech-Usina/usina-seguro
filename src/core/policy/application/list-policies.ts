import type { ProposalRepository } from '../../proposal/application/proposal-repository.ts';
import { CalendarDate } from '../../proposal/domain/calendar-date.ts';
import { PROPOSAL_MESSAGES, RecordNotFound } from '../../proposal/domain/errors.ts';
import { clientNameOf } from '../../registry/application/client-name.ts';
import type { ClientRepository } from '../../registry/application/client-repository.ts';
import { searchClients } from '../../registry/application/list-clients.ts';
import { ReferenceNames } from '../../registry/application/reference-names.ts';
import type { ReferenceRepository } from '../../registry/application/reference-repository.ts';
import type { PolicyListFilter, PolicyRepository } from './policy-repository.ts';
import { type PolicyListItemView, toPolicyListItemView } from './policy-view.ts';

export interface ListPoliciesInput {
  /**
   * OUT-04, CA-032: when present, only the policies that renew on or before
   * this calendar day, which is what "a vencer" means once someone says until
   * when.
   *
   * REQ-055 requires the listing; no requirement fixes the window, so the day
   * is informed rather than assumed. A malformed one is refused by
   * `CalendarDate` (REQ-020) instead of being read as "no filter", which would
   * answer the whole listing to a question that was never understood.
   */
  readonly renewalUntil?: string;
  /**
   * REQ-319: part of the client's name or digits of its CPF. Absent or blank
   * means no filter. Matched through the client registry, so a policy whose
   * proposal holds a typed text from before it is not found (REQ-320).
   */
  readonly client?: string | undefined;
}

export interface ListPoliciesDependencies {
  readonly policies: PolicyRepository;
  readonly proposals: ProposalRepository;
  /** IN-01: the names the line is identified by (REQ-096). */
  readonly references: ReferenceRepository;
  /** V2 section 9E: the client's name, and the search by client (REQ-318, REQ-319). */
  readonly clients: ClientRepository;
}

/**
 * OUT-03 and OUT-04: the policies the Usina sold, with coverage, state and
 * renewal date, nearest renewal first.
 *
 * `GetPolicy` answers one policy with its schedule; this is the entry point
 * that makes a policy findable at all — until it existed, a policy was only
 * reachable from the proposal that originated it or by its id.
 *
 * Each line is completed with the proposal it came from, because the policy
 * holds its id and nothing a human recognises (REQ-050, REQ-022). The proposals
 * are read one by one, through the port that already exists, rather than by a
 * join: the listing is one line per policy of the Usina, and a query spanning
 * two modules would put in the persistence layer a composition that belongs
 * here.
 */
export class ListPolicies {
  private readonly deps: ListPoliciesDependencies;

  constructor(deps: ListPoliciesDependencies) {
    this.deps = deps;
  }

  async execute(input: ListPoliciesInput = {}): Promise<readonly PolicyListItemView[]> {
    const filter: PolicyListFilter =
      input.renewalUntil === undefined
        ? {}
        : { renewalUntil: CalendarDate.fromString(input.renewalUntil) };

    const query = input.client?.trim() ?? '';
    const clientIds =
      query === ''
        ? null
        : new Set((await searchClients(this.deps.clients, query)).map((client) => client.id));

    const policies = await this.deps.policies.list(filter);
    // Read once for the whole listing, not once per line: the registry is the
    // counterparties of the brokerage, not a table that grows with volume.
    const names = await ReferenceNames.load(this.deps.references);

    const lines = await Promise.all(
      policies.map(async (policy) => {
        const proposal = await this.deps.proposals.findById(policy.proposalId);

        // REQ-048, REQ-050: a policy without its proposal is not a line to
        // hide from the listing, it is a broken record, and the reading says so.
        if (proposal === null) {
          throw new RecordNotFound(PROPOSAL_MESSAGES.NOT_FOUND, { id: policy.proposalId });
        }

        // REQ-241, REQ-319: the policy's client is its proposal's.
        if (clientIds !== null && !clientIds.has(proposal.clientId)) {
          return null;
        }

        return toPolicyListItemView(
          policy,
          proposal,
          names,
          await clientNameOf(this.deps.clients, proposal.clientId),
        );
      }),
    );

    return lines.filter((line) => line !== null);
  }
}
