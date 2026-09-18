/**
 * FP-01 end to end: register the proposal, transmit it, record the outcome.
 *
 * The page orchestrates three calls and nothing else. Every rule — the
 * customer's acceptance, the mandatory refusal reason, the numbering of the
 * schedule, whether the proposal may originate a policy — belongs to the
 * domain, and this file learns the answer by being refused. Nothing is
 * validated here beyond the shape the inputs already declare.
 */

import { ApiError, api } from '/app/shared/api.js';
import { formatMoney, sumMoney } from '/app/shared/money.js';
import { reportError, showSnackbar } from '/app/shared/shell.js';
import { statusChip } from '/app/shared/status.js';

/** What the wizard has accumulated. `null` means "this step has not run". */
const state = {
  proposalId: null,
  proposalNumber: null,
  netPremium: null,
};

const panels = {
  1: document.querySelector('[data-panel="1"]'),
  2: document.querySelector('[data-panel="2"]'),
  3: document.querySelector('[data-panel="3"]'),
  done: document.querySelector('[data-panel="done"]'),
};

function goToStep(step) {
  for (const [key, panel] of Object.entries(panels)) {
    panel.classList.toggle('hidden', key !== String(step));
  }

  for (const marker of document.querySelectorAll('.step')) {
    const position = Number(marker.dataset.step);
    const current = Number(step);

    if (Number.isNaN(current)) {
      marker.dataset.state = 'done';
      continue;
    }

    if (position < current) {
      marker.dataset.state = 'done';
      marker.querySelector('.step__bullet').textContent = 'check';
      marker.querySelector('.step__bullet').className = 'step__bullet material-symbols-outlined';
    } else if (position === current) {
      marker.dataset.state = 'current';
    } else {
      marker.removeAttribute('data-state');
    }
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function values(form) {
  return Object.fromEntries(new FormData(form).entries());
}

/** Keeps a submit button from firing twice while the request is in flight. */
async function submitting(form, work) {
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

/* ------------------------------------------------------------- step 1 -- */

const proposalForm = document.querySelector('#form-proposal');

proposalForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = values(proposalForm);

  submitting(proposalForm, async () => {
    const proposal = await api.registerProposal({
      clientId: input.clientId,
      brokerId: input.brokerId,
      insurerId: input.insurerId,
      productId: input.productId,
      paymentMethodId: input.paymentMethodId,
      // The checkbox is absent from the payload when unchecked; the domain is
      // what refuses it (REQ-040), so it travels as the boolean it is.
      customerAccepted: input.customerAccepted === 'on',
      netPremium: input.netPremium,
    });

    state.proposalId = proposal.id;
    state.netPremium = proposal.netPremium;

    document
      .querySelector('#proposal-chip')
      .replaceChildren(statusChip('proposal', proposal.status));
    document.querySelector('[name="premium"]').value = proposal.netPremium;

    showSnackbar('Proposta registrada.', { tone: 'success' });
    goToStep(2);
  });
});

/* ------------------------------------------------------------- step 2 -- */

const transmissionForm = document.querySelector('#form-transmission');

transmissionForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = values(transmissionForm);

  submitting(transmissionForm, async () => {
    const proposal = await api.transmitProposal(state.proposalId, {
      proposalNumber: input.proposalNumber,
      workedCommission: input.workedCommission,
    });

    state.proposalNumber = proposal.proposalNumber;

    document
      .querySelector('#transmission-chip')
      .replaceChildren(statusChip('proposal', proposal.status));

    showSnackbar(`Proposta ${proposal.proposalNumber} transmitida.`, { tone: 'success' });
    goToStep(3);
  });
});

/* ------------------------------------------------------------- step 3 -- */

const policyForm = document.querySelector('#form-policy');
const rejectionForm = document.querySelector('#form-rejection');

for (const option of document.querySelectorAll('.outcome-switch__option')) {
  option.addEventListener('click', () => {
    const accept = option.dataset.outcome === 'accept';

    for (const other of document.querySelectorAll('.outcome-switch__option')) {
      other.setAttribute('aria-selected', String(other === option));
    }

    policyForm.classList.toggle('hidden', !accept);
    rejectionForm.classList.toggle('hidden', accept);
  });
}

/* ------------------------------------------------- installment schedule -- */

const installments = document.querySelector('#installments');

function renumber() {
  const rows = [...installments.querySelectorAll('.installment-row')];

  rows.forEach((row, index) => {
    // The domain requires a sequence starting at 1 (REQ-091 needs a first
    // installment), so the position is derived, never typed.
    row.querySelector('.installment-row__number').textContent = String(index + 1);
    row.dataset.number = String(index + 1);
    row.querySelector('.installment-row__remove').disabled = rows.length === 1;
  });

  updateTotal();
}

function updateTotal() {
  const amounts = [...installments.querySelectorAll('[name="amount"]')].map((input) => input.value);
  const total = sumMoney(amounts);
  const label = document.querySelector('#installments-total');

  if (total === null) {
    label.textContent = '';
    return;
  }

  // Informative only: the domain does not require the schedule to add up to
  // the premium, and this line must not start implying that it does.
  label.textContent = `Soma das parcelas: ${formatMoney(total)}`;
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
      <input class="field__input" type="date" name="dueDate" required />
      <label class="field__label">Vencimento</label>
    </div>
    <button class="installment-row__remove" type="button" title="Remover parcela">
      <span class="material-symbols-outlined">close</span>
    </button>`;

  row.querySelector('.installment-row__remove').addEventListener('click', () => {
    row.remove();
    renumber();
  });
  row.querySelector('[name="amount"]').addEventListener('input', updateTotal);

  installments.append(row);
  renumber();
}

document.querySelector('#add-installment').addEventListener('click', addInstallmentRow);
addInstallmentRow();

/* ------------------------------------------------------ outcome: accept -- */

policyForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = values(policyForm);

  const schedule = [...installments.querySelectorAll('.installment-row')].map((row) => ({
    number: Number(row.dataset.number),
    amount: row.querySelector('[name="amount"]').value,
    dueDate: row.querySelector('[name="dueDate"]').value,
  }));

  submitting(policyForm, async () => {
    const policy = await api.registerPolicy({
      proposalId: state.proposalId,
      policyNumber: input.policyNumber,
      premium: input.premium,
      coverageStart: input.coverageStart,
      coverageEnd: input.coverageEnd,
      renewalDate: input.renewalDate,
      installments: schedule,
    });

    showSnackbar(`Apólice ${policy.policyNumber} registrada.`, { tone: 'success' });
    finish(policy);
  });
});

/* ------------------------------------------------------ outcome: reject -- */

rejectionForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = values(rejectionForm);

  submitting(rejectionForm, async () => {
    const proposal = await api.rejectProposal(state.proposalId, input.reason);

    showSnackbar('Recusa registrada.', { tone: 'neutral' });
    finishRejected(proposal);
  });
});

/* ---------------------------------------------------------- conclusion -- */

function conclusion({ icon, title, description, children = [] }) {
  const body = document.querySelector('#done-body');
  const empty = document.createElement('div');
  empty.className = 'empty';

  const symbol = document.createElement('span');
  symbol.className = 'material-symbols-outlined';
  symbol.textContent = icon;

  const heading = document.createElement('h2');
  heading.className = 'text-title';
  heading.textContent = title;

  const text = document.createElement('p');
  text.className = 'text-muted';
  text.textContent = description;

  const actions = document.createElement('div');
  actions.className = 'row';
  actions.style.marginTop = 'var(--space-2)';
  actions.append(...children);

  empty.append(symbol, heading, text, actions);
  body.replaceChildren(empty);
  goToStep('done');
}

function finish(policy) {
  const open = document.createElement('a');
  open.className = 'btn btn--filled';
  open.href = `/app/policies/detail.html?id=${encodeURIComponent(policy.id)}`;
  open.textContent = 'Abrir apólice';

  const again = document.createElement('a');
  again.className = 'btn btn--outlined';
  again.href = '/app/proposals/new.html';
  again.textContent = 'Registrar outro negócio';

  conclusion({
    icon: 'verified',
    title: `Apólice ${policy.policyNumber} registrada`,
    description: `Proposta ${policy.proposalNumber ?? '—'} aceita. A comissão acordada foi calculada junto com a apólice.`,
    children: [open, again],
  });
}

function finishRejected(proposal) {
  const again = document.createElement('a');
  again.className = 'btn btn--filled';
  again.href = '/app/proposals/new.html';
  again.textContent = 'Registrar outro negócio';

  conclusion({
    icon: 'block',
    title: 'Proposta recusada',
    description: `Motivo: ${proposal.rejectionReason}. O registro permanece consultável e não origina apólice.`,
    children: [again],
  });
}
