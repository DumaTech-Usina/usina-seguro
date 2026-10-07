import { Authorship } from './authorship.ts';
import type { CalendarDate } from './calendar-date.ts';
import { BusinessRuleViolation, PROPOSAL_MESSAGES } from './errors.ts';
import {
  type ExpectedInstallmentReceipt,
  type ExpectedReceipt,
  commissionBase,
  expectedInstallmentReceipts,
  expectedReceipt,
} from './expected-receipt.ts';
import type { Money } from './money.ts';
import type { Percentage } from './percentage.ts';
import type { Receipt, ReceiptDeclaration } from './receipt.ts';
import type { WorkedCommission, WorkedCommissionMode } from './worked-commission.ts';

/**
 * Proposal states (REQ-250).
 *
 * ```
 * AWAITING_ISSUANCE ──► ISSUED     (recognised; originates the policy)
 *                   └─► REJECTED   (reason required; final; no policy)
 * ```
 *
 * The identifiers are English; the Portuguese names the business uses
 * (aguardando emissao, emitida, recusada) are a presentation concern.
 */
export type ProposalStatus = 'AWAITING_ISSUANCE' | 'ISSUED' | 'REJECTED';

/**
 * REQ-204: one installment — its amount, and its due date when informed. The
 * number is its position in the list, starting at 1.
 */
export interface ProposalInstallment {
  readonly amount: Money;
  readonly dueDate: CalendarDate | null;
}

/**
 * REQ-254: one version of the installment list — the one informed at
 * registration, or one "Corrigir parcelas" — with who signed it and when. The
 * earlier versions stay (REQ-124).
 */
export interface InstallmentSchedule {
  readonly installments: readonly ProposalInstallment[];
  readonly informed: Authorship;
}

/**
 * REQ-219: the PDF the proposal was imported from. The bytes live in a
 * document store; the proposal keeps which document it is and its name.
 */
export interface ProposalSourceDocument {
  readonly documentId: string;
  readonly fileName: string;
}

/**
 * What the proposal holds from its registration on and never changes
 * (REQ-261, REJ-211): the commercial data (REQ-201) and the standardized data
 * (REQ-202), all informed at registration (REQ-206). The installments are not
 * here: they may be corrected before issuance (REQ-254).
 *
 * The product-specific data of REQ-205 is absent: its catalogue is `DEC-201`.
 */
export interface ProposalRegistrationData {
  readonly id: string;
  readonly clientId: string;
  readonly brokerId: string;
  readonly insurerId: string;
  readonly productId: string;
  readonly paymentMethodId: string;
  /** REQ-202, REQ-206: issued by the insurer and already known at registration. */
  readonly proposalNumber: string;
  readonly netPremium: Money;
  readonly coverageStart: CalendarDate;
  readonly coverageEnd: CalendarDate;
  /** REQ-219: absent when the proposal was typed by hand. */
  readonly sourceDocument?: ProposalSourceDocument | null;
  readonly registeredAt: Date;
}

/**
 * Everything needed to register: the immutable data plus the first CT and the
 * first receipt declaration, both signed by whoever registers (REQ-215,
 * REQ-223).
 */
export interface ProposalRegistration extends ProposalRegistrationData {
  /** REQ-204: may be empty with an integral CT (REQ-202), at least two with a parcelled one (REQ-292). */
  readonly installments: readonly ProposalInstallment[];
  /** The CT; with a parcelled CT, the CT of the first installment (REQ-291). */
  readonly workedCommission: Percentage;
  /** REQ-291: the CT of the subsequent installments, only with a parcelled CT. */
  readonly subsequentWorkedCommission?: Percentage | null;
  readonly workedCommissionMode: WorkedCommissionMode;
  readonly receipt: Receipt;
  readonly registeredBy: string;
}

/** What the proposal accumulated after registration. */
export interface ProposalState {
  readonly status: ProposalStatus;
  /** Oldest first; never empty. */
  readonly workedCommissionHistory: readonly WorkedCommission[];
  /** Oldest first; never empty. */
  readonly receiptHistory: readonly ReceiptDeclaration[];
  /** REQ-254: oldest first; never empty — the first entry is the registration's. */
  readonly installmentHistory: readonly InstallmentSchedule[];
  readonly rejectionReason?: string | null;
  /** REQ-209: present exactly when the issuance was recognised. */
  readonly issuanceRecognition?: Authorship | null;
}

export class Proposal {
  readonly id: string;
  readonly clientId: string;
  readonly brokerId: string;
  readonly insurerId: string;
  readonly productId: string;
  readonly paymentMethodId: string;
  readonly proposalNumber: string;
  readonly netPremium: Money;
  readonly coverageStart: CalendarDate;
  readonly coverageEnd: CalendarDate;
  readonly sourceDocument: ProposalSourceDocument | null;
  readonly registeredAt: Date;
  readonly status: ProposalStatus;
  readonly workedCommissionHistory: readonly WorkedCommission[];
  readonly receiptHistory: readonly ReceiptDeclaration[];
  readonly installmentHistory: readonly InstallmentSchedule[];
  /** REQ-253: present exactly when the proposal was refused. */
  readonly rejectionReason: string | null;
  /** REQ-209, CA-207: who identified the issuance, and when it was recorded. */
  readonly issuanceRecognition: Authorship | null;

  private constructor(data: ProposalRegistrationData, state: ProposalState) {
    this.id = data.id;
    this.clientId = data.clientId;
    this.brokerId = data.brokerId;
    this.insurerId = data.insurerId;
    this.productId = data.productId;
    this.paymentMethodId = data.paymentMethodId;
    this.proposalNumber = data.proposalNumber;
    this.netPremium = data.netPremium;
    this.coverageStart = data.coverageStart;
    this.coverageEnd = data.coverageEnd;
    this.sourceDocument = data.sourceDocument ?? null;
    this.registeredAt = data.registeredAt;
    this.status = state.status;
    this.workedCommissionHistory = state.workedCommissionHistory;
    this.receiptHistory = state.receiptHistory;
    this.installmentHistory = state.installmentHistory;
    this.rejectionReason = state.rejectionReason ?? null;
    this.issuanceRecognition = state.issuanceRecognition ?? null;
  }

  /**
   * FP-01 steps 1 to 4: registers the proposal with every datum REQ-202
   * requires, the CT with its mode, and the receipt declaration. It starts
   * awaiting issuance (FP-01 step 6).
   *
   * Every datum is mandatory except the installments (REQ-202). The number is
   * not checked for uniqueness: `DEC-207` leaves it unrestricted for now.
   */
  static register(input: ProposalRegistration): Proposal {
    if (input.paymentMethodId.trim() === '') {
      throw new BusinessRuleViolation('REQ-040', PROPOSAL_MESSAGES.PAYMENT_METHOD_REQUIRED);
    }

    for (const [field, value] of [
      ['clientId', input.clientId],
      ['brokerId', input.brokerId],
      ['insurerId', input.insurerId],
      ['productId', input.productId],
    ] as const) {
      if (value.trim() === '') {
        throw new BusinessRuleViolation('REQ-201', PROPOSAL_MESSAGES.FIELD_REQUIRED, { field });
      }
    }

    const proposalNumber = input.proposalNumber.trim();

    if (proposalNumber === '') {
      throw new BusinessRuleViolation('REQ-202', PROPOSAL_MESSAGES.PROPOSAL_NUMBER_REQUIRED);
    }

    // REQ-217, CA-218: zero or negative is refused.
    if (!input.netPremium.isPositive()) {
      throw new BusinessRuleViolation('REQ-217', PROPOSAL_MESSAGES.NET_PREMIUM_MUST_BE_POSITIVE);
    }

    // REQ-202, REJ-214: the coverage ends after it starts.
    if (!input.coverageStart.isBefore(input.coverageEnd)) {
      throw new BusinessRuleViolation('REQ-202', PROPOSAL_MESSAGES.COVERAGE_END_MUST_FOLLOW_START, {
        start: input.coverageStart.toString(),
        end: input.coverageEnd.toString(),
      });
    }

    assertInstallmentsWorthSomething(input.installments);

    const signed = Authorship.of(input.registeredBy, input.registeredAt);
    const workedCommission: WorkedCommission = {
      rate: input.workedCommission,
      mode: input.workedCommissionMode,
      subsequentRate: input.subsequentWorkedCommission ?? null,
      informed: signed,
    };

    assertModeConsistent(workedCommission, input.installments, input.receipt);

    return new Proposal(
      { ...input, proposalNumber },
      {
        status: 'AWAITING_ISSUANCE',
        workedCommissionHistory: [workedCommission],
        receiptHistory: [{ receipt: input.receipt, declared: signed }],
        installmentHistory: [{ installments: input.installments, informed: signed }],
      },
    );
  }

  /**
   * Rebuilds a proposal from persisted data without re-applying the creation
   * rules: a record stored in the past cannot be invalidated by a rule created
   * afterwards (REQ-124).
   */
  static restore(data: ProposalRegistrationData, state: ProposalState): Proposal {
    return new Proposal(data, state);
  }

  /** REQ-203, CA-206: the renewal is the end of coverage, never informed apart. */
  get renewalDate(): CalendarDate {
    return this.coverageEnd;
  }

  /** The CT in force: the last one informed (REQ-214). */
  get workedCommission(): Percentage {
    return this.currentWorkedCommission().rate;
  }

  get workedCommissionMode(): WorkedCommissionMode {
    return this.currentWorkedCommission().mode;
  }

  /** REQ-291: the CT of the subsequent installments; `null` with an integral CT. */
  get subsequentWorkedCommission(): Percentage | null {
    return this.currentWorkedCommission().subsequentRate ?? null;
  }

  /** REQ-254: the installments in force — the last list informed. */
  get installments(): readonly ProposalInstallment[] {
    return (this.installmentHistory[this.installmentHistory.length - 1] as InstallmentSchedule)
      .installments;
  }

  /** The receipt in force: the last one declared (REQ-225). */
  get receipt(): Receipt {
    return this.currentReceipt().receipt;
  }

  /**
   * REQ-232, CA-203: what the Usina expects, visible before issuance — with an
   * integral CT. A parcelled CT has no total (REQ-293, REJ-232): its expected
   * value is per installment (`expectedInstallmentReceipts`).
   */
  expectedReceipt(): ExpectedReceipt {
    if (this.workedCommissionMode !== 'INTEGRAL') {
      throw new Error('A parcelled CT has no total expected value (REQ-293, REJ-232).');
    }

    return expectedReceipt(
      commissionBase(this.netPremium, this.workedCommissionMode),
      this.workedCommission,
      this.receipt,
    );
  }

  /**
   * REQ-293, CA-246: with a parcelled CT, what the Usina expects from each
   * installment; `null` with an integral CT, whose expected value is one
   * (`expectedReceipt`).
   */
  expectedInstallmentReceipts(): ExpectedInstallmentReceipt[] | null {
    const subsequent = this.subsequentWorkedCommission;

    if (this.workedCommissionMode !== 'PARCELLED' || subsequent === null) {
      return null;
    }

    return expectedInstallmentReceipts(this.installments, this.workedCommission, subsequent);
  }

  /**
   * REQ-214, FA-203, CA-217: corrects the CT and its mode before issuance. The
   * correction is a new signed entry; the earlier ones stay (REQ-215, REQ-124).
   * With a parcelled CT both CTs are corrected together (REQ-297), and the
   * switch to parcelled needs a direct receipt and two installments (REQ-299).
   */
  reviseWorkedCommission(entry: WorkedCommission): Proposal {
    this.ensureAwaitingIssuance();

    const normalized = { ...entry, subsequentRate: entry.subsequentRate ?? null };
    assertModeConsistent(normalized, this.installments, this.receipt);

    return this.with({ workedCommissionHistory: [...this.workedCommissionHistory, normalized] });
  }

  /**
   * REQ-254, FA-224, CA-261: the installments corrected before issuance —
   * included, altered or removed — in either mode. The new list is a signed
   * entry; the earlier ones stay (REQ-124). A parcelled proposal keeps at least
   * two (REQ-292).
   */
  reviseInstallments(schedule: InstallmentSchedule): Proposal {
    this.ensureAwaitingIssuance();
    assertInstallmentsWorthSomething(schedule.installments);
    assertModeConsistent(this.currentWorkedCommission(), schedule.installments, this.receipt);

    return this.with({ installmentHistory: [...this.installmentHistory, schedule] });
  }

  /**
   * REQ-225, FA-204, FA-209: declares, replaces or removes the intermediary
   * before issuance. A new signed declaration; the earlier ones stay (REQ-223,
   * REQ-124).
   */
  reviseReceipt(declaration: ReceiptDeclaration): Proposal {
    this.ensureAwaitingIssuance();
    // REQ-296, EX-207: a parcelled commission is never received through an intermediary.
    assertModeConsistent(this.currentWorkedCommission(), this.installments, declaration.receipt);

    return this.with({ receiptHistory: [...this.receiptHistory, declaration] });
  }

  /**
   * REQ-253, FA-208: the insurer did not issue the proposal. The reason is
   * mandatory (REJ-208, EX-203), the refusal is final (REJ-212) and the record
   * stays consultable.
   */
  reject(reason: string): Proposal {
    this.ensureAwaitingIssuance();

    const trimmed = reason.trim();

    if (trimmed === '') {
      throw new BusinessRuleViolation('REQ-253', PROPOSAL_MESSAGES.REJECTION_REASON_REQUIRED);
    }

    return this.with({ status: 'REJECTED', rejectionReason: trimmed });
  }

  /**
   * REQ-209, FP-01 step 8: a user identified in the insurer's system that the
   * proposal was issued. The signature carries who identified it and the
   * moment it was recorded — the real issuance instant is unknown to the
   * Usina. Recognising is the same act that creates the policy (REQ-240), so
   * the proposal becomes ISSUED (REQ-251) and is frozen from then on (REQ-244).
   *
   * A refused proposal originates no policy (REJ-210) and a proposal
   * originates at most one (REQ-049).
   */
  recognizeIssuance(recognized: Authorship): Proposal {
    if (this.status === 'ISSUED') {
      throw new BusinessRuleViolation('REQ-049', PROPOSAL_MESSAGES.ALREADY_HAS_POLICY);
    }

    if (this.status === 'REJECTED') {
      throw new BusinessRuleViolation(
        'REQ-253',
        PROPOSAL_MESSAGES.REJECTED_CANNOT_ORIGINATE_POLICY,
      );
    }

    return this.with({ status: 'ISSUED', issuanceRecognition: recognized });
  }

  /**
   * REQ-252: only a proposal awaiting issuance changes. Once issued it is
   * frozen (REQ-244, REQ-260); once refused it is final (REQ-253).
   */
  private ensureAwaitingIssuance(): void {
    if (this.status === 'ISSUED') {
      throw new BusinessRuleViolation('REQ-260', PROPOSAL_MESSAGES.ISSUED_PROPOSAL_IS_FROZEN);
    }

    if (this.status === 'REJECTED') {
      throw new BusinessRuleViolation('REQ-253', PROPOSAL_MESSAGES.REJECTED_PROPOSAL_IS_FINAL);
    }
  }

  private currentWorkedCommission(): WorkedCommission {
    return this.workedCommissionHistory[
      this.workedCommissionHistory.length - 1
    ] as WorkedCommission;
  }

  private currentReceipt(): ReceiptDeclaration {
    return this.receiptHistory[this.receiptHistory.length - 1] as ReceiptDeclaration;
  }

  private with(changes: Partial<ProposalState>): Proposal {
    return new Proposal(this, {
      status: this.status,
      workedCommissionHistory: this.workedCommissionHistory,
      receiptHistory: this.receiptHistory,
      installmentHistory: this.installmentHistory,
      rejectionReason: this.rejectionReason,
      issuanceRecognition: this.issuanceRecognition,
      ...changes,
    });
  }
}

/** REQ-204, REJ-215: every installment is worth something. */
function assertInstallmentsWorthSomething(installments: readonly ProposalInstallment[]): void {
  installments.forEach((installment, index) => {
    if (!installment.amount.isPositive()) {
      throw new BusinessRuleViolation(
        'REQ-204',
        PROPOSAL_MESSAGES.INSTALLMENT_AMOUNT_MUST_BE_POSITIVE,
        {
          number: String(index + 1),
        },
      );
    }
  });
}

/**
 * The CT, the installments and the receipt fit the mode (REQ-290):
 *
 * - integral: one CT, within 100% (REQ-291, REQ-121);
 * - parcelled: two CTs, no ceiling for now (REQ-291, REQ-295), at least two
 *   installments (REQ-292) and no intermediary (REQ-296).
 *
 * Checked on every change of any of the three, so no sequence of corrections
 * reaches a combination the registration would refuse (REQ-299).
 */
function assertModeConsistent(
  workedCommission: WorkedCommission,
  installments: readonly ProposalInstallment[],
  receipt: Receipt,
): void {
  const subsequent = workedCommission.subsequentRate ?? null;

  if (workedCommission.mode === 'INTEGRAL') {
    if (subsequent !== null) {
      throw new BusinessRuleViolation('REQ-291', PROPOSAL_MESSAGES.INTEGRAL_HAS_SINGLE_CT);
    }

    if (workedCommission.rate.exceedsHundred()) {
      throw new BusinessRuleViolation('REQ-121', PROPOSAL_MESSAGES.PERCENTAGE_OUT_OF_RANGE, {
        value: workedCommission.rate.toString(),
      });
    }

    return;
  }

  if (subsequent === null) {
    throw new BusinessRuleViolation('REQ-291', PROPOSAL_MESSAGES.PARCELLED_REQUIRES_SUBSEQUENT_CT);
  }

  if (installments.length < 2) {
    throw new BusinessRuleViolation(
      'REQ-292',
      PROPOSAL_MESSAGES.PARCELLED_REQUIRES_TWO_INSTALLMENTS,
    );
  }

  if (receipt.kind !== 'DIRECT') {
    throw new BusinessRuleViolation(
      'REQ-296',
      PROPOSAL_MESSAGES.PARCELLED_CANNOT_HAVE_INTERMEDIARY,
    );
  }
}
