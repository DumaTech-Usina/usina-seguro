/**
 * Message keys of the reference registry (IN-01).
 *
 * Like every other module, the domain throws a key plus params and never a
 * sentence: the Portuguese lives in `src/i18n/messages.ts`.
 */
export const REGISTRY_MESSAGES = {
  REFERENCE_FIELD_REQUIRED: 'registry.reference_field_required',
} as const;

export type RegistryMessageKey = (typeof REGISTRY_MESSAGES)[keyof typeof REGISTRY_MESSAGES];
