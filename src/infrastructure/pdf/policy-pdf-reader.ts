import { extractText, getDocumentProxy } from 'unpdf';
import { POLICY_NUMBER_LABELS } from './policy-number-labels.ts';

/**
 * Reads the PDF of a policy to fill the policy number of the recognition of
 * issuance (REQ-248).
 *
 * Like the proposal reading (REQ-218), an aid to filling the form, never a
 * source of truth: it saves nothing and decides nothing. The user reviews the
 * number and recognises the issuance the normal way. Nothing else of the
 * document is read or checked (DEC-213).
 *
 * It does not depend on a layout: the number is looked for by the labels
 * insurers print it under (`POLICY_NUMBER_LABELS`), so a new format — of a new
 * insurer or of a known one — is served by extending that dictionary. It is
 * conservative: a number printed more than once is taken only when every
 * occurrence agrees; anything else is left absent, never estimated.
 */

/** The fields this reader can fill, named as the issuance form names them. */
export const POLICY_PDF_FIELDS = ['policyNumber'] as const;

export type PolicyPdfField = (typeof POLICY_PDF_FIELDS)[number];

export interface PolicyPdfFields {
  /** As printed, separators included. */
  policyNumber?: string;
}

/**
 * - `SUCCESS`: every field above was found.
 * - `PARTIAL`: the document was read and some field was not found; `missing`
 *   says which.
 * - `FAILED`: the document could not be read, or has no text in it.
 */
export type PolicyPdfReading =
  | {
      readonly status: 'SUCCESS' | 'PARTIAL';
      readonly fields: PolicyPdfFields;
      readonly missing: readonly PolicyPdfField[];
    }
  | {
      readonly status: 'FAILED';
      readonly reason: 'UNREADABLE' | 'NO_TEXT';
      readonly fields: PolicyPdfFields;
      readonly missing: readonly PolicyPdfField[];
    };

export class PolicyPdfReader {
  async read(bytes: Uint8Array): Promise<PolicyPdfReading> {
    let text: string;

    try {
      // Verbosity 0: pdf.js reports errors only; a failure still ends below.
      const document = await getDocumentProxy(bytes, { verbosity: 0 });
      text = (await extractText(document, { mergePages: true })).text;
    } catch {
      return failed('UNREADABLE');
    }

    return readPolicyText(text);
  }
}

/**
 * A label, then an optional `:` or `.`, then the number: letters and digits,
 * possibly separated by `.`, `-` or `/`, with at least one digit.
 */
const NUMBER =
  '(?=[\\p{L}\\p{N}.\\-/]*\\p{N})[\\p{L}\\p{N}](?:[\\p{L}\\p{N}.\\-/]*[\\p{L}\\p{N}])?';
const POLICY_NUMBER = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${POLICY_NUMBER_LABELS.join('|')})\\s*[:.]?\\s*(${NUMBER})`,
  'giu',
);

/** The fields of a policy, from the extracted text. Exported to test it on text. */
export function readPolicyText(text: string): PolicyPdfReading {
  if (text.trim() === '') {
    return failed('NO_TEXT');
  }

  const candidates: { [Field in PolicyPdfField]: PolicyPdfFields[Field] | undefined } = {
    policyNumber: agreed([...text.matchAll(POLICY_NUMBER)].map((match) => match[1] as string)),
  };

  const found = Object.fromEntries(
    Object.entries(candidates).filter(([, value]) => value !== undefined),
  ) as PolicyPdfFields;
  const missing = POLICY_PDF_FIELDS.filter((field) => found[field] === undefined);

  return { status: missing.length === 0 ? 'SUCCESS' : 'PARTIAL', fields: found, missing };
}

function failed(reason: 'UNREADABLE' | 'NO_TEXT'): PolicyPdfReading {
  return { status: 'FAILED', reason, fields: {}, missing: [...POLICY_PDF_FIELDS] };
}

/** A value printed more than once is taken only when every occurrence agrees. */
function agreed(values: readonly string[]): string | undefined {
  const [first] = values;
  return first !== undefined && values.every((value) => value === first) ? first : undefined;
}
