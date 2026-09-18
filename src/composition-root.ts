import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config/config.ts';
import type { BrokerCommissionRateRepository } from './core/commission/application/broker-commission-rate-repository.ts';
import { CalculateAgreedCommission } from './core/commission/application/calculate-agreed-commission.ts';
import type { CommissionAgreementRepository } from './core/commission/application/commission-agreement-repository.ts';
import type { CommissionRepository } from './core/commission/application/commission-repository.ts';
import { GetCommission } from './core/commission/application/get-commission.ts';
import { OverrideCommission } from './core/commission/application/override-commission.ts';
import { RegisterBrokerCommissionRate } from './core/commission/application/register-broker-commission-rate.ts';
import { RegisterCommissionAgreement } from './core/commission/application/register-commission-agreement.ts';
import { ResolveCommissionDivergence } from './core/commission/application/resolve-commission-divergence.ts';
import { GetPolicy } from './core/policy/application/get-policy.ts';
import { PayInstallment } from './core/policy/application/pay-installment.ts';
import type { PolicyRepository } from './core/policy/application/policy-repository.ts';
import { RegisterPolicy } from './core/policy/application/register-policy.ts';
import type { Transaction } from './core/policy/application/transaction.ts';
import type { ProposalRepository } from './core/proposal/application/proposal-repository.ts';
import { RegisterProposal } from './core/proposal/application/register-proposal.ts';
import { RejectProposal } from './core/proposal/application/reject-proposal.ts';
import { TransmitProposal } from './core/proposal/application/transmit-proposal.ts';
import { ListReconciliationPendencies } from './core/reconciliation/application/list-reconciliation-pendencies.ts';
import { ReconcileCommissionReport } from './core/reconciliation/application/reconcile-commission-report.ts';
import type { ReconciliationPendencyRepository } from './core/reconciliation/application/reconciliation-pendency-repository.ts';
import { GetSettlement } from './core/settlement/application/get-settlement.ts';
import { OpenSettlement } from './core/settlement/application/open-settlement.ts';
import type { PaymentMethodReleaseRuleRepository } from './core/settlement/application/payment-method-release-rule-repository.ts';
import { RegisterPaymentMethodReleaseRule } from './core/settlement/application/register-payment-method-release-rule.ts';
import { RegisterSettlementPayment } from './core/settlement/application/register-settlement-payment.ts';
import { ReleaseSettlement } from './core/settlement/application/release-settlement.ts';
import type { SettlementRepository } from './core/settlement/application/settlement-repository.ts';
import { ImmediateTransaction } from './infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryBrokerCommissionRateRepository } from './infrastructure/persistence/in-memory/in-memory-broker-commission-rate-repository.ts';
import { InMemoryCommissionAgreementRepository } from './infrastructure/persistence/in-memory/in-memory-commission-agreement-repository.ts';
import { InMemoryCommissionRepository } from './infrastructure/persistence/in-memory/in-memory-commission-repository.ts';
import { InMemoryPaymentMethodReleaseRuleRepository } from './infrastructure/persistence/in-memory/in-memory-payment-method-release-rule-repository.ts';
import { InMemoryPolicyRepository } from './infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from './infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { InMemoryReconciliationPendencyRepository } from './infrastructure/persistence/in-memory/in-memory-reconciliation-pendency-repository.ts';
import { InMemorySettlementRepository } from './infrastructure/persistence/in-memory/in-memory-settlement-repository.ts';
import { SqliteBrokerCommissionRateRepository } from './infrastructure/persistence/sqlite/sqlite-broker-commission-rate-repository.ts';
import { SqliteCommissionAgreementRepository } from './infrastructure/persistence/sqlite/sqlite-commission-agreement-repository.ts';
import { SqliteCommissionRepository } from './infrastructure/persistence/sqlite/sqlite-commission-repository.ts';
import { openSqliteConnection } from './infrastructure/persistence/sqlite/sqlite-connection.ts';
import { SqlitePaymentMethodReleaseRuleRepository } from './infrastructure/persistence/sqlite/sqlite-payment-method-release-rule-repository.ts';
import { SqlitePolicyRepository } from './infrastructure/persistence/sqlite/sqlite-policy-repository.ts';
import { SqliteProposalRepository } from './infrastructure/persistence/sqlite/sqlite-proposal-repository.ts';
import { SqliteReconciliationPendencyRepository } from './infrastructure/persistence/sqlite/sqlite-reconciliation-pendency-repository.ts';
import { SqliteSettlementRepository } from './infrastructure/persistence/sqlite/sqlite-settlement-repository.ts';
import { SqliteTransaction } from './infrastructure/persistence/sqlite/sqlite-transaction.ts';

/**
 * Use cases exposed to the interface layer.
 *
 * This is the only surface `interfaces/` sees of the core.
 */
export interface UseCases {
  readonly registerProposal: RegisterProposal;
  readonly transmitProposal: TransmitProposal;
  readonly rejectProposal: RejectProposal;
  readonly registerPolicy: RegisterPolicy;
  readonly getPolicy: GetPolicy;
  readonly payInstallment: PayInstallment;
  readonly registerCommissionAgreement: RegisterCommissionAgreement;
  readonly registerBrokerCommissionRate: RegisterBrokerCommissionRate;
  readonly getCommission: GetCommission;
  readonly overrideCommission: OverrideCommission;
  readonly resolveCommissionDivergence: ResolveCommissionDivergence;
  readonly reconcileCommissionReport: ReconcileCommissionReport;
  readonly listReconciliationPendencies: ListReconciliationPendencies;
  readonly registerPaymentMethodReleaseRule: RegisterPaymentMethodReleaseRule;
  readonly openSettlement: OpenSettlement;
  readonly releaseSettlement: ReleaseSettlement;
  readonly registerSettlementPayment: RegisterSettlementPayment;
  readonly getSettlement: GetSettlement;
}

export interface Application {
  readonly useCases: UseCases;
  readonly shutdown: () => Promise<void>;
}

/**
 * Manual dependency composition. There is no DI container: the wiring fits in a
 * readable function and a container would only add indirection.
 *
 * This is the only file that knows both the core and the infrastructure.
 */
export function composeApplication(config: Config): Application {
  const {
    proposals,
    policies,
    commissions,
    agreements,
    brokerRates,
    pendencies,
    releaseRules,
    settlements,
    transaction,
    shutdown,
  } = composePersistence(config);
  const newId = (): string => randomUUID();
  const now = (): Date => new Date();

  // FP-01 step 7. The policy module only sees the port it declared; this is
  // the single place where the two modules meet.
  const agreedCommission = new CalculateAgreedCommission({
    proposals,
    commissions,
    agreements,
    brokerRates,
    newId,
  });

  return {
    useCases: {
      registerProposal: new RegisterProposal({ proposals, newId, now }),
      transmitProposal: new TransmitProposal({ proposals, now }),
      rejectProposal: new RejectProposal({ proposals }),
      registerPolicy: new RegisterPolicy({
        proposals,
        policies,
        transaction,
        agreedCommission,
        newId,
        now,
      }),
      getPolicy: new GetPolicy({ proposals, policies }),
      payInstallment: new PayInstallment({ proposals, policies, now }),
      registerCommissionAgreement: new RegisterCommissionAgreement({ agreements, newId, now }),
      registerBrokerCommissionRate: new RegisterBrokerCommissionRate({ brokerRates, now }),
      getCommission: new GetCommission({ commissions }),
      overrideCommission: new OverrideCommission({ commissions, now }),
      resolveCommissionDivergence: new ResolveCommissionDivergence({ commissions, now }),
      reconcileCommissionReport: new ReconcileCommissionReport({
        proposals,
        policies,
        commissions,
        pendencies,
        transaction,
        newId,
        now,
      }),
      listReconciliationPendencies: new ListReconciliationPendencies({ pendencies }),
      registerPaymentMethodReleaseRule: new RegisterPaymentMethodReleaseRule({
        releaseRules,
        now,
      }),
      openSettlement: new OpenSettlement({
        proposals,
        policies,
        commissions,
        releaseRules,
        settlements,
        newId,
        now,
      }),
      releaseSettlement: new ReleaseSettlement({ policies, settlements, now }),
      registerSettlementPayment: new RegisterSettlementPayment({ settlements, now }),
      getSettlement: new GetSettlement({ settlements }),
    },
    shutdown,
  };
}

interface Persistence {
  readonly proposals: ProposalRepository;
  readonly policies: PolicyRepository;
  readonly commissions: CommissionRepository;
  readonly agreements: CommissionAgreementRepository;
  readonly brokerRates: BrokerCommissionRateRepository;
  readonly pendencies: ReconciliationPendencyRepository;
  readonly releaseRules: PaymentMethodReleaseRuleRepository;
  readonly settlements: SettlementRepository;
  readonly transaction: Transaction;
  readonly shutdown: () => Promise<void>;
}

function composePersistence(config: Config): Persistence {
  switch (config.persistence.driver) {
    case 'memory':
      return {
        proposals: new InMemoryProposalRepository(),
        policies: new InMemoryPolicyRepository(),
        commissions: new InMemoryCommissionRepository(),
        agreements: new InMemoryCommissionAgreementRepository(),
        brokerRates: new InMemoryBrokerCommissionRateRepository(),
        pendencies: new InMemoryReconciliationPendencyRepository(),
        releaseRules: new InMemoryPaymentMethodReleaseRuleRepository(),
        settlements: new InMemorySettlementRepository(),
        transaction: new ImmediateTransaction(),
        shutdown: async () => {},
      };

    case 'sqlite': {
      const db = openSqlite(config.persistence.file);
      return {
        proposals: new SqliteProposalRepository(db),
        policies: new SqlitePolicyRepository(db),
        commissions: new SqliteCommissionRepository(db),
        agreements: new SqliteCommissionAgreementRepository(db),
        brokerRates: new SqliteBrokerCommissionRateRepository(db),
        pendencies: new SqliteReconciliationPendencyRepository(db),
        releaseRules: new SqlitePaymentMethodReleaseRuleRepository(db),
        settlements: new SqliteSettlementRepository(db),
        transaction: new SqliteTransaction(db),
        shutdown: async () => db.close(),
      };
    }

    case 'postgres':
      // Deliberate extension point: the PostgreSQL adapter plugs in here,
      // alongside the others, without the core changing. It was not implemented
      // in this foundation because no requirement at this stage needs
      // production persistence.
      throw new Error(
        'Persistence driver postgres is not implemented yet. ' +
          'Use PERSISTENCE_DRIVER=sqlite or memory.',
      );
  }
}

function openSqlite(file: string): DatabaseSync {
  if (file !== ':memory:') {
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  return openSqliteConnection(file);
}
