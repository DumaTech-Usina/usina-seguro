import { extractText, getDocumentProxy } from 'unpdf';
import { CalendarDate } from '../../core/proposal/domain/calendar-date.ts';
import { Money } from '../../core/proposal/domain/money.ts';
import { categoryOfLineOfBusiness } from './line-of-business-dictionary.ts';

/**
 * Reads the PDF of a proposal to speed up its registration (REQ-218).
 *
 * An aid to filling the form, never a source of truth: it saves nothing,
 * creates nothing and decides nothing. It turns the document into the values
 * the registration form takes, in the formats the domain already uses, and
 * says what it could not find. The user reviews, changes, completes and then
 * registers the proposal the normal way.
 *
 * It is conservative: a value is filled only when the document states it
 * unambiguously. Anything else is left absent — never estimated.
 *
 * One layout is known, the Allianz proposal (DEC-204 keeps the others open).
 */

/** The fields this reader can fill, named as the registration form names them. */
export const PROPOSAL_PDF_FIELDS = [
  'proposalNumber',
  'clientId',
  'brokerId',
  'insurerId',
  'productId',
  'paymentMethodId',
  'netPremium',
  'coverageStart',
  'coverageEnd',
  'installments',
] as const;

export type ProposalPdfField = (typeof PROPOSAL_PDF_FIELDS)[number];

export interface ProposalPdfFields {
  proposalNumber?: string;
  clientId?: string;
  brokerId?: string;
  insurerId?: string;
  productId?: string;
  paymentMethodId?: string;
  /** Decimal string, e.g. '643.85' (REQ-120). */
  netPremium?: string;
  /** `YYYY-MM-DD`. */
  coverageStart?: string;
  coverageEnd?: string;
  /** REQ-204: amounts in order; the due date is never read, so it is null. */
  installments?: { amount: string; dueDate: null }[];
}

/**
 * - `SUCCESS`: every field above was found.
 * - `PARTIAL`: the document was read and some field was not found; `missing`
 *   says which.
 * - `FAILED`: the document could not be read, or has nothing usable in it.
 */
export type ProposalPdfReading =
  | {
      readonly status: 'SUCCESS' | 'PARTIAL';
      readonly fields: ProposalPdfFields;
      readonly missing: readonly ProposalPdfField[];
    }
  | {
      readonly status: 'FAILED';
      readonly reason: 'UNREADABLE' | 'NO_TEXT' | 'UNRECOGNIZED_LAYOUT';
      readonly fields: ProposalPdfFields;
      readonly missing: readonly ProposalPdfField[];
    };

/**
 * DEC-208: turns the text the document prints into the identifier the
 * proposal stores. Today that is the text itself (`identifyByText`). When a
 * formal registry of clients, brokers and payment methods exists, another
 * function looks the text up there — and nothing else in the reader changes.
 */
export type ReferenceKind = 'CLIENT' | 'BROKER' | 'PAYMENT_METHOD';
export type IdentifyReference = (kind: ReferenceKind, text: string) => string;

export const identifyByText: IdentifyReference = (_kind, text) => text;

export interface ProposalPdfReaderDependencies {
  readonly identify: IdentifyReference;
}

export class ProposalPdfReader {
  private readonly deps: ProposalPdfReaderDependencies;

  constructor(deps: ProposalPdfReaderDependencies) {
    this.deps = deps;
  }

  async read(bytes: Uint8Array): Promise<ProposalPdfReading> {
    let text: string;

    try {
      // Verbosity 0: pdf.js reports errors only, not its recovery warnings; a
      // failure still ends in the catch below.
      const document = await getDocumentProxy(bytes, { verbosity: 0 });
      text = (await extractText(document, { mergePages: true })).text;
    } catch {
      return failed('UNREADABLE');
    }

    return readAllianzProposalText(text, this.deps.identify);
  }
}

/* ---------------------------------------------------- Allianz layout -- */

/** The header of the first page: the insurer's name, then the document type. */
const ALLIANZ_PROPOSAL = /^ALLIANZ\nPROPOSTA$/m;

/**
 * The fields of the Allianz proposal, from the extracted text. Exported apart
 * from the PDF extraction so the rules can be tested on text.
 */
export function readAllianzProposalText(
  text: string,
  identify: IdentifyReference,
): ProposalPdfReading {
  if (text.trim() === '') {
    return failed('NO_TEXT');
  }

  // REQ-218: recognising the layout is what identifies the insurer.
  if (!ALLIANZ_PROPOSAL.test(text)) {
    return failed('UNRECOGNIZED_LAYOUT');
  }

  const client = firstMatch(text, /SUAS INFORMAÇÕES\nNome: ([^\n]+)/);
  const broker = firstMatch(text, /SEU CORRETOR\n([^\n]+)/);
  const paymentMethod = firstMatch(text, /\n([^\n]+?)\*?\nem \d+ parcelas/);
  const coverage =
    /Vigência: das 24H de (\d{2}\/\d{2}\/\d{4}) às 24H de (\d{2}\/\d{2}\/\d{4})/.exec(text);
  const lineOfBusiness = firstMatch(text, /Ramo: \d+ - ([^\n]+?)\s*$/m);

  const candidates: { [Field in ProposalPdfField]: ProposalPdfFields[Field] | undefined } = {
    proposalNumber: agreed(allMatches(text, /N[º°] (?:da )?Proposta: (\d+)/g)),
    clientId: client === undefined ? undefined : identify('CLIENT', client),
    brokerId: broker === undefined ? undefined : identify('BROKER', broker),
    insurerId: 'ALLIANZ',
    productId:
      lineOfBusiness === undefined
        ? undefined
        : (categoryOfLineOfBusiness(lineOfBusiness) ?? undefined),
    paymentMethodId:
      paymentMethod === undefined ? undefined : identify('PAYMENT_METHOD', paymentMethod),
    netPremium: money(agreed(allMatches(text, /Preço líquido:? R\$ ([\d.]+,\d{2})/gi))),
    coverageStart: calendarDate(coverage?.[1]),
    coverageEnd: calendarDate(coverage?.[2]),
    installments: installments(text),
  };

  const found = Object.fromEntries(
    Object.entries(candidates).filter(([, value]) => value !== undefined),
  ) as ProposalPdfFields;
  const missing = PROPOSAL_PDF_FIELDS.filter((field) => found[field] === undefined);

  return { status: missing.length === 0 ? 'SUCCESS' : 'PARTIAL', fields: found, missing };
}

function failed(reason: 'UNREADABLE' | 'NO_TEXT' | 'UNRECOGNIZED_LAYOUT'): ProposalPdfReading {
  return { status: 'FAILED', reason, fields: {}, missing: [...PROPOSAL_PDF_FIELDS] };
}

function firstMatch(text: string, pattern: RegExp): string | undefined {
  return pattern.exec(text)?.[1]?.trim() || undefined;
}

function allMatches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1] as string);
}

/** A value printed more than once is taken only when every occurrence agrees. */
function agreed(values: readonly string[]): string | undefined {
  const [first] = values;
  return first !== undefined && values.every((value) => value === first) ? first : undefined;
}

/** 'R$ 1.303,85' as printed -> '1303.85', checked by the domain's own parser. */
function money(printed: string | undefined): string | undefined {
  if (printed === undefined) {
    return undefined;
  }
  try {
    return Money.fromString(printed.replaceAll('.', '').replace(',', '.')).toString();
  } catch {
    return undefined;
  }
}

/** 'DD/MM/AAAA' -> 'AAAA-MM-DD', checked by the domain's own parser. */
function calendarDate(printed: string | undefined): string | undefined {
  if (printed === undefined) {
    return undefined;
  }
  const [day, month, year] = printed.split('/');
  try {
    return CalendarDate.fromString(`${year}-${month}-${day}`).toString();
  } catch {
    return undefined;
  }
}

/**
 * The installment table, printed in two columns ('1 R$ 69,14 6 R$ 69,14').
 * Taken only when the numbers run 1..N with no gap and N is the count the
 * document states ('em N parcelas').
 */
function installments(text: string): ProposalPdfFields['installments'] {
  const count = agreed(allMatches(text, /em (\d+) parcelas/g));
  const table = text.split('Parcelas Valor da Parcela Parcelas Valor da Parcela\n')[1];

  if (count === undefined || table === undefined) {
    return undefined;
  }

  const rows: [number, string][] = [];
  for (const line of table.split('\n')) {
    if (!/^(\d+ R\$ [\d.]+,\d{2}\s*)+$/.test(line.trim())) {
      break;
    }
    for (const match of line.matchAll(/(\d+) R\$ ([\d.]+,\d{2})/g)) {
      rows.push([Number(match[1]), match[2] as string]);
    }
  }

  rows.sort(([a], [b]) => a - b);
  const sequential = rows.every(([number], index) => number === index + 1);

  if (rows.length !== Number(count) || !sequential) {
    return undefined;
  }

  const amounts = rows.map(([, printed]) => money(printed));
  if (amounts.some((amount) => amount === undefined)) {
    return undefined;
  }

  return amounts.map((amount) => ({ amount: amount as string, dueDate: null }));
}
