import type { PolicyMessageKey } from '../core/policy/domain/errors.ts';
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
export type MessageKey = ProposalMessageKey | PolicyMessageKey;

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
    'proposal.proposal_number_required':
      'Transmissão exige o número da proposta emitido pela seguradora.',
    'proposal.only_draft_can_be_transmitted':
      'Somente proposta em rascunho pode ser transmitida. Estado atual: {status}.',
    'proposal.only_transmitted_can_be_rejected':
      'Somente proposta transmitida pode ser recusada. Estado atual: {status}.',
    'proposal.rejection_reason_required': 'Recusa de proposta exige motivo.',
    'proposal.only_transmitted_can_be_accepted':
      'Apólice exige proposta transmitida. Estado atual: {status}.',
    'proposal.rejected_cannot_originate_policy': 'Proposta recusada não origina apólice.',
    'proposal.already_has_policy': 'Proposta já possui apólice registrada.',
    'proposal.not_found': "Proposta não encontrada: '{id}'.",
    'money.invalid_format':
      "Valor monetário inválido: '{value}'. Use string decimal com até {scale} casas, ex.: '1234.56'.",
    'percentage.invalid_format': "Percentual inválido: '{value}'. Use string decimal, ex.: '32.5'.",
    'percentage.out_of_range': "Percentual fora da faixa de 0 a 100: '{value}'.",
    'policy.policy_number_required': 'Apólice exige número de apólice.',
    'policy.premium_must_be_positive': 'Prêmio da apólice deve ser positivo.',
    'policy.coverage_end_must_follow_start':
      'Fim da vigência ({end}) deve ser posterior ao início ({start}).',
    'policy.installments_required': 'Apólice exige ao menos uma parcela.',
    'policy.installments_must_be_sequential':
      'Parcelas devem ser numeradas em sequência a partir de 1. Recebido: {number}.',
    'policy.installment_amount_must_be_positive': 'Valor da parcela {number} deve ser positivo.',
    'policy.installment_belongs_to_another_policy': 'Parcela {number} pertence a outra apólice.',
    'policy.not_found': "Apólice não encontrada: '{id}'.",
    'policy.invalid_date_format': "Data inválida: '{value}'. Use o formato AAAA-MM-DD.",
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
