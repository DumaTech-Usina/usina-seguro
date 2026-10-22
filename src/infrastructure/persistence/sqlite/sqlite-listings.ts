import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type {
  EligiblePayoutFilter,
  PayoutListing,
} from '../../../core/commission/application/payout-listing.ts';
import type {
  PolicyListing,
  PolicyListingFilter,
} from '../../../core/policy/application/policy-listing.ts';
import type { Page, PageRequest } from '../../../core/proposal/application/page.ts';
import type {
  ProposalListing,
  ProposalListingFilter,
} from '../../../core/proposal/application/proposal-listing.ts';
import { readPage } from './sqlite-page.ts';

/**
 * The listing ports (REQ-330, REQ-333): each page and its total in one query
 * over the tables the filter needs, ordered by the indexes of `schema.sql`.
 *
 * The filters that cross modules — the client of a proposal, the CT of a
 * policy's proposal, the payout of a policy — are joins here because a page
 * can only be cut after the filter: loading every row to filter it in the use
 * case is what the pages exist to avoid. The use cases still read each line
 * of the page through their repositories.
 *
 * Text matching goes through `usina_client_matches` and `usina_contains`,
 * the core's own rules registered in `openSqliteConnection`.
 */
export class SqliteListings implements ProposalListing, PolicyListing, PayoutListing {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async proposals(filter: ProposalListingFilter, page: PageRequest): Promise<Page<string>> {
    const where = new Where();
    where.add('pr.status = ?', filter.status);
    where.add(CLIENT_OF_PROPOSAL, filter.client);

    return this.ids(
      {
        columns: 'pr.id',
        from: `proposal pr${where}`,
        orderBy: 'pr.registered_at DESC, pr.id DESC',
      },
      where.params,
      page,
    );
  }

  async policies(filter: PolicyListingFilter, page: PageRequest): Promise<Page<string>> {
    const where = new Where();
    where.add('p.renewal_date <= ?', filter.renewalUntil?.toString());
    where.add(
      `p.proposal_id IN (SELECT pr.id FROM proposal pr WHERE ${CLIENT_OF_PROPOSAL})`,
      filter.client,
    );

    return this.ids(
      { columns: 'p.id', from: `policy p${where}`, orderBy: 'p.renewal_date, p.id' },
      where.params,
      page,
    );
  }

  async policiesWithoutPayoutRate(page: PageRequest): Promise<Page<string>> {
    return this.ids(
      {
        columns: 'p.id',
        from: `policy p WHERE ${MODE_OF_POLICY} = 'INTEGRAL'
                 AND NOT EXISTS (SELECT 1 FROM payout_commission pc WHERE pc.policy_id = p.id)`,
        orderBy: 'p.renewal_date, p.id',
      },
      [],
      page,
    );
  }

  async parcelledPolicies(page: PageRequest): Promise<Page<string>> {
    return this.ids(
      {
        columns: 'p.id',
        from: `policy p WHERE ${MODE_OF_POLICY} = 'PARCELLED'`,
        orderBy: 'p.renewal_date, p.id',
      },
      [],
      page,
    );
  }

  async eligiblePayouts(filter: EligiblePayoutFilter, page: PageRequest): Promise<Page<string>> {
    const where = new Where();
    where.add("pc.status = 'ELIGIBLE'");
    where.add('usina_contains(pc.statement_policy_number, ?)', filter.policyNumber);
    where.add('usina_contains(pc.statement_broker, ?)', filter.broker);
    where.add('usina_contains(pc.statement_client, ?)', filter.client);
    // ISO-8601 UTC text orders as the instant it writes.
    where.add('pc.eligible_at >= ?', filter.eligibleFrom?.toISOString());
    where.add('pc.eligible_at < ?', filter.eligibleBefore?.toISOString());
    where.add('substr(p.renewal_date, 1, 7) >= ?', filter.renewalFrom);
    where.add('substr(p.renewal_date, 1, 7) <= ?', filter.renewalUntil);

    return this.ids(
      {
        columns: 'pc.policy_id AS id',
        from: `payout_commission pc JOIN policy p ON p.id = pc.policy_id${where}`,
        orderBy: 'pc.eligible_at DESC, pc.id DESC',
      },
      where.params,
      page,
    );
  }

  private ids(
    query: { columns: string; from: string; orderBy: string },
    params: readonly SQLInputValue[],
    page: PageRequest,
  ): Page<string> {
    const rows = readPage<{ id: string }>(this.db, query, params, page);
    return { ...rows, items: rows.items.map((row) => row.id) };
  }
}

/** REQ-319: the proposal `pr` is of a registered client that matches the term. */
const CLIENT_OF_PROPOSAL =
  'pr.client_id IN (SELECT c.id FROM client c WHERE usina_client_matches(c.name, c.cpf, ?))';

/** The CT mode of the policy `p`: its proposal's, the last one informed (REQ-213). */
const MODE_OF_POLICY = `(SELECT w.mode FROM proposal_worked_commission w
    WHERE w.proposal_id = p.proposal_id ORDER BY w.sequence DESC LIMIT 1)`;

/** The conditions present in a filter, joined by `AND`, with their parameters in order. */
class Where {
  private readonly conditions: string[] = [];
  readonly params: SQLInputValue[] = [];

  /** A condition without `?` always applies; one with `?` only when its value is present. */
  add(condition: string, value?: string): void {
    if (!condition.includes('?')) {
      this.conditions.push(condition);
    } else if (value !== undefined) {
      this.conditions.push(condition);
      this.params.push(value);
    }
  }

  toString(): string {
    return this.conditions.length === 0 ? '' : ` WHERE ${this.conditions.join(' AND ')}`;
  }
}
