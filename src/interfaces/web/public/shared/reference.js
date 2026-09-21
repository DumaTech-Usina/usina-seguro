/**
 * How a reference of IN-01 reads on screen.
 *
 * The API answers the identifier that is stored and the name IN-01 registered
 * for it, which is `null` while nobody registered one. Nothing in the system
 * refuses a business for that (REQ-002), so the screen falls back to the
 * identifier rather than showing a gap: an unregistered client is still a
 * client the operator has to recognise.
 *
 * This is presentation, not a rule — which is why it lives here and not in the
 * core, where `null` is answered exactly as it is.
 */

/** The name when there is one, the identifier when there is not. */
export function referenceLabel(name, id) {
  return typeof name === 'string' && name !== '' ? name : (id ?? '—');
}
