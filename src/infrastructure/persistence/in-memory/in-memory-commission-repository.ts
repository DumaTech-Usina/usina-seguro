import type {
  CommissionListFilter,
  CommissionRepository,
} from '../../../core/commission/application/commission-repository.ts';
import type { Commission } from '../../../core/commission/domain/commission.ts';
import { type Page, type PageRequest, pageOf } from '../../../core/proposal/application/page.ts';

/**
 * `CommissionRepository` implementation for unit tests and fast execution.
 *
 * Keyed by policy because there is one commission per policy (REQ-075), which
 * also makes the uniqueness REQ-086 relies on free here. The SQLite adapter
 * gets it from a UNIQUE constraint instead.
 */
export class InMemoryCommissionRepository implements CommissionRepository {
  private readonly records = new Map<string, Commission>();

  async save(commission: Commission): Promise<void> {
    this.records.set(commission.policyId, commission);
  }

  async findByPolicyId(policyId: string): Promise<Commission | null> {
    return this.records.get(policyId) ?? null;
  }

  /** OUT-05. Same order the SQLite driver answers: newest calculation first. */
  async list(filter: CommissionListFilter): Promise<readonly Commission[]> {
    return [...this.records.values()]
      .filter((commission) => filter.status === undefined || commission.status === filter.status)
      .sort((a, b) => {
        const byDate = b.calculatedAt.getTime() - a.calculatedAt.getTime();
        return byDate === 0 ? b.id.localeCompare(a.id) : byDate;
      });
  }

  async page(filter: CommissionListFilter, page: PageRequest): Promise<Page<Commission>> {
    return pageOf(await this.list(filter), page);
  }
}
