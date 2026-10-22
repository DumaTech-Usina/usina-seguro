import type { CommissionMessageKey } from '../core/commission/domain/errors.ts';
import type { IdentityMessageKey } from '../core/identity/domain/errors.ts';
import type { NotificationMessageKey } from '../core/notification/domain/errors.ts';
import type { PolicyMessageKey } from '../core/policy/domain/errors.ts';
import type { ProposalMessageKey } from '../core/proposal/domain/errors.ts';
import type { RegistryMessageKey } from '../core/registry/domain/errors.ts';

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
  | RegistryMessageKey
  | NotificationMessageKey
  | IdentityMessageKey;

export type Locale = 'pt-BR';

export const DEFAULT_LOCALE: Locale = 'pt-BR';

/**
 * Typing this as `Record<MessageKey, string>` makes a missing translation a
 * compile error: adding a key to the core without translating it fails
 * `npm run typecheck`.
 */
const MESSAGES: Record<Locale, Record<MessageKey, string>> = {
  'pt-BR': {
    'proposal.payment_method_required': 'Proposta exige forma de pagamento definida.',
    'proposal.field_required': 'Proposta exige o campo {field}.',
    'proposal.net_premium_must_be_positive': 'Prêmio líquido da proposta deve ser positivo.',
    'proposal.coverage_end_must_follow_start':
      'Fim da vigência ({end}) deve ser posterior ao início ({start}).',
    'proposal.installment_amount_must_be_positive': 'Valor da parcela {number} deve ser positivo.',
    'proposal.proposal_number_required': 'Proposta exige o número emitido pela seguradora.',
    'proposal.author_required': 'Informe quem está registrando esta informação.',
    'policy.parcelled_installment_has_no_payment_confirmation':
      'Na apólice com CT parcelada não há confirmação de pagamento da parcela: o ato sobre a parcela é a elegibilidade.',
    'proposal.parcelled_requires_subsequent_ct':
      'Com CT parcelada, informe também a CT das parcelas subsequentes.',
    'proposal.integral_has_single_ct':
      'Com CT integral há uma única CT: a CT das parcelas subsequentes só existe na CT parcelada.',
    'proposal.parcelled_requires_two_installments':
      'Com CT parcelada, a proposta precisa de ao menos duas parcelas.',
    'proposal.parcelled_cannot_have_intermediary':
      'Comissão parcelada não pode ser recebida através de intermediária: com intermediária, a CT só pode ser integral.',
    'proposal.intermediary_requires_ctu':
      'Com intermediária, a CTU (comissão trabalhada da Usina) é obrigatória.',
    'proposal.issued_proposal_is_frozen': 'Proposta emitida não pode ser alterada.',
    'proposal.rejected_proposal_is_final':
      'Proposta recusada não pode ser alterada: a recusa é definitiva.',
    'proposal.rejection_reason_required': 'Recusa de proposta exige motivo.',
    'proposal.rejected_cannot_originate_policy': 'Proposta recusada não origina apólice.',
    'proposal.already_has_policy': 'Proposta já possui apólice registrada.',
    'proposal.not_found': "Proposta não encontrada: '{id}'.",
    'proposal.broker_not_registered': 'Escolha um corretor cadastrado.',
    'proposal.intermediary_not_registered': 'Escolha uma intermediária cadastrada.',
    'proposal.source_document_not_found': 'A proposta {id} não tem documento de origem guardado.',
    'money.invalid_format':
      "Valor monetário inválido: '{value}'. Use string decimal com até {scale} casas, ex.: '1234.56'.",
    'percentage.invalid_format': "Percentual inválido: '{value}'. Use string decimal, ex.: '32.5'.",
    'percentage.out_of_range': "Percentual fora da faixa de 0 a 100: '{value}'.",
    'policy.policy_number_required': 'Informe o número da apólice.',
    'policy.premium_must_be_positive': 'Prêmio da apólice deve ser positivo.',
    'policy.coverage_end_must_follow_start':
      'Fim da vigência ({end}) deve ser posterior ao início ({start}).',
    'policy.installments_must_be_sequential':
      'Parcelas devem ser numeradas em sequência a partir de 1. Recebido: {number}.',
    'policy.installment_amount_must_be_positive': 'Valor da parcela {number} deve ser positivo.',
    'policy.installment_belongs_to_another_policy': 'Parcela {number} pertence a outra apólice.',
    'policy.not_found': "Apólice não encontrada: '{id}'.",
    'policy.not_found_for_proposal': "Proposta '{proposalId}' ainda não possui apólice registrada.",
    'calendar_date.invalid_format': "Data inválida: '{value}'. Use o formato AAAA-MM-DD.",
    'policy.document_not_found': 'A apólice {id} não tem PDF guardado.',
    'policy.document_required': 'O reconhecimento da emissão exige o PDF da apólice.',
    'policy.installment_not_found': "Parcela {number} não encontrada na apólice '{policyNumber}'.",
    'policy.only_pending_can_be_paid':
      'Somente parcela pendente pode ser confirmada como paga. Parcela {number} está {status}.',
    'policy.payment_confirmation_user_required':
      'Confirmação de pagamento da parcela {number} exige a identificação do usuário.',

    'registry.reference_field_required': 'Cadastro de referência exige o campo {field}.',
    'registry.broker_name_required': 'O corretor precisa de um nome.',
    'registry.broker_cpf_required': 'O corretor precisa de um CPF.',
    'registry.broker_cpf_invalid':
      'CPF inválido: informe os 11 dígitos, com dígitos verificadores válidos.',
    'registry.broker_cpf_taken': 'Já existe um corretor cadastrado com este CPF.',
    'registry.broker_not_found': "Corretor não encontrado: '{id}'.",
    'registry.client_name_required': 'O cliente precisa de um nome.',
    'registry.client_cpf_required': 'O cliente precisa de um CPF.',
    'registry.client_cpf_invalid':
      'CPF do cliente inválido: informe os 11 dígitos, com dígitos verificadores válidos.',
    'registry.client_cpf_taken': 'Já existe um cliente cadastrado com este CPF.',
    'registry.client_not_found': "Cliente não encontrado: '{id}'.",
    'commission.not_found': "Apólice '{policyId}' não possui comissão calculada.",
    'commission.override_justification_required':
      'Ajuste de comissão por apólice exige justificativa.',
    'commission.override_user_required':
      'Ajuste de comissão por apólice exige a identificação do usuário.',
    'commission.override_must_be_positive': 'Valor de ajuste de comissão deve ser positivo.',
    'commission.payout_rate_too_precise':
      "A CR aceita no máximo duas casas decimais. Recebido: '{value}'.",
    'commission.payout_requires_integral_ct':
      'A CR só pode ser informada em apólice com CT integral; com CT parcelada ela ainda não está definida.',
    'commission.payout_already_informed':
      'A apólice já tem CR. Para mudá-la, faça o recálculo com motivo.',
    'commission.payout_not_informed': 'A apólice ainda não tem CR informada.',
    'commission.payout_revision_reason_required': 'A alteração da CR exige um motivo.',
    'commission.payout_eligible_is_final':
      'A comissão já é elegível: é definitiva e só pode ser consultada.',
    'commission.parcelled_payout_requires_parcelled_ct':
      'Os CRs da primeira parcela e das subsequentes só existem em apólice com CT parcelada.',
    'commission.parcelled_first_rate_above_ct':
      'A CR da primeira parcela ({rate}%) não pode ser maior que a CT da primeira parcela ({ct}%).',
    'commission.parcelled_subsequent_rate_above_ct':
      'A CR das parcelas subsequentes ({rate}%) não pode ser maior que a CT das parcelas subsequentes ({ct}%).',
    'commission.parcelled_rates_frozen':
      'Os CRs não podem mais ser alterados: já há parcela elegível.',
    'commission.installment_eligibility_requires_rates':
      'A parcela só pode ser tornada elegível com os CRs informados (ainda que zero).',
    'commission.installment_already_eligible':
      'A parcela {number} já é elegível: a elegibilidade é definitiva.',
    'commission.installment_not_in_policy': 'A apólice não tem a parcela {number}.',

    'notification.recipient_required':
      'Notificação de emissão efetivada exige a identificação do corretor destinatário.',

    'identity.email_required': 'Informe o e-mail.',
    'identity.email_already_active': 'Já existe um usuário ativo com este e-mail.',
    'identity.password_length': 'A senha deve ter de {min} a {max} caracteres.',
    'identity.invalid_link': 'Este link não é válido ou já expirou.',
    'identity.login_refused':
      'Não foi possível entrar. Confira o e-mail e a senha ou tente novamente mais tarde.',
    'identity.authentication_required': 'Entre no sistema para continuar.',
    'identity.foreign_origin': 'Operação recusada: a requisição não veio do próprio sistema.',
    'identity.administrator_only': 'Somente um administrador pode fazer isto.',
    'identity.last_administrator':
      'O sistema precisa de ao menos um administrador ativo: esta alteração deixaria nenhum.',
    'identity.invitation_not_pending': 'Este convite não está mais pendente.',
    'identity.user_not_found': 'Usuário não encontrado.',
    'identity.invitation_not_found': 'Convite não encontrado.',
    'identity.reset_requested':
      'Se houver um usuário ativo com este e-mail, enviamos um link para redefinir a senha. Ele vale por 1 hora.',
    'identity.invitation_email_subject': 'Convite para o sistema da Usina do Seguro',
    'identity.invitation_email_body':
      'Você foi convidado para o sistema da Usina do Seguro.\n\nPara concluir o cadastro e definir a sua senha, abra o link abaixo. Ele vale uma única vez, até {expiresAt}.\n\n{link}\n\nSe você não esperava este convite, ignore este e-mail.',
    'identity.reset_email_subject': 'Redefinição de senha — Usina do Seguro',
    'identity.reset_email_body':
      'Recebemos um pedido para redefinir a sua senha no sistema da Usina do Seguro.\n\nPara definir uma nova senha, abra o link abaixo. Ele vale uma única vez, até {expiresAt}.\n\n{link}\n\nSe você não fez este pedido, ignore este e-mail: a sua senha continua a mesma.',
    'identity.invitation_email_heading': 'Convite para criar sua senha',
    'identity.invitation_email_intro':
      'Você foi convidado para o sistema da Usina do Seguro. Para concluir o cadastro e definir a sua senha, use o botão abaixo. O link vale uma única vez, até {expiresAt}.',
    'identity.invitation_email_button': 'Criar minha senha',
    'identity.invitation_email_ignore': 'Se você não esperava este convite, ignore este e-mail.',
    'identity.reset_email_heading': 'Recuperação de senha',
    'identity.reset_email_intro':
      'Recebemos um pedido para redefinir a sua senha no sistema da Usina do Seguro. Para definir uma nova senha, use o botão abaixo. O link vale uma única vez, até {expiresAt}.',
    'identity.reset_email_button': 'Definir nova senha',
    'identity.reset_email_ignore':
      'Se você não fez este pedido, ignore este e-mail: a sua senha continua a mesma.',
    'identity.email_link_fallback':
      'Se o botão não funcionar, copie e cole este endereço no navegador:',
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
