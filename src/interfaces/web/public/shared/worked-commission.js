/**
 * The CT fields of a proposal form (REQ-213, REQ-291): one CT with an
 * integral CT; with a parcelled one, the CT of the first installment and the
 * CT of the subsequent installments.
 *
 * Used by the registration and by the correction before issuance. It only
 * shows the second field and names the first by the mode; whether the pair
 * fits the mode — two CTs, two installments, no intermediary (REQ-291,
 * REQ-292, REQ-296) — is the domain's answer.
 *
 * The markup it expects inside the form: a `workedCommissionMode` select, a
 * `workedCommission` input whose label carries `data-label="workedCommission"`,
 * and a `subsequentWorkedCommission` input inside a `.field`.
 */

const LABEL = {
  INTEGRAL: 'CT (%)',
  PARCELLED: 'CT da primeira parcela (%)',
};

export function bindWorkedCommissionFields(form) {
  const mode = form.querySelector('[name="workedCommissionMode"]');
  const label = form.querySelector('[data-label="workedCommission"]');
  const subsequent = form.querySelector('[name="subsequentWorkedCommission"]').closest('.field');

  const sync = () => {
    subsequent.classList.toggle('hidden', mode.value !== 'PARCELLED');
    label.textContent = LABEL[mode.value] ?? LABEL.INTEGRAL;
  };

  mode.addEventListener('change', sync);
  sync();
  return sync;
}

/** The CT of the API: the second CT only with a parcelled CT, `null` otherwise. */
export function workedCommissionOf(form) {
  const mode = form.querySelector('[name="workedCommissionMode"]').value;
  const subsequent = form.querySelector('[name="subsequentWorkedCommission"]').value.trim();

  return {
    workedCommission: form.querySelector('[name="workedCommission"]').value,
    subsequentWorkedCommission: mode === 'PARCELLED' && subsequent !== '' ? subsequent : null,
    workedCommissionMode: mode,
  };
}
