import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config/config.ts';
import { CalculateAgreedCommission } from './core/commission/application/calculate-agreed-commission.ts';
import type { CommissionRepository } from './core/commission/application/commission-repository.ts';
import { DeclareInstallmentEligibility } from './core/commission/application/declare-installment-eligibility.ts';
import { DeclarePayoutEligibility } from './core/commission/application/declare-payout-eligibility.ts';
import { GetCommission } from './core/commission/application/get-commission.ts';
import { GetParcelledPayout } from './core/commission/application/get-parcelled-payout.ts';
import { GetPolicyPayout } from './core/commission/application/get-policy-payout.ts';
import { InformParcelledPayoutRates } from './core/commission/application/inform-parcelled-payout-rates.ts';
import { InformPayoutRate } from './core/commission/application/inform-payout-rate.ts';
import { ListCommissions } from './core/commission/application/list-commissions.ts';
import { ListEligiblePayouts } from './core/commission/application/list-eligible-payouts.ts';
import { ListParcelledPolicies } from './core/commission/application/list-parcelled-policies.ts';
import { ListPoliciesWithoutPayoutRate } from './core/commission/application/list-policies-without-payout-rate.ts';
import { OverrideCommission } from './core/commission/application/override-commission.ts';
import type { ParcelledPayoutRepository } from './core/commission/application/parcelled-payout-repository.ts';
import type { PayoutCommissionRepository } from './core/commission/application/payout-commission-repository.ts';
import { ReviseParcelledPayoutRates } from './core/commission/application/revise-parcelled-payout-rates.ts';
import { RevisePayoutRate } from './core/commission/application/revise-payout-rate.ts';
import { AcceptInvitation } from './core/identity/application/accept-invitation.ts';
import type { InvitationRepository } from './core/identity/application/invitation-repository.ts';
import { IssueFirstAdministratorInvitation } from './core/identity/application/issue-first-administrator-invitation.ts';
import { LogIn } from './core/identity/application/log-in.ts';
import { LogOut } from './core/identity/application/log-out.ts';
import { ResolveSession } from './core/identity/application/resolve-session.ts';
import type { SessionRepository } from './core/identity/application/session-repository.ts';
import type { UserRepository } from './core/identity/application/user-repository.ts';
import { ListNotifications } from './core/notification/application/list-notifications.ts';
import type { NotificationChannel } from './core/notification/application/notification-channel.ts';
import type { NotificationRepository } from './core/notification/application/notification-repository.ts';
import { NotifyPolicyIssued } from './core/notification/application/notify-policy-issued.ts';
import { AttachPolicyDocument } from './core/policy/application/attach-policy-document.ts';
import { GetPolicyByProposal } from './core/policy/application/get-policy-by-proposal.ts';
import { GetPolicyDocument } from './core/policy/application/get-policy-document.ts';
import { GetPolicy } from './core/policy/application/get-policy.ts';
import { ListPolicies } from './core/policy/application/list-policies.ts';
import { PayInstallment } from './core/policy/application/pay-installment.ts';
import type { PolicyRepository } from './core/policy/application/policy-repository.ts';
import { RegisterPolicy } from './core/policy/application/register-policy.ts';
import type { Transaction } from './core/policy/application/transaction.ts';
import { GetProposalSourceDocument } from './core/proposal/application/get-proposal-source-document.ts';
import { GetProposal } from './core/proposal/application/get-proposal.ts';
import { ListProposals } from './core/proposal/application/list-proposals.ts';
import type { ProposalRepository } from './core/proposal/application/proposal-repository.ts';
import { RegisterProposal } from './core/proposal/application/register-proposal.ts';
import { RejectProposal } from './core/proposal/application/reject-proposal.ts';
import { ReviseInstallments } from './core/proposal/application/revise-installments.ts';
import { ReviseReceipt } from './core/proposal/application/revise-receipt.ts';
import { ReviseWorkedCommission } from './core/proposal/application/revise-worked-commission.ts';
import type { SourceDocumentStorage } from './core/proposal/application/source-document-storage.ts';
import { ListReferences } from './core/registry/application/list-references.ts';
import type { ReferenceRepository } from './core/registry/application/reference-repository.ts';
import { RegisterReference } from './core/registry/application/register-reference.ts';
import { ProposalPdfReader, identifyByText } from './infrastructure/pdf/proposal-pdf-reader.ts';
import { ImmediateTransaction } from './infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryCommissionRepository } from './infrastructure/persistence/in-memory/in-memory-commission-repository.ts';
import { InMemoryDocumentStorage } from './infrastructure/persistence/in-memory/in-memory-document-storage.ts';
import { InMemoryInvitationRepository } from './infrastructure/persistence/in-memory/in-memory-invitation-repository.ts';
import { InMemoryNotificationRepository } from './infrastructure/persistence/in-memory/in-memory-notification-repository.ts';
import { InMemoryParcelledPayoutRepository } from './infrastructure/persistence/in-memory/in-memory-parcelled-payout-repository.ts';
import { InMemoryPayoutCommissionRepository } from './infrastructure/persistence/in-memory/in-memory-payout-commission-repository.ts';
import { InMemoryPolicyRepository } from './infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from './infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { InMemoryReferenceRepository } from './infrastructure/persistence/in-memory/in-memory-reference-repository.ts';
import { InMemorySessionRepository } from './infrastructure/persistence/in-memory/in-memory-session-repository.ts';
import { InMemoryUserRepository } from './infrastructure/persistence/in-memory/in-memory-user-repository.ts';
import { SqliteCommissionRepository } from './infrastructure/persistence/sqlite/sqlite-commission-repository.ts';
import { openSqliteConnection } from './infrastructure/persistence/sqlite/sqlite-connection.ts';
import { SqliteDocumentStorage } from './infrastructure/persistence/sqlite/sqlite-document-storage.ts';
import { SqliteInvitationRepository } from './infrastructure/persistence/sqlite/sqlite-invitation-repository.ts';
import { SqliteNotificationRepository } from './infrastructure/persistence/sqlite/sqlite-notification-repository.ts';
import { SqliteParcelledPayoutRepository } from './infrastructure/persistence/sqlite/sqlite-parcelled-payout-repository.ts';
import { SqlitePayoutCommissionRepository } from './infrastructure/persistence/sqlite/sqlite-payout-commission-repository.ts';
import { SqlitePolicyRepository } from './infrastructure/persistence/sqlite/sqlite-policy-repository.ts';
import { SqliteProposalRepository } from './infrastructure/persistence/sqlite/sqlite-proposal-repository.ts';
import { SqliteReferenceRepository } from './infrastructure/persistence/sqlite/sqlite-reference-repository.ts';
import { SqliteSessionRepository } from './infrastructure/persistence/sqlite/sqlite-session-repository.ts';
import { SqliteTransaction } from './infrastructure/persistence/sqlite/sqlite-transaction.ts';
import { SqliteUserRepository } from './infrastructure/persistence/sqlite/sqlite-user-repository.ts';
import { RandomSecretGenerator } from './infrastructure/security/random-secret-generator.ts';
import { ScryptPasswordHasher } from './infrastructure/security/scrypt-password-hasher.ts';

/**
 * Use cases exposed to the interface layer.
 *
 * This is the only surface `interfaces/` sees of the core.
 */
export interface UseCases {
  readonly registerProposal: RegisterProposal;
  readonly reviseWorkedCommission: ReviseWorkedCommission;
  readonly reviseReceipt: ReviseReceipt;
  readonly reviseInstallments: ReviseInstallments;
  readonly rejectProposal: RejectProposal;
  /**
   * REQ-218: an aid to filling the registration form, not a use case of the
   * core — it saves nothing and holds no business rule.
   */
  readonly readProposalPdf: ProposalPdfReader;
  readonly getProposal: GetProposal;
  /** REQ-219: the PDF the proposal was imported from. */
  readonly getProposalSourceDocument: GetProposalSourceDocument;
  readonly listProposals: ListProposals;
  readonly registerPolicy: RegisterPolicy;
  readonly getPolicy: GetPolicy;
  readonly getPolicyByProposal: GetPolicyByProposal;
  /** REQ-247: the PDF of a policy, sent after it exists, and read back. */
  readonly attachPolicyDocument: AttachPolicyDocument;
  readonly getPolicyDocument: GetPolicyDocument;
  readonly listPolicies: ListPolicies;
  readonly payInstallment: PayInstallment;
  readonly getCommission: GetCommission;
  readonly listCommissions: ListCommissions;
  readonly overrideCommission: OverrideCommission;
  /** FP-02 (V2 section 9A): the CR, its calculation and the eligibility. */
  readonly getPolicyPayout: GetPolicyPayout;
  readonly informPayoutRate: InformPayoutRate;
  readonly revisePayoutRate: RevisePayoutRate;
  readonly declarePayoutEligibility: DeclarePayoutEligibility;
  readonly listEligiblePayouts: ListEligiblePayouts;
  readonly listPoliciesWithoutPayoutRate: ListPoliciesWithoutPayoutRate;
  readonly getParcelledPayout: GetParcelledPayout;
  readonly informParcelledPayoutRates: InformParcelledPayoutRates;
  readonly reviseParcelledPayoutRates: ReviseParcelledPayoutRates;
  readonly declareInstallmentEligibility: DeclareInstallmentEligibility;
  readonly listParcelledPolicies: ListParcelledPolicies;
  readonly registerReference: RegisterReference;
  readonly listReferences: ListReferences;
  readonly listNotifications: ListNotifications;
  /**
   * V2 section 9C: access to the system. `issueFirstAdministratorInvitation`
   * is run by a command on the server (REQ-405), never over HTTP.
   */
  readonly issueFirstAdministratorInvitation: IssueFirstAdministratorInvitation;
  readonly acceptInvitation: AcceptInvitation;
  readonly logIn: LogIn;
  readonly logOut: LogOut;
  readonly resolveSession: ResolveSession;
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
    payouts,
    parcelledPayouts,
    references,
    documents,
    notifications,
    users,
    invitations,
    sessions,
    transaction,
    shutdown,
  } = composePersistence(config);
  const newId = (): string => randomUUID();
  const now = (): Date => new Date();
  // REQ-416: what is stored in place of a password, a session or a link.
  const hasher = new ScryptPasswordHasher();
  const secrets = new RandomSecretGenerator();

  // FP-01 step 7. The policy module only sees the port it declared; this is
  // the single place where the two modules meet.
  const agreedCommission = new CalculateAgreedCommission({
    proposals,
    commissions,
    newId,
  });

  /**
   * FP-01 step 7, the other half. Like the calculation above, the policy
   * module only sees the port it declared (`PolicyIssuedNotifier`).
   *
   * `channels` is empty, and that is the configuration REQ-102 describes: the
   * initial implementation is the in-app notification, which is the record
   * this use case writes and `/app/notifications/` reads. An e-mail, WhatsApp
   * or queue adapter (REQ-103, REQ-104) is added to this array and to nothing
   * else -- no rule that produces a notification changes (CA-030, REJ-017).
   */
  const notifier = new NotifyPolicyIssued({
    notifications,
    proposals,
    references,
    channels: [] as readonly NotificationChannel[],
    newId,
  });

  return {
    useCases: {
      // REQ-219: the imported PDF is kept with the proposal.
      registerProposal: new RegisterProposal({ proposals, documents, newId, now }),
      reviseWorkedCommission: new ReviseWorkedCommission({ proposals, now }),
      reviseReceipt: new ReviseReceipt({ proposals, now }),
      reviseInstallments: new ReviseInstallments({ proposals, now }),
      rejectProposal: new RejectProposal({ proposals }),
      // DEC-208: the identifiers are the text of the document until a formal
      // registry exists; that is the only thing to change here then.
      readProposalPdf: new ProposalPdfReader({ identify: identifyByText }),
      getProposal: new GetProposal({ proposals }),
      getProposalSourceDocument: new GetProposalSourceDocument({ proposals, documents }),
      listProposals: new ListProposals({ proposals }),
      registerPolicy: new RegisterPolicy({
        proposals,
        policies,
        documents,
        transaction,
        agreedCommission,
        notifier,
        newId,
        now,
      }),
      getPolicy: new GetPolicy({ proposals, policies }),
      getPolicyByProposal: new GetPolicyByProposal({ proposals, policies }),
      attachPolicyDocument: new AttachPolicyDocument({
        proposals,
        policies,
        documents,
        newId,
        now,
      }),
      getPolicyDocument: new GetPolicyDocument({ policies, documents }),
      listPolicies: new ListPolicies({ policies, proposals, references }),
      payInstallment: new PayInstallment({ proposals, policies, now }),
      getCommission: new GetCommission({ commissions }),
      listCommissions: new ListCommissions({ commissions, policies, proposals, references }),
      overrideCommission: new OverrideCommission({ commissions, now }),
      getPolicyPayout: new GetPolicyPayout({ policies, proposals, payouts }),
      informPayoutRate: new InformPayoutRate({ policies, proposals, payouts, newId, now }),
      revisePayoutRate: new RevisePayoutRate({ policies, proposals, payouts, newId, now }),
      declarePayoutEligibility: new DeclarePayoutEligibility({
        policies,
        proposals,
        payouts,
        newId,
        now,
      }),
      listEligiblePayouts: new ListEligiblePayouts({ policies, payouts }),
      listPoliciesWithoutPayoutRate: new ListPoliciesWithoutPayoutRate({
        policies,
        proposals,
        payouts,
      }),
      // V2 section 9B: the payout of a policy with parcelled CT.
      getParcelledPayout: new GetParcelledPayout({ policies, proposals, parcelledPayouts }),
      informParcelledPayoutRates: new InformParcelledPayoutRates({
        policies,
        proposals,
        parcelledPayouts,
        newId,
        now,
      }),
      reviseParcelledPayoutRates: new ReviseParcelledPayoutRates({
        policies,
        proposals,
        parcelledPayouts,
        newId,
        now,
      }),
      declareInstallmentEligibility: new DeclareInstallmentEligibility({
        policies,
        proposals,
        parcelledPayouts,
        newId,
        now,
      }),
      listParcelledPolicies: new ListParcelledPolicies({ policies, proposals, parcelledPayouts }),
      // IN-01: the reference records every listing above resolves names from.
      registerReference: new RegisterReference({ references, now }),
      listReferences: new ListReferences({ references }),
      // OUT-10, REQ-105: what was notified, to whom and when.
      listNotifications: new ListNotifications({ notifications }),
      // V2 section 9C: access to the system.
      issueFirstAdministratorInvitation: new IssueFirstAdministratorInvitation({
        users,
        invitations,
        secrets,
        newId,
        now,
      }),
      acceptInvitation: new AcceptInvitation({
        users,
        invitations,
        hasher,
        secrets,
        transaction,
        newId,
        now,
      }),
      logIn: new LogIn({ users, sessions, hasher, secrets, newId, now }),
      logOut: new LogOut({ sessions, secrets, now }),
      resolveSession: new ResolveSession({ users, sessions, secrets, now }),
    },
    shutdown,
  };
}

interface Persistence {
  readonly proposals: ProposalRepository;
  readonly policies: PolicyRepository;
  readonly commissions: CommissionRepository;
  readonly payouts: PayoutCommissionRepository;
  readonly parcelledPayouts: ParcelledPayoutRepository;
  readonly references: ReferenceRepository;
  readonly documents: SourceDocumentStorage;
  readonly notifications: NotificationRepository;
  readonly users: UserRepository;
  readonly invitations: InvitationRepository;
  readonly sessions: SessionRepository;
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
        payouts: new InMemoryPayoutCommissionRepository(),
        parcelledPayouts: new InMemoryParcelledPayoutRepository(),
        references: new InMemoryReferenceRepository(),
        documents: new InMemoryDocumentStorage(),
        notifications: new InMemoryNotificationRepository(),
        users: new InMemoryUserRepository(),
        invitations: new InMemoryInvitationRepository(),
        sessions: new InMemorySessionRepository(),
        transaction: new ImmediateTransaction(),
        shutdown: async () => {},
      };

    case 'sqlite': {
      const db = openSqlite(config.persistence.file);
      return {
        proposals: new SqliteProposalRepository(db),
        policies: new SqlitePolicyRepository(db),
        commissions: new SqliteCommissionRepository(db),
        payouts: new SqlitePayoutCommissionRepository(db),
        parcelledPayouts: new SqliteParcelledPayoutRepository(db),
        references: new SqliteReferenceRepository(db),
        documents: new SqliteDocumentStorage(db),
        notifications: new SqliteNotificationRepository(db),
        users: new SqliteUserRepository(db),
        invitations: new SqliteInvitationRepository(db),
        sessions: new SqliteSessionRepository(db),
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
