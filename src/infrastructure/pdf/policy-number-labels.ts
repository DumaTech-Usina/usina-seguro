/**
 * Dictionary of labels (REQ-248): the ways a policy PDF prints the policy
 * number in front of it.
 *
 * The example policy is a sample, not a model. Insurers — and versions of the
 * same insurer's document — name the field differently, so the reading looks
 * for the label, not for a layout. Meant to be extended: a document whose
 * number is not found is served by adding its label here. Case does not matter.
 *
 * Each entry is the label only. The number must follow it right away (after an
 * optional `:` or `.`), which is what keeps `Nº Apólice Anterior: …` — the
 * previous policy of a renewal — from being read as this one.
 */
export const POLICY_NUMBER_LABELS: readonly string[] = [
  // Nº Apólice, Nº. Apólice, N° da Apólice, No. Apólice
  'n[º°o]\\.?\\s*(?:da\\s+)?ap[oó]lice',
  // Apólice Nº, Apólice Nº., Apólice nº
  'ap[oó]lice\\s*n[º°o]\\.?',
  // Número da Apólice, Numero Apolice
  'n[uú]mero\\s+(?:da\\s+)?ap[oó]lice',
  // Apólice: — only with the colon, so prose that mentions "a apólice" is not read
  'ap[oó]lice(?=\\s*:)',
];
