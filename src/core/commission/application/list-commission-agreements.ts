import { ReferenceNames } from '../../registry/application/reference-names.ts';
import type { ReferenceRepository } from '../../registry/application/reference-repository.ts';
import type { CommissionAgreementRepository } from './commission-agreement-repository.ts';
import {
  type CommissionAgreementView,
  toCommissionAgreementView,
} from './commission-agreement-view.ts';

export interface ListCommissionAgreementsDependencies {
  readonly agreements: CommissionAgreementRepository;
  /** IN-01: the name of the intermediary the chain names (REQ-060). */
  readonly references: ReferenceRepository;
}

/**
 * IN-02, IN-03, IN-04: what the Administrator has already registered.
 *
 * `RegisterCommissionAgreement` writes the parameter the calculation reads;
 * until this existed nothing could read it back, so a wrong rate was only
 * visible in the commission it had already produced. REQ-061 and REQ-125 make
 * these parameters data rather than code, and a parameter nobody can inspect
 * is only half of that.
 *
 * It answers the records as they are stored and marks none of them as the one
 * in force: which agreement applies is decided by the date of each calculation
 * (REQ-065, CA-012), and that answer belongs to `findInForce`, not to a
 * listing that has no calculation in front of it.
 */
export class ListCommissionAgreements {
  private readonly deps: ListCommissionAgreementsDependencies;

  constructor(deps: ListCommissionAgreementsDependencies) {
    this.deps = deps;
  }

  async execute(): Promise<readonly CommissionAgreementView[]> {
    const agreements = await this.deps.agreements.list();
    const names = await ReferenceNames.load(this.deps.references);

    return agreements.map((agreement) => toCommissionAgreementView(agreement, names));
  }
}
