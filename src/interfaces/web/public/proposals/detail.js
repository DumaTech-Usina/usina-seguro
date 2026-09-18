/**
 * The proposal an operator is following (REQ-043) and where its cycle ends.
 *
 * FP-01 keeps steps 4, 5 and 6 apart in time: a proposal is transmitted, waits
 * for the insurer, and only then gets an outcome. This page is where the wait
 * ends — it shows the record and offers the act the state admits.
 *
 * Which act is admissible is the domain's answer, not this file's. What is
 * hidden here is only what cannot exist yet: a proposal with no number has no
 * outcome to record, and one already accepted has a policy instead of a form.
 * Every refusal shown is the sentence the server rendered through `src/i18n`.
 */

import { ApiError, api } from '/app/shared/api.js';
import {
  formatDate,
  formatInstant,
  formatMoney,
  formatPercentage,
  sumMoney,
} from '/app/shared/money.js';
import { reportError, showSnackbar } from '/app/shared/shell.js';
import { statusChip } from '/app/shared/status.js';

const proposalId = new URLSearchParams(window.location.search).get('id');
const page = document.querySelector('#page');

const panels = {
  transmission: document.querySelector('[data-panel="transmission"]'),
  outcome: document.querySelector('[data-panel="outcome"]'),
};

/* ------------------------------------------------------------ helpers -- */

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function icon(name) {
  return element('span', 'material-symbols-outlined', name);
}

function definition(label, value) {
  const wrapper = element('div', 'definition');
  wrapper.append(element('span', 'text-label', label), element('span', 'definition__value', value));
  return wrapper;
}

function emptyState(iconName, title, description, action) {
  const empty = element('div', 'empty');
  empty.append(
    icon(iconName),
    element('h3', 'text-subtitle', title),
    element('p', undefined, description),
  );
  if (action !== undefined) {
    empty.append(action);
  }
  return empty;
}

function link(label, href, variant = 'outlined') {
  const node = element('a', `btn btn--${variant}`, label);
  node.href = href;
  return node;
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

/* ------------------------------------------------------------ summary -- */

function summaryCard(proposal) {
  const section = element('section', 'card');
  const body = element('div', 'card__body stack');

  const head = element('div', 'proposal-head');
  const numbers = element('div', 'proposal-head__numbers');
  numbers.append(
    element('span', 'text-label', 'Número da proposta'),
    element(
      'span',
      'proposal-head__number',
      // REQ-041: the insurer issues it in the act of transmitting.
      proposal.proposalNumber ?? 'ainda não transmitida',
    ),
  );

  const chip = statusChip('proposal', proposal.status);
  chip.style.marginLeft = 'auto';
  head.append(numbers, chip);

  const details = element('div', 'definitions');
  details.append(
    definition('Cliente', proposal.clientId),
    definition('Corretor', proposal.brokerId),
    definition('Seguradora', proposal.insurerId),
    definition('Produto / ramo', proposal.productId),
    definition('Forma de pagamento', proposal.paymentMethodId),
    definition('Prêmio líquido', formatMoney(proposal.netPremium)),
    definition(
      'Comissão trabalhada',
      proposal.workedCommission === null ? '—' : formatPercentage(proposal.workedCommission),
    ),
    definition('Registro', formatInstant(proposal.registeredAt)),
    definition(
      'Transmissão',
      proposal.transmittedAt === null ? '—' : formatInstant(proposal.transmittedAt),
    ),
  );

  body.append(head, details);
  section.append(body);
  return section;
}

/** REQ-045, REQ-046: the cycle ended, the record and its reason remain. */
function rejectionCard(proposal) {
  const section = element('section', 'card');
  const body = element('div', 'card__body');
  body.append(
    emptyState(
      'block',
      'Proposta recusada',
      `Motivo: ${proposal.rejectionReason}. O ciclo comercial está encerrado e a proposta não origina apólice.`,
      link('Ver propostas', '/app/proposals/'),
    ),
  );
  section.append(body);
  return section;
}

/** FP-01 step 6, acceptance branch: where the flow lands (REQ-048, REQ-050). */
function policyCard(policy) {
  const section = element('section', 'card');
  const header = element('div', 'card__header');
  header.append(icon('shield'), element('h2', 'text-title', 'Apólice registrada'));

  const body = element('div', 'card__body stack');

  if (policy === null) {
    body.append(
      emptyState(
        'help',
        'Apólice não localizada',
        'A proposta consta como aceita, mas a apólice correspondente não foi encontrada.',
      ),
    );
    section.append(header, body);
    return section;
  }

  const details = element('div', 'definitions');
  details.append(
    definition('Número da apólice', policy.policyNumber),
    definition('Prêmio', formatMoney(policy.premium)),
    definition(
      'Vigência',
      `${formatDate(policy.coverageStart)} — ${formatDate(policy.coverageEnd)}`,
    ),
    definition('Renovação', formatDate(policy.renewalDate)),
    definition('Parcelas', String(policy.installments.length)),
  );

  const actions = element('div', 'row');
  actions.append(
    link(
      'Abrir apólice',
      `/app/policies/detail.html?id=${encodeURIComponent(policy.id)}`,
      'filled',
    ),
  );

  body.append(details, actions);
  section.append(header, body);
  return section;
}

/* ---------------------------------------------- outcome: the schedule -- */

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

/* ------------------------------------------------------------ actions -- */

const transmissionForm = document.querySelector('#form-transmission');
const policyForm = document.querySelector('#form-policy');
const rejectionForm = document.querySelector('#form-rejection');

function values(form) {
  return Object.fromEntries(new FormData(form).entries());
}

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

transmissionForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = values(transmissionForm);

  submitting(transmissionForm, async () => {
    const proposal = await api.transmitProposal(proposalId, {
      proposalNumber: input.proposalNumber,
      workedCommission: input.workedCommission,
    });

    showSnackbar(`Proposta ${proposal.proposalNumber} transmitida.`, { tone: 'success' });
    await render();
  });
});

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
      proposalId,
      policyNumber: input.policyNumber,
      premium: input.premium,
      coverageStart: input.coverageStart,
      coverageEnd: input.coverageEnd,
      renewalDate: input.renewalDate,
      installments: schedule,
    });

    showSnackbar(`Apólice ${policy.policyNumber} registrada.`, { tone: 'success' });
    await render();
  });
});

rejectionForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = values(rejectionForm);

  submitting(rejectionForm, async () => {
    await api.rejectProposal(proposalId, input.reason);

    showSnackbar('Recusa registrada.', { tone: 'neutral' });
    await render();
  });
});

/* --------------------------------------------------------------- page -- */

function notFound(message) {
  const section = element('section', 'card');
  const body = element('div', 'card__body');
  body.append(
    emptyState(
      'search_off',
      'Proposta não encontrada',
      message,
      link('Ver propostas', '/app/proposals/'),
    ),
  );
  section.append(body);
  page.replaceChildren(section);
  show(null);
}

/** Only one panel is ever open, and none of them for a finished proposal. */
function show(panel) {
  for (const [name, node] of Object.entries(panels)) {
    node.classList.toggle('hidden', name !== panel);
  }
}

function header() {
  const head = element('div', 'page-head');
  const text = element('div', 'page-head__text');
  text.append(
    element('h1', 'text-display', 'Proposta'),
    element('p', 'text-muted', 'Registro, transmissão à seguradora e desfecho — aceite ou recusa.'),
  );
  const actions = element('div', 'page-head__actions');
  actions.append(link('Ver propostas', '/app/proposals/'));
  head.append(text, actions);
  return head;
}

async function render() {
  if (proposalId === null || proposalId === '') {
    notFound('Informe o identificador da proposta na URL.');
    return;
  }

  let proposal;
  try {
    proposal = await api.getProposal(proposalId);
  } catch (error) {
    notFound(error instanceof ApiError ? error.message : 'Falha ao consultar a proposta.');
    return;
  }

  const sections = [header(), summaryCard(proposal)];

  if (proposal.status === 'REJECTED') {
    sections.push(rejectionCard(proposal));
    show(null);
  } else if (proposal.status === 'ACCEPTED') {
    // REQ-111: accepted only exists together with the policy (REQ-048).
    let policy = null;
    try {
      policy = await api.getPolicyByProposal(proposalId);
    } catch (error) {
      if (!(error instanceof ApiError && error.isNotFound)) {
        throw error;
      }
    }
    sections.push(policyCard(policy));
    show(null);
  } else if (proposal.status === 'TRANSMITTED') {
    show('outcome');
    // A convenience, not a rule: the premium of the policy is typed and may
    // differ from the net premium of the proposal.
    policyForm.querySelector('[name="premium"]').value = proposal.netPremium;
  } else if (proposal.status === 'DRAFT') {
    show('transmission');
  } else {
    show(null);
  }

  page.replaceChildren(...sections);
}

render();
