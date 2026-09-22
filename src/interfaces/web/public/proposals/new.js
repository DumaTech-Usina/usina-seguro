/**
 * FP-01 steps 1 to 6: registers the proposal with everything it holds.
 *
 * One form, one call. Every rule — the customer's acceptance (REQ-040), the
 * CTU an intermediary requires (REQ-221), the signature (REQ-216) — belongs to
 * the domain, and this file learns the answer by being refused. The expected
 * value (REQ-232) is the server's answer too: this page shows it after the
 * registration and never computes it.
 */

import { ApiError, api } from '/app/shared/api.js';
import { formatDate, formatMoney } from '/app/shared/money.js';
import {
  bindReceiptFields,
  intermediaryOf,
  offerRegisteredIntermediaries,
} from '/app/shared/receipt.js';
import { reportError, showSnackbar } from '/app/shared/shell.js';
import { statusChip } from '/app/shared/status.js';

/* ------------------------------------------------------- IN-01 hints -- */

/**
 * Offers the identifiers already registered in IN-01, with their names.
 *
 * A suggestion, never a constraint: the field stays free text. A registry that
 * cannot be read leaves the fields exactly as they were.
 */
async function offerRegisteredReferences() {
  const fields = [
    ['CLIENT', 'client-options'],
    ['BROKER', 'broker-options'],
    ['INSURER', 'insurer-options'],
    ['PRODUCT', 'product-options'],
  ];

  let references;
  try {
    references = await api.listReferences();
  } catch {
    return;
  }

  for (const [kind, id] of fields) {
    const list = document.querySelector(`#${id}`);
    if (list === null) {
      continue;
    }

    list.replaceChildren(
      ...references
        .filter((reference) => reference.kind === kind)
        .map((reference) => {
          const option = document.createElement('option');
          option.value = reference.id;
          option.label = reference.name;
          option.textContent = reference.name;
          return option;
        }),
    );
  }
}

const form = document.querySelector('#form-proposal');

offerRegisteredReferences();
offerRegisteredIntermediaries(document.querySelector('#intermediary-options'));
bindReceiptFields(form);

/* ------------------------------------------------------------ renewal -- */

// REQ-203: the renewal is the end of coverage. Shown as it is typed, never
// asked for.
const coverageEnd = form.querySelector('[name="coverageEnd"]');
coverageEnd.addEventListener('input', () => {
  document.querySelector('#renewal').textContent =
    coverageEnd.value === '' ? 'igual ao fim da vigência' : formatDate(coverageEnd.value);
});

/* ------------------------------------------------------- installments -- */

const installments = document.querySelector('#installments');

function renumber() {
  [...installments.querySelectorAll('.installment-row')].forEach((row, index) => {
    // REQ-204: the number is the position, never typed.
    row.querySelector('.installment-row__number').textContent = String(index + 1);
  });
}

function addInstallmentRow() {
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
    renumber();
  });

  installments.append(row);
  renumber();
}

document.querySelector('#add-installment').addEventListener('click', addInstallmentRow);

function schedule() {
  return [...installments.querySelectorAll('.installment-row')].map((row) => {
    const dueDate = row.querySelector('[name="dueDate"]').value;
    return {
      amount: row.querySelector('[name="amount"]').value,
      dueDate: dueDate === '' ? null : dueDate,
    };
  });
}

/* ------------------------------------------------------------- submit -- */

function value(name) {
  return form.querySelector(`[name="${name}"]`).value;
}

/** Keeps the submit button from firing twice while the request is in flight. */
async function submitting(work) {
  const button = form.querySelector('button[type="submit"]');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Enviando…';

  try {
    await work();
  } catch (error) {
    if (error instanceof ApiError) {
      reportError(error);
    } else {
      showSnackbar('Falha de comunicação com o servidor.', { tone: 'danger' });
    }
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();

  submitting(async () => {
    const proposal = await api.registerProposal({
      clientId: value('clientId'),
      brokerId: value('brokerId'),
      insurerId: value('insurerId'),
      productId: value('productId'),
      paymentMethodId: value('paymentMethodId'),
      // The domain is what refuses a missing acceptance (REQ-040), so it
      // travels as the boolean it is.
      customerAccepted: form.querySelector('[name="customerAccepted"]').checked,
      proposalNumber: value('proposalNumber'),
      netPremium: value('netPremium'),
      coverageStart: value('coverageStart'),
      coverageEnd: value('coverageEnd'),
      installments: schedule(),
      workedCommission: value('workedCommission'),
      workedCommissionMode: value('workedCommissionMode'),
      intermediary: intermediaryOf(form),
      userId: value('userId'),
    });

    showSnackbar(`Proposta ${proposal.proposalNumber} registrada.`, { tone: 'success' });
    finish(proposal);
  });
});

/* ---------------------------------------------------------- conclusion -- */

function finish(proposal) {
  const body = document.querySelector('#done-body');
  const empty = document.createElement('div');
  empty.className = 'empty';

  const symbol = document.createElement('span');
  symbol.className = 'material-symbols-outlined';
  symbol.textContent = 'hourglass_top';

  const heading = document.createElement('h2');
  heading.className = 'text-title';
  heading.textContent = `Proposta ${proposal.proposalNumber} registrada`;

  const chip = statusChip('proposal', proposal.status);

  // REQ-232, CA-203: what the Usina expects, known before the issuance.
  const expected = document.createElement('p');
  expected.textContent = `A Usina espera receber ${formatMoney(proposal.expectedReceipt.usina)}.`;

  const text = document.createElement('p');
  text.className = 'text-muted';
  text.textContent =
    'Enquanto aguarda a emissão, a CT e o recebimento podem ser corrigidos na própria proposta.';

  const open = document.createElement('a');
  open.className = 'btn btn--filled';
  open.href = `/app/proposals/detail.html?id=${encodeURIComponent(proposal.id)}`;
  open.textContent = 'Abrir proposta';

  const again = document.createElement('a');
  again.className = 'btn btn--outlined';
  again.href = '/app/proposals/new.html';
  again.textContent = 'Registrar outra';

  const actions = document.createElement('div');
  actions.className = 'row';
  actions.style.marginTop = 'var(--space-2)';
  actions.append(open, again);

  empty.append(symbol, heading, chip, expected, text, actions);
  body.replaceChildren(empty);

  form.classList.add('hidden');
  document.querySelector('[data-panel="done"]').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
