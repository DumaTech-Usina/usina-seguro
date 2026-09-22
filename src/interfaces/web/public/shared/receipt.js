/**
 * The receipt fields of a proposal form: direct from the insurer, or through
 * the one intermediary with its CTU (REQ-220, REQ-221).
 *
 * Used by the registration and by the correction before issuance. It only
 * shows or hides the intermediary fields and shapes the payload; whether an
 * intermediary without CTU is acceptable is the domain's answer (REJ-202), so
 * nothing here refuses it.
 *
 * The markup it expects inside the form: a `receiptKind` select with `DIRECT`
 * and `INTERMEDIARY`, and a `#intermediary-fields` block holding the
 * `intermediaryId` and `ctu` inputs.
 */

import { api } from '/app/shared/api.js';

export function bindReceiptFields(form) {
  const kind = form.querySelector('[name="receiptKind"]');
  const fields = form.querySelector('#intermediary-fields');

  const sync = () => {
    fields.classList.toggle('hidden', kind.value !== 'INTERMEDIARY');
  };

  kind.addEventListener('change', sync);
  sync();
}

/**
 * The `intermediary` of the API: `null` for a direct receipt, or the one
 * intermediary. An empty CTU travels as `null` so the domain answers it.
 */
export function intermediaryOf(form) {
  if (form.querySelector('[name="receiptKind"]').value !== 'INTERMEDIARY') {
    return null;
  }

  const ctu = form.querySelector('[name="ctu"]').value.trim();

  return {
    intermediaryId: form.querySelector('[name="intermediaryId"]').value,
    ctu: ctu === '' ? null : ctu,
  };
}

/**
 * Offers the intermediaries already registered (IN-01) as suggestions. The
 * intermediary is a registry reference (REQ-220); a registry that cannot be
 * read leaves the field as free text.
 */
export async function offerRegisteredIntermediaries(list) {
  let references;
  try {
    references = await api.listReferences('INTERMEDIARY');
  } catch {
    return;
  }

  list.replaceChildren(
    ...references.map((reference) => {
      const option = document.createElement('option');
      option.value = reference.id;
      option.label = reference.name;
      option.textContent = reference.name;
      return option;
    }),
  );
}
