/**
 * Message keys of the registry: the reference records (IN-01) and the brokers
 * (V2 section 9D).
 *
 * Like every other module, the domain throws a key plus params and never a
 * sentence: the Portuguese lives in `src/i18n/messages.ts`.
 */
export const REGISTRY_MESSAGES = {
  REFERENCE_FIELD_REQUIRED: 'registry.reference_field_required',
  BROKER_NAME_REQUIRED: 'registry.broker_name_required',
  BROKER_CPF_REQUIRED: 'registry.broker_cpf_required',
  BROKER_CPF_INVALID: 'registry.broker_cpf_invalid',
  BROKER_CPF_TAKEN: 'registry.broker_cpf_taken',
  BROKER_NOT_FOUND: 'registry.broker_not_found',
} as const;

export type RegistryMessageKey = (typeof REGISTRY_MESSAGES)[keyof typeof REGISTRY_MESSAGES];
