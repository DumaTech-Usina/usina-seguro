import type { ProposalMessageKey } from '../core/proposal/domain/errors.ts';

/**
 * Message dictionary.
 *
 * The code is written in English; the text shown to people is Portuguese and
 * lives only here. The core emits stable keys (`ProposalMessageKey`) and this
 * module renders them.
 *
 * Dependency direction: `i18n` imports the core, never the other way around.
 *
 * A single locale is supported because no requirement asks for more. The shape
 * (`Record<Locale, Record<MessageKey, string>>`) already allows adding one
 * without touching the core.
 */
export type MessageKey = ProposalMessageKey;

export type Locale = 'pt-BR';

export const DEFAULT_LOCALE: Locale = 'pt-BR';

/**
 * Typing this as `Record<MessageKey, string>` makes a missing translation a
 * compile error: adding a key to the core without translating it fails
 * `npm run typecheck`.
 */
const MESSAGES: Record<Locale, Record<MessageKey, string>> = {
  'pt-BR': {
    'proposal.customer_acceptance_required': 'Proposta exige aceite do cliente registrado.',
    'proposal.payment_method_required': 'Proposta exige forma de pagamento definida.',
    'proposal.field_required': 'Proposta exige o campo {field}.',
    'proposal.net_premium_must_be_positive': 'Prêmio líquido da proposta deve ser positivo.',
    'money.invalid_format':
      "Valor monetário inválido: '{value}'. Use string decimal com até {scale} casas, ex.: '1234.56'.",
  },
};

/**
 * Renders a message key in the given locale, interpolating `{param}` markers.
 *
 * An unknown key falls back to the key itself: a missing translation must not
 * hide the error that was being reported.
 */
export function translate(
  key: string,
  params: Readonly<Record<string, string>> = {},
  locale: Locale = DEFAULT_LOCALE,
): string {
  const template = MESSAGES[locale][key as MessageKey];

  if (template === undefined) {
    return key;
  }

  return template.replace(/\{(\w+)\}/g, (marker, name: string) => params[name] ?? marker);
}
