import type { ReconciliationPendencyRepository } from './reconciliation-pendency-repository.ts';

export interface ReconciliationPendencyView {
  readonly id: string;
  readonly competence: string;
  readonly proposalNumber: string;
  readonly policyNumber: string | null;
  readonly reportedCommission: string;
  readonly registeredAt: string;
}

export interface ListReconciliationPendenciesDependencies {
  readonly pendencies: ReconciliationPendencyRepository;
}

/** OUT-06: the report lines with no matching policy, waiting for a human. */
export class ListReconciliationPendencies {
  private readonly deps: ListReconciliationPendenciesDependencies;

  constructor(deps: ListReconciliationPendenciesDependencies) {
    this.deps = deps;
  }

  async execute(): Promise<readonly ReconciliationPendencyView[]> {
    const pendencies = await this.deps.pendencies.listOpen();

    return pendencies.map((pendency) => ({
      id: pendency.id,
      competence: pendency.competence,
      proposalNumber: pendency.proposalNumber,
      policyNumber: pendency.policyNumber,
      reportedCommission: pendency.reportedCommission.toString(),
      registeredAt: pendency.registeredAt.toISOString(),
    }));
  }
}
