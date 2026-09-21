import type { CommissionMessageKey } from '../core/commission/domain/errors.ts';
import type { NotificationMessageKey } from '../core/notification/domain/errors.ts';
import type { PolicyMessageKey } from '../core/policy/domain/errors.ts';
import type { ProposalMessageKey } from '../core/proposal/domain/errors.ts';
import type { ReconciliationMessageKey } from '../core/reconciliation/domain/errors.ts';
import type { RegistryMessageKey } from '../core/registry/domain/errors.ts';
import type { SettlementMessageKey } from '../core/settlement/domain/errors.ts';

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
export type MessageKey =
  | ProposalMessageKey
  | PolicyMessageKey
  | CommissionMessageKey
  | ReconciliationMessageKey
  | RegistryMessageKey
  | NotificationMessageKey
  | SettlementMessageKey;

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
      'Registro da emissão exige o número da proposta emitido pela seguradora.',
    'proposal.proposal_number_already_registered':
      "Número de proposta '{proposalNumber}' já registrado em outra proposta.",
    'proposal.only_draft_can_be_transmitted':
      'Somente proposta em rascunho pode receber a emissão da seguradora. Estado atual: {status}.',
    'proposal.only_transmitted_can_be_rejected':
      'Somente proposta emitida pela seguradora pode ser recusada. Estado atual: {status}.',
    'proposal.rejection_reason_required': 'Recusa de proposta exige motivo.',
    'proposal.only_transmitted_can_be_accepted':
      'Apólice exige proposta emitida pela seguradora. Estado atual: {status}.',
    'proposal.rejected_cannot_originate_policy': 'Proposta recusada não origina apólice.',
    'proposal.already_has_policy': 'Proposta já possui apólice registrada.',
    'proposal.not_found': "Proposta não encontrada: '{id}'.",
    'money.invalid_format':
      "Valor monetário inválido: '{value}'. Use string decimal com até {scale} casas, ex.: '1234.56'.",
    'percentage.invalid_format': "Percentual inválido: '{value}'. Use string decimal, ex.: '32.5'.",
    'percentage.out_of_range': "Percentual fora da faixa de 0 a 100: '{value}'.",
    'policy.policy_number_required': 'Apólice exige número de apólice.',
    'policy.policy_number_already_registered':
      "Número de apólice '{policyNumber}' já registrado em outra apólice.",
    'policy.premium_must_be_positive': 'Prêmio da apólice deve ser positivo.',
    'policy.coverage_end_must_follow_start':
      'Fim da vigência ({end}) deve ser posterior ao início ({start}).',
    'policy.installments_required': 'Apólice exige ao menos uma parcela.',
    'policy.installments_must_be_sequential':
      'Parcelas devem ser numeradas em sequência a partir de 1. Recebido: {number}.',
    'policy.installment_amount_must_be_positive': 'Valor da parcela {number} deve ser positivo.',
    'policy.installment_belongs_to_another_policy': 'Parcela {number} pertence a outra apólice.',
    'policy.not_found': "Apólice não encontrada: '{id}'.",
    'policy.not_found_for_proposal': "Proposta '{proposalId}' ainda não possui apólice registrada.",
    'policy.invalid_date_format': "Data inválida: '{value}'. Use o formato AAAA-MM-DD.",
    'policy.installment_not_found': "Parcela {number} não encontrada na apólice '{policyNumber}'.",
    'policy.only_pending_can_be_paid':
      'Somente parcela pendente pode ser confirmada como paga. Parcela {number} está {status}.',
    'policy.payment_confirmation_user_required':
      'Confirmação de pagamento da parcela {number} exige a identificação do usuário.',

    'registry.reference_field_required': 'Cadastro de referência exige o campo {field}.',
    'commission.agreement_field_required': 'Acordo comercial exige o campo {field}.',
    'commission.intermediary_required':
      'Cadeia com intermediária exige a identificação da intermediária.',
    'commission.broker_rate_field_required':
      'Tabela de comissão do corretor exige o campo {field}.',
    'commission.not_found': "Apólice '{policyId}' não possui comissão calculada.",
    'commission.already_calculated':
      'Apólice já possui comissão calculada. Use o ajuste por apólice para alterá-la.',
    'commission.no_agreement_in_force':
      "Não há acordo comercial vigente para a seguradora '{insurerId}' e o produto " +
      "'{productId}' em {on}, data de registro da apólice. Registre o acordo com vigência " +
      'a partir dessa data, ou anterior.',
    'commission.no_broker_rate':
      "Não há tabela de comissão registrada para o corretor '{brokerId}'.",
    'commission.override_justification_required':
      'Ajuste de comissão por apólice exige justificativa.',
    'commission.override_user_required':
      'Ajuste de comissão por apólice exige a identificação do usuário.',
    'commission.override_value_required':
      'Ajuste de comissão exige ao menos um valor: a receber ou a pagar.',
    'commission.override_must_be_positive': 'Valor de ajuste de comissão deve ser positivo.',
    'commission.only_divergent_can_be_resolved':
      'Somente comissão divergente pode ser resolvida. Estado atual: {status}.',
    'commission.resolution_justification_required': 'Resolução de divergência exige justificativa.',
    'commission.resolution_user_required':
      'Resolução de divergência exige a identificação do usuário.',
    'commission.competence_required': 'Conciliação exige a competência do arquivo.',
    'commission.already_reconciled_for_competence':
      'Apólice já conciliada na competência {competence}.',

    'reconciliation.competence_required':
      'Importação do arquivo de comissionamento exige a competência.',
    'reconciliation.report_must_have_lines':
      'Importação do arquivo de comissionamento exige ao menos uma linha.',
    'reconciliation.proposal_number_required':
      'Linha do arquivo de comissionamento exige o número da proposta.',

    'notification.recipient_required':
      'Notificação de emissão efetivada exige a identificação do corretor destinatário.',

    'settlement.release_rule_not_configured':
      "Forma de pagamento '{paymentMethodId}' não tem regra de liberação configurada.",
    'settlement.payment_method_required':
      'Regra de liberação exige a identificação da forma de pagamento.',
    'settlement.commission_not_reconciled':
      'Repasse exige comissão real apurada na conciliação. Estado atual: {status}.',
    'settlement.already_open': 'Apólice já possui repasse registrado.',
    'settlement.not_found': "Apólice '{policyId}' não possui repasse registrado.",
    'settlement.awaiting_receipt_confirmation':
      'Repasse exige confirmação do pagamento da primeira parcela pelo cliente.',
    'settlement.only_awaiting_can_be_released':
      'Somente repasse aguardando confirmação pode ser liberado. Estado atual: {status}.',
    'settlement.only_released_can_be_paid':
      'Somente repasse liberado pode ser pago. Estado atual: {status}.',
    'settlement.payment_amount_must_be_positive': 'Valor do repasse pago deve ser positivo.',
    'settlement.payment_proof_required': 'Registro de repasse exige comprovante anexo.',
    'settlement.payment_proof_not_found':
      "Repasse da apólice '{policyId}' não possui comprovante anexo registrado.",
    'settlement.payment_user_required': 'Registro de repasse exige a identificação do usuário.',
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
