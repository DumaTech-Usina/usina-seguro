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

let names = new Map();

/**
 * Fills the intermediary dropdown with the registered intermediaries (IN-01),
 * by name, keeping the id as the value; the first one is chosen by default.
 * Only what the registry knows can be chosen (REQ-229). It also keeps the
 * names for `intermediaryName`. A registry that cannot be read leaves the
 * dropdown empty, and the server answers what is sent.
 */
export async function offerRegisteredIntermediaries(select) {
  let references;
  try {
    references = await api.listReferences('INTERMEDIARY');
  } catch {
    return;
  }

  names = new Map(references.map((reference) => [reference.id, reference.name]));
  select.replaceChildren(
    ...references.map((reference) => {
      const option = document.createElement('option');
      option.value = reference.id;
      option.textContent = reference.name;
      return option;
    }),
  );
}

/**
 * REQ-229: chooses `id` in the dropdown, or the first intermediary when the
 * registry does not know it — a direct receipt, or a proposal registered
 * before the rule.
 */
export function chooseIntermediary(select, id) {
  select.value = id ?? '';
  if (select.selectedIndex === -1 && select.options.length > 0) {
    select.selectedIndex = 0;
  }
}

/**
 * REQ-229: the proposal keeps the intermediary's id; the screen shows its
 * registered name. A proposal registered before the rule may name one the
 * registry does not know: it is shown as it is.
 */
export function intermediaryName(id) {
  return names.get(id) ?? id;
}
