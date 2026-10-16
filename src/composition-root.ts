import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import nodemailer from 'nodemailer';
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
import type { AccessMailer } from './core/identity/application/access-mailer.ts';
import { ChangeUserRole } from './core/identity/application/change-user-role.ts';
import { CreateUser } from './core/identity/application/create-user.ts';
import { DeactivateUser } from './core/identity/application/deactivate-user.ts';
import type { InvitationRepository } from './core/identity/application/invitation-repository.ts';
import { InviteUser } from './core/identity/application/invite-user.ts';
import { IssueFirstAdministratorInvitation } from './core/identity/application/issue-first-administrator-invitation.ts';
import { ListUserDirectory } from './core/identity/application/list-user-directory.ts';
import { ListUsers } from './core/identity/application/list-users.ts';
import { LogIn } from './core/identity/application/log-in.ts';
import { LogOut } from './core/identity/application/log-out.ts';
import type { PasswordResetRepository } from './core/identity/application/password-reset-repository.ts';
import { RequestPasswordReset } from './core/identity/application/request-password-reset.ts';
import { ResendInvitation } from './core/identity/application/resend-invitation.ts';
import { ResetPassword } from './core/identity/application/reset-password.ts';
import { ResolveSession } from './core/identity/application/resolve-session.ts';
import type { RoleChangeRepository } from './core/identity/application/role-change-repository.ts';
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
import type { BrokerRepository } from './core/registry/application/broker-repository.ts';
import { ChangeBroker } from './core/registry/application/change-broker.ts';
import { ChangeClient } from './core/registry/application/change-client.ts';
import type { ClientRepository } from './core/registry/application/client-repository.ts';
import { GetBroker } from './core/registry/application/get-broker.ts';
import { GetClient } from './core/registry/application/get-client.ts';
import { ListBrokers } from './core/registry/application/list-brokers.ts';
import { ListClients, searchClients } from './core/registry/application/list-clients.ts';
import { ListReferences } from './core/registry/application/list-references.ts';
import type { ReferenceRepository } from './core/registry/application/reference-repository.ts';
import { RegisterBroker } from './core/registry/application/register-broker.ts';
import { RegisterClient } from './core/registry/application/register-client.ts';
import { RegisterReference } from './core/registry/application/register-reference.ts';
import { ResolveClient } from './core/registry/application/resolve-client.ts';
import {
  InMemoryAccessMailer,
  type SentAccessMail,
} from './infrastructure/email/in-memory-access-mailer.ts';
import { LogAccessMailer } from './infrastructure/email/log-access-mailer.ts';
import { SmtpAccessMailer } from './infrastructure/email/smtp-access-mailer.ts';
import { ProposalPdfReader, identifyByText } from './infrastructure/pdf/proposal-pdf-reader.ts';
import { ImmediateTransaction } from './infrastructure/persistence/in-memory/immediate-transaction.ts';
import { InMemoryBrokerRepository } from './infrastructure/persistence/in-memory/in-memory-broker-repository.ts';
import { InMemoryClientRepository } from './infrastructure/persistence/in-memory/in-memory-client-repository.ts';
import { InMemoryCommissionRepository } from './infrastructure/persistence/in-memory/in-memory-commission-repository.ts';
import { InMemoryDocumentStorage } from './infrastructure/persistence/in-memory/in-memory-document-storage.ts';
import { InMemoryInvitationRepository } from './infrastructure/persistence/in-memory/in-memory-invitation-repository.ts';
import { InMemoryNotificationRepository } from './infrastructure/persistence/in-memory/in-memory-notification-repository.ts';
import { InMemoryParcelledPayoutRepository } from './infrastructure/persistence/in-memory/in-memory-parcelled-payout-repository.ts';
import { InMemoryPasswordResetRepository } from './infrastructure/persistence/in-memory/in-memory-password-reset-repository.ts';
import { InMemoryPayoutCommissionRepository } from './infrastructure/persistence/in-memory/in-memory-payout-commission-repository.ts';
import { InMemoryPolicyRepository } from './infrastructure/persistence/in-memory/in-memory-policy-repository.ts';
import { InMemoryProposalRepository } from './infrastructure/persistence/in-memory/in-memory-proposal-repository.ts';
import { InMemoryReferenceRepository } from './infrastructure/persistence/in-memory/in-memory-reference-repository.ts';
import { InMemoryRoleChangeRepository } from './infrastructure/persistence/in-memory/in-memory-role-change-repository.ts';
import { InMemorySessionRepository } from './infrastructure/persistence/in-memory/in-memory-session-repository.ts';
import { InMemoryUserRepository } from './infrastructure/persistence/in-memory/in-memory-user-repository.ts';
import { SqliteBrokerRepository } from './infrastructure/persistence/sqlite/sqlite-broker-repository.ts';
import { SqliteClientRepository } from './infrastructure/persistence/sqlite/sqlite-client-repository.ts';
import { SqliteCommissionRepository } from './infrastructure/persistence/sqlite/sqlite-commission-repository.ts';
import { openSqliteConnection } from './infrastructure/persistence/sqlite/sqlite-connection.ts';
import { SqliteDocumentStorage } from './infrastructure/persistence/sqlite/sqlite-document-storage.ts';
import { SqliteInvitationRepository } from './infrastructure/persistence/sqlite/sqlite-invitation-repository.ts';
import { SqliteNotificationRepository } from './infrastructure/persistence/sqlite/sqlite-notification-repository.ts';
import { SqliteParcelledPayoutRepository } from './infrastructure/persistence/sqlite/sqlite-parcelled-payout-repository.ts';
import { SqlitePasswordResetRepository } from './infrastructure/persistence/sqlite/sqlite-password-reset-repository.ts';
import { SqlitePayoutCommissionRepository } from './infrastructure/persistence/sqlite/sqlite-payout-commission-repository.ts';
import { SqlitePolicyRepository } from './infrastructure/persistence/sqlite/sqlite-policy-repository.ts';
import { SqliteProposalRepository } from './infrastructure/persistence/sqlite/sqlite-proposal-repository.ts';
import { SqliteReferenceRepository } from './infrastructure/persistence/sqlite/sqlite-reference-repository.ts';
import { SqliteRoleChangeRepository } from './infrastructure/persistence/sqlite/sqlite-role-change-repository.ts';
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
  /** V2 section 9D: the brokers. There is no removal (REQ-305). */
  readonly registerBroker: RegisterBroker;
  readonly changeBroker: ChangeBroker;
  readonly getBroker: GetBroker;
  readonly listBrokers: ListBrokers;
  /** V2 section 9E: the clients. There is no removal (REQ-315). */
  readonly registerClient: RegisterClient;
  readonly changeClient: ChangeClient;
  readonly getClient: GetClient;
  readonly listClients: ListClients;
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
  /** REQ-216: the ids that sign the records, with the name to show for each. */
  readonly listUserDirectory: ListUserDirectory;
  /** REQ-407: run by a command on the server, never over HTTP. */
  readonly createUser: CreateUser;
  /** REQ-440: the administrator's management of users. */
  readonly listUsers: ListUsers;
  readonly inviteUser: InviteUser;
  readonly resendInvitation: ResendInvitation;
  readonly deactivateUser: DeactivateUser;
  readonly changeUserRole: ChangeUserRole;
  /** REQ-425, REQ-426: "Esqueci a senha". */
  readonly requestPasswordReset: RequestPasswordReset;
  readonly resetPassword: ResetPassword;
}

export interface Application {
  readonly useCases: UseCases;
  /**
   * The e-mails of access kept in memory, when `EMAIL_DRIVER=memory` — the
   * tests read the links there. `null` with any other driver.
   */
  readonly outbox: readonly SentAccessMail[] | null;
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
    brokers,
    clients,
    documents,
    notifications,
    users,
    invitations,
    sessions,
    roleChanges,
    resets,
    transaction,
    shutdown,
  } = composePersistence(config);
  const { mailer, outbox } = composeMailer(config);
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
    brokers,
    clients,
    channels: [] as readonly NotificationChannel[],
    newId,
  });

  // REQ-307: the proposal module asks only whether an id is a registered
  // broker; the registry answers it here.
  const registeredBrokers = {
    isRegistered: async (brokerId: string) => (await brokers.findById(brokerId)) !== null,
  };

  // REQ-229: the proposal module asks only whether an id is a registered
  // intermediary; the reference registry answers it here.
  const registeredIntermediaries = {
    isRegistered: async (intermediaryId: string) =>
      (await references.list({ kind: 'INTERMEDIARY' })).some(
        (reference) => reference.id === intermediaryId,
      ),
  };

  // REQ-317, REQ-319: the proposal module asks for the client of a CPF and for
  // the clients a search term matches; the registry answers both here.
  const resolveClient = new ResolveClient({ clients, newId, now });
  const proposalClients = {
    resolve: (client: { name: string; cpf: string }, author: string) =>
      resolveClient.execute({ name: client.name, cpf: client.cpf, userId: author }),
    matching: async (query: string) =>
      new Set((await searchClients(clients, query)).map((client) => client.id)),
  };

  return {
    useCases: {
      // REQ-219: the imported PDF is kept with the proposal.
      registerProposal: new RegisterProposal({
        proposals,
        documents,
        brokers: registeredBrokers,
        intermediaries: registeredIntermediaries,
        clients: proposalClients,
        transaction,
        newId,
        now,
      }),
      reviseWorkedCommission: new ReviseWorkedCommission({ proposals, now }),
      reviseReceipt: new ReviseReceipt({
        proposals,
        intermediaries: registeredIntermediaries,
        now,
      }),
      reviseInstallments: new ReviseInstallments({ proposals, now }),
      rejectProposal: new RejectProposal({ proposals }),
      // DEC-208: the identifiers are the text of the document until a formal
      // registry exists; that is the only thing to change here then.
      readProposalPdf: new ProposalPdfReader({ identify: identifyByText }),
      getProposal: new GetProposal({ proposals }),
      getProposalSourceDocument: new GetProposalSourceDocument({ proposals, documents }),
      listProposals: new ListProposals({ proposals, clients: proposalClients }),
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
      listPolicies: new ListPolicies({ policies, proposals, references, clients }),
      payInstallment: new PayInstallment({ proposals, policies, now }),
      getCommission: new GetCommission({ commissions }),
      listCommissions: new ListCommissions({
        commissions,
        policies,
        proposals,
        references,
        clients,
      }),
      overrideCommission: new OverrideCommission({ commissions, now }),
      getPolicyPayout: new GetPolicyPayout({ policies, proposals, payouts }),
      informPayoutRate: new InformPayoutRate({ policies, proposals, payouts, newId, now }),
      revisePayoutRate: new RevisePayoutRate({ policies, proposals, payouts, newId, now }),
      declarePayoutEligibility: new DeclarePayoutEligibility({
        policies,
        proposals,
        payouts,
        brokers,
        clients,
        newId,
        now,
      }),
      listEligiblePayouts: new ListEligiblePayouts({ policies, payouts }),
      listPoliciesWithoutPayoutRate: new ListPoliciesWithoutPayoutRate({
        policies,
        proposals,
        payouts,
        clients,
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
        brokers,
        clients,
        newId,
        now,
      }),
      listParcelledPolicies: new ListParcelledPolicies({
        policies,
        proposals,
        parcelledPayouts,
        clients,
      }),
      // IN-01: the reference records every listing above resolves names from.
      registerReference: new RegisterReference({ references, now }),
      listReferences: new ListReferences({ references }),
      // V2 section 9D: the brokers, signed by the session's user (REQ-304).
      registerBroker: new RegisterBroker({ brokers, newId, now }),
      changeBroker: new ChangeBroker({ brokers, now }),
      getBroker: new GetBroker({ brokers }),
      listBrokers: new ListBrokers({ brokers }),
      // V2 section 9E: the clients, signed by the session's user (REQ-314).
      registerClient: new RegisterClient({ clients, newId, now }),
      changeClient: new ChangeClient({ clients, now }),
      getClient: new GetClient({ clients }),
      listClients: new ListClients({ clients }),
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
      listUserDirectory: new ListUserDirectory({ users }),
      createUser: new CreateUser({ users, hasher, newId, now }),
      listUsers: new ListUsers({ users, invitations }),
      inviteUser: new InviteUser({ users, invitations, secrets, mailer, newId, now }),
      resendInvitation: new ResendInvitation({ users, invitations, secrets, mailer, newId, now }),
      deactivateUser: new DeactivateUser({ users, sessions, now }),
      changeUserRole: new ChangeUserRole({ users, roleChanges, newId, now }),
      requestPasswordReset: new RequestPasswordReset({
        users,
        resets,
        secrets,
        mailer,
        newId,
        now,
      }),
      resetPassword: new ResetPassword({
        users,
        resets,
        sessions,
        hasher,
        secrets,
        transaction,
        now,
      }),
    },
    outbox,
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
  readonly brokers: BrokerRepository;
  readonly clients: ClientRepository;
  readonly documents: SourceDocumentStorage;
  readonly notifications: NotificationRepository;
  readonly users: UserRepository;
  readonly invitations: InvitationRepository;
  readonly sessions: SessionRepository;
  readonly roleChanges: RoleChangeRepository;
  readonly resets: PasswordResetRepository;
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
        brokers: new InMemoryBrokerRepository(),
        clients: new InMemoryClientRepository(),
        documents: new InMemoryDocumentStorage(),
        notifications: new InMemoryNotificationRepository(),
        users: new InMemoryUserRepository(),
        invitations: new InMemoryInvitationRepository(),
        sessions: new InMemorySessionRepository(),
        roleChanges: new InMemoryRoleChangeRepository(),
        resets: new InMemoryPasswordResetRepository(),
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
        brokers: new SqliteBrokerRepository(db),
        clients: new SqliteClientRepository(db),
        documents: new SqliteDocumentStorage(db),
        notifications: new SqliteNotificationRepository(db),
        users: new SqliteUserRepository(db),
        invitations: new SqliteInvitationRepository(db),
        sessions: new SqliteSessionRepository(db),
        roleChanges: new SqliteRoleChangeRepository(db),
        resets: new SqlitePasswordResetRepository(db),
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

/**
 * REQ-435, REQ-436: how the e-mails of access leave. The SMTP credentials come
 * from the environment; until they do, the e-mails are written to the output.
 */
function composeMailer(config: Config): {
  mailer: AccessMailer;
  outbox: readonly SentAccessMail[] | null;
} {
  const { email } = config;
  const publicUrl = config.http.publicUrl;

  switch (email.driver) {
    case 'smtp':
      return {
        mailer: new SmtpAccessMailer(
          nodemailer.createTransport({
            host: email.host,
            port: email.port,
            secure: email.secure,
            ...(email.user === null
              ? {}
              : { auth: { user: email.user, pass: email.password ?? '' } }),
          }),
          { from: email.from, publicUrl },
        ),
        outbox: null,
      };
    case 'memory': {
      const mailer = new InMemoryAccessMailer({ delivers: true });
      return { mailer, outbox: mailer.sent };
    }
    case 'log':
      return { mailer: new LogAccessMailer((line) => console.log(line), publicUrl), outbox: null };
  }
}

function openSqlite(file: string): DatabaseSync {
  if (file !== ':memory:') {
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  return openSqliteConnection(file);
}
