/**
 * The editable list of installments of a proposal: value and optional due
 * date (REQ-204), numbered by position — the first is number 1 (REQ-291).
 *
 * Used by the registration and by "Corrigir parcelas" before issuance
 * (REQ-254). It only builds rows and shapes the payload: whether a list is
 * acceptable — a value above zero, at least two with a parcelled CT
 * (REQ-292) — is the domain's answer, so nothing here refuses it.
 */

function renumber(container) {
  [...container.querySelectorAll('.installment-row')].forEach((row, index) => {
    row.querySelector('.installment-row__number').textContent = String(index + 1);
  });
}

/** Appends one row to `container`, filled with what is given. */
export function addInstallmentRow(container, amount = '', dueDate = '') {
  const row = document.createElement('div');
  row.className = 'installment-row';
  row.innerHTML = `
    <div class="installment-row__number"></div>
    <div class="field">
      <input class="field__input" name="amount" placeholder=" " inputmode="decimal"
             pattern="\\d+(\\.\\d{1,2})?" required />
      <label class="field__label">Valor</label>
    </div>
    <div class="field installment-row__date">
      <input class="field__input" type="date" name="dueDate" />
      <label class="field__label">Vencimento (opcional)</label>
    </div>
    <button class="installment-row__remove" type="button" title="Remover parcela">
      <span class="material-symbols-outlined">close</span>
    </button>`;

  row.querySelector('.installment-row__remove').addEventListener('click', () => {
    row.remove();
    renumber(container);
  });
  row.querySelector('[name="amount"]').value = amount;
  row.querySelector('[name="dueDate"]').value = dueDate ?? '';

  container.append(row);
  renumber(container);
}

/** The installments of the API: `{ amount, dueDate }`, an empty date as `null`. */
export function scheduleOf(container) {
  return [...container.querySelectorAll('.installment-row')].map((row) => {
    const dueDate = row.querySelector('[name="dueDate"]').value;
    return {
      amount: row.querySelector('[name="amount"]').value,
      dueDate: dueDate === '' ? null : dueDate,
    };
  });
}
