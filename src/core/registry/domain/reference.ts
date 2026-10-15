import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { REGISTRY_MESSAGES } from './errors.ts';

/**
 * The kinds of record IN-01 asks to be maintained.
 *
 * These are the entities the input names one by one — insurer, intermediary,
 * product — so the set is the requirement's, not a shape chosen here. The
 * broker and the client left this registry: each has a CPF and a signed
 * history of its own (`Broker`, V2 section 9D; `Client`, section 9E, REQ-320).
 * Two kinds the document also lists are absent on purpose:
 *
 * - **cobertura**: no confirmed rule reads a coverage anywhere in the system,
 *   so registering one would write rows nothing consumes;
 * - **forma de pagamento**: it is not in IN-01.
 */
export type ReferenceKind = 'INSURER' | 'INTERMEDIARY' | 'PRODUCT';

export const REFERENCE_KINDS: readonly ReferenceKind[] = ['INSURER', 'INTERMEDIARY', 'PRODUCT'];

export interface ReferenceData {
  readonly kind: ReferenceKind;
  /**
   * The identifier the rest of the system already stores (REQ-022): the same
   * string a proposal carries in `insurerId` or `productId`, and an agreement carries in `intermediaryId`.
   *
   * The registry does not hand out identifiers and nothing validates a
   * proposal against it. No requirement says a reference must exist before it
   * is used, and REQ-002 makes this system a reflection of a control that
   * happens outside it — a proposal whose client was never registered is a
   * proposal with no name to show, not a proposal to refuse.
   */
  readonly id: string;
  /** REQ-096: what the report and the receipt have to identify. */
  readonly name: string;
  readonly registeredAt: Date;
}

/**
 * A reference record the Administrator maintains (IN-01, ATR-003).
 *
 * One aggregate for the four kinds because the requirements give them exactly
 * the same content: an identifier the business already uses and a name. The
 * document says nothing else about any of them — no document number, no
 * address, no contact — and four files differing only in a word would be
 * structure nothing asks for. The day a requirement gives one of them a field
 * of its own, that kind becomes its own aggregate; `kind` is what keeps that
 * split cheap.
 *
 * `productId` doubles as the *ramo* REQ-096 and REQ-081 ask for: REQ-022 names
 * the field "produto/ramo", so the product's name is the ramo, and nothing
 * here invents a separate taxonomy.
 */
export class Reference {
  readonly kind: ReferenceKind;
  readonly id: string;
  readonly name: string;
  readonly registeredAt: Date;

  private constructor(data: ReferenceData) {
    this.kind = data.kind;
    this.id = data.id;
    this.name = data.name;
    this.registeredAt = data.registeredAt;
  }

  static register(data: ReferenceData): Reference {
    for (const [field, value] of [
      ['id', data.id],
      ['name', data.name],
    ] as const) {
      if (value.trim() === '') {
        // Cited as `IN-01` and not as a `REQ-*` because no requirement states
        // this rule: the input is what asks for the registry to exist, and a
        // record with no name is one REQ-096 could not print.
        throw new BusinessRuleViolation('IN-01', REGISTRY_MESSAGES.REFERENCE_FIELD_REQUIRED, {
          field,
        });
      }
    }

    // The identifier is stored trimmed, to match the reference already stored
    // on the proposal: the same care `Policy.register` takes with the policy
    // number, and for the same reason — it is what the two sides are matched by.
    return new Reference({ ...data, id: data.id.trim(), name: data.name.trim() });
  }

  /** Rebuilds a persisted reference without re-applying the rules (REQ-124). */
  static restore(data: ReferenceData): Reference {
    return new Reference(data);
  }
}
