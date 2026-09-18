/**
 * The policy an operator works on: schedule, commission and broker transfer.
 *
 * Where FP-01 lands. The agreed commission shown here is the one calculated
 * when the policy was registered; the real one appears once a commission
 * report is conciliated, and the two sit side by side with the divergence
 * flagged.
 *
 * The page renders state and offers actions. Which action is admissible is the
 * domain's answer: a button that the domain refuses shows the refusal, it does
 * not disappear on a rule this file invented. The only thing hidden is what
 * cannot exist yet — a transfer that was never opened has nothing to release.
 */

import { ApiError, api } from '/app/shared/api.js';
import { formatDate, formatInstant, formatMoney, formatPercentage } from '/app/shared/money.js';
import { reportError, showSnackbar } from '/app/shared/shell.js';
import { describeStatus, statusChip } from '/app/shared/status.js';

const policyId = new URLSearchParams(window.location.search).get('id');
const page = document.querySelector('#page');

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

function card(title, iconName, ...body) {
  const section = element('section', 'card');
  const header = element('div', 'card__header');
  header.append(icon(iconName), element('h2', 'text-title', title));
  section.append(header, ...body);
  return { section, header };
}

function definition(label, value) {
  const wrapper = element('div', 'definition');
  wrapper.append(element('span', 'text-label', label), element('span', 'definition__value', value));
  return wrapper;
}

function metric(label, value, highlight = false) {
  const wrapper = element('div', `metric${highlight ? ' metric--highlight' : ''}`);
  wrapper.append(element('span', 'text-label', label), element('span', 'metric__value', value));
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

function button(label, { variant = 'outlined', iconName, onClick }) {
  const node = element('button', `btn btn--${variant}`);
  if (iconName !== undefined) {
    node.append(icon(iconName));
  }
  node.append(document.createTextNode(label));
  node.addEventListener('click', onClick);
  return node;
}

/** Opens a dialog and resolves with its fields, or null when dismissed. */
function ask(id, prepare) {
  const dialog = document.querySelector(id);
  const form = dialog.querySelector('form');
  form.reset();

  if (prepare !== undefined) {
    prepare(dialog);
  }

  dialog.showModal();

  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        resolve(dialog.returnValue === 'confirm' ? Object.fromEntries(new FormData(form)) : null);
      },
      { once: true },
    );
  });
}

/** Runs an operation and reloads the page state, reporting a refusal. */
async function perform(work, success) {
  try {
    await work();
    showSnackbar(success, { tone: 'success' });
    await render();
  } catch (error) {
    if (error instanceof ApiError) {
      reportError(error);
    } else {
      showSnackbar('Falha de comunicação com o servidor.', { tone: 'danger' });
    }
  }
}

/* -------------------------------------------------------------- header -- */

function policyCard(policy) {
  const section = element('section', 'card');
  const body = element('div', 'card__body stack');

  const head = element('div', 'policy-head');
  const numbers = element('div', 'policy-head__numbers');
  numbers.append(
    element('span', 'text-label', 'Número da apólice'),
    element('span', 'policy-head__number', policy.policyNumber),
    element('span', 'text-muted', `Proposta ${policy.proposalNumber ?? '—'}`),
  );

  const chip = statusChip('policy', policy.status);
  chip.style.marginLeft = 'auto';

  head.append(numbers, chip);

  const details = element('div', 'definitions');
  details.append(
    definition('Prêmio', formatMoney(policy.premium)),
    definition(
      'Vigência',
      `${formatDate(policy.coverageStart)} — ${formatDate(policy.coverageEnd)}`,
    ),
    definition('Renovação', formatDate(policy.renewalDate)),
    definition('Registro', formatInstant(policy.registeredAt)),
  );

  body.append(head, details);
  section.append(body);
  return section;
}

/* ----------------------------------------------------------- schedule -- */

function installmentsCard(policy) {
  const { section } = card('Parcelas', 'receipt_long');
  const body = element('div', 'card__body card__body--flush');

  const table = element('table', 'table');
  const head = element('thead');
  const headRow = element('tr');
  for (const [label, className] of [
    ['#', ''],
    ['Valor', 'is-numeric'],
    ['Vencimento', ''],
    ['Situação', ''],
    ['Confirmação', ''],
    ['', 'is-action'],
  ]) {
    headRow.append(element('th', className, label));
  }
  head.append(headRow);

  const rows = element('tbody');

  for (const installment of policy.installments) {
    const row = element('tr');
    row.append(
      element('td', 'text-numeric', String(installment.number)),
      element('td', 'is-numeric', formatMoney(installment.amount)),
      element('td', undefined, formatDate(installment.dueDate)),
    );

    const status = element('td');
    status.append(statusChip('installment', installment.status));
    row.append(status);

    // REQ-123: who confirmed the receipt, and when.
    const confirmation = element('td', 'text-muted');
    confirmation.textContent =
      installment.confirmedBy === null
        ? '—'
        : `${installment.confirmedBy} · ${formatInstant(installment.confirmedAt)}`;
    row.append(confirmation);

    const action = element('td', 'is-action');
    if (installment.status === 'PENDING') {
      action.append(
        button('Confirmar recebimento', {
          variant: 'sm btn--outlined',
          onClick: () => confirmInstallment(policy, installment),
        }),
      );
    }
    row.append(action);

    rows.append(row);
  }

  table.append(head, rows);
  body.append(table);
  section.append(body);
  return section;
}

async function confirmInstallment(policy, installment) {
  const answer = await ask('#dialog-installment', (dialog) => {
    dialog.querySelector('#dialog-installment-subtitle').textContent =
      `Parcela ${installment.number} — ${formatMoney(installment.amount)}, vencimento ${formatDate(installment.dueDate)}.`;
  });

  if (answer === null) {
    return;
  }

  await perform(
    () => api.payInstallment(policy.id, installment.number, answer.userId),
    `Recebimento da parcela ${installment.number} confirmado.`,
  );
}

/* --------------------------------------------------------- commission -- */

function commissionCard(policy, commission) {
  const { section, header } = card('Comissão', 'percent');
  const body = element('div', 'card__body stack');

  if (commission === null) {
    body.append(
      emptyState(
        'price_change',
        'Nenhuma comissão calculada',
        'A apólice foi registrada sem acordo comercial vigente ou sem tabela do corretor. Cadastre-os e registre um novo negócio.',
        (() => {
          const link = element('a', 'btn btn--outlined', 'Abrir cadastros');
          link.href = '/app/settings/';
          return link;
        })(),
      ),
    );
    section.append(body);
    return section;
  }

  header.append(
    (() => {
      const actions = element('div', 'card__header-actions');
      actions.append(statusChip('commission', commission.status));
      if (commission.divergent) {
        const flag = element('span', 'chip chip--danger', 'Acordado ≠ real');
        actions.append(flag);
      }
      return actions;
    })(),
  );

  // The agreed and the real value side by side, which is the whole point of
  // the panel; the divergence is signalled and blocks nothing.
  const comparison = element('div', 'comparison');
  comparison.append(
    metric('Acordado a receber', formatMoney(commission.effectiveReceivable)),
    metric(
      'Real a receber',
      commission.realReceivable === null ? 'Não apurado' : formatMoney(commission.realReceivable),
      commission.divergent,
    ),
    metric('A pagar ao corretor', formatMoney(commission.effectivePayable)),
  );
  body.append(comparison);

  const basis = element('div', 'definitions');
  basis.append(
    definition('Prêmio base', formatMoney(commission.basis.premium)),
    definition('% seguradora', formatPercentage(commission.basis.insurerRate)),
    definition('Valor da seguradora', formatMoney(commission.basis.insurerAmount)),
    definition('% corretor', formatPercentage(commission.basis.brokerRate)),
    definition(
      'Base do corretor',
      commission.basis.brokerBase === 'USINA' ? 'Valor da Usina' : 'Valor da intermediária',
    ),
    definition('Competência', commission.reconciledCompetence ?? '—'),
  );
  body.append(basis);

  if (commission.override !== null) {
    body.append(
      auditNote(
        'override',
        'Ajuste aplicado',
        commission.override.justification,
        commission.override,
      ),
    );
  }

  if (commission.resolution !== null) {
    body.append(
      auditNote(
        'resolved',
        'Divergência resolvida',
        commission.resolution.justification,
        commission.resolution,
      ),
    );
  }

  const footer = element('div', 'card__footer');
  footer.append(
    button('Ajustar comissão', { iconName: 'tune', onClick: () => overrideCommission(policy) }),
  );
  if (commission.status === 'DIVERGENT') {
    footer.append(
      button('Resolver divergência', {
        variant: 'filled',
        iconName: 'fact_check',
        onClick: () => resolveDivergence(policy),
      }),
    );
  }

  section.append(body, footer);
  return section;
}

function auditNote(kind, title, justification, record) {
  const note = element('div', `audit-note audit-note--${kind}`);
  const body = element('div', 'audit-note__body');
  body.append(
    element('span', 'text-label', title),
    element('span', undefined, justification),
    element('span', 'text-muted', `${record.userId} · ${formatInstant(record.at)}`),
  );
  note.append(icon(kind === 'resolved' ? 'fact_check' : 'tune'), body);
  return note;
}

async function overrideCommission(policy) {
  const answer = await ask('#dialog-override');
  if (answer === null) {
    return;
  }

  const input = { justification: answer.justification, userId: answer.userId };
  // An absent value means "do not touch this side" (REQ-066); an empty string
  // is not a value, so it is left out rather than sent as one.
  if (answer.receivable !== '') {
    input.receivable = answer.receivable;
  }
  if (answer.payable !== '') {
    input.payable = answer.payable;
  }

  await perform(() => api.overrideCommission(policy.id, input), 'Ajuste aplicado.');
}

async function resolveDivergence(policy) {
  const answer = await ask('#dialog-resolution');
  if (answer === null) {
    return;
  }

  await perform(() => api.resolveDivergence(policy.id, answer), 'Resolução registrada.');
}

/* --------------------------------------------------------- settlement -- */

function settlementCard(policy, settlement) {
  const { section, header } = card('Repasse ao corretor', 'payments');
  const body = element('div', 'card__body stack');

  if (settlement === null) {
    body.append(
      emptyState(
        'payments',
        'Repasse não aberto',
        'O repasse é aberto pelo Financeiro depois que a comissão real é apurada na conciliação.',
        button('Abrir repasse', {
          variant: 'filled',
          iconName: 'add',
          onClick: () => perform(() => api.openSettlement(policy.id), 'Repasse aberto.'),
        }),
      ),
    );
    section.append(body);
    return section;
  }

  const actions = element('div', 'card__header-actions');
  actions.append(statusChip('settlement', settlement.status));
  header.append(actions);

  const details = element('div', 'definitions');
  details.append(
    definition('Valor', formatMoney(settlement.amount)),
    definition('Corretor', settlement.brokerId),
    definition('Regra de liberação', describeStatus('releaseRule', settlement.releaseRule).label),
    definition(
      'Liberado em',
      settlement.releasedAt === null ? '—' : formatInstant(settlement.releasedAt),
    ),
  );
  body.append(details);

  if (settlement.payment !== null) {
    const payment = element('div', 'audit-note audit-note--resolved');
    const text = element('div', 'audit-note__body');
    text.append(
      element('span', 'text-label', 'Pagamento registrado'),
      element(
        'span',
        undefined,
        `${formatMoney(settlement.payment.amount)} · comprovante ${settlement.payment.proofReference}`,
      ),
      element(
        'span',
        'text-muted',
        `${settlement.payment.userId} · ${formatInstant(settlement.payment.paidAt)}`,
      ),
    );
    payment.append(icon('receipt'), text);
    body.append(payment);
  }

  const footer = element('div', 'card__footer');

  if (settlement.status === 'AWAITING_CONFIRMATION') {
    footer.append(
      button('Liberar repasse', {
        variant: 'filled',
        iconName: 'lock_open',
        onClick: () => perform(() => api.releaseSettlement(policy.id), 'Repasse liberado.'),
      }),
    );
  }

  if (settlement.status === 'RELEASED') {
    footer.append(
      button('Registrar pagamento', {
        variant: 'filled',
        iconName: 'paid',
        onClick: () => registerPayment(policy, settlement),
      }),
    );
  }

  section.append(body);
  if (footer.childElementCount > 0) {
    section.append(footer);
  }
  return section;
}

async function registerPayment(policy, settlement) {
  const answer = await ask('#dialog-payment', (dialog) => {
    // The expected amount is offered, not imposed: REQ-095 records what was
    // actually sent, which may differ.
    dialog.querySelector('[name="amount"]').value = settlement.amount;
  });

  if (answer === null) {
    return;
  }

  await perform(() => api.registerSettlementPayment(policy.id, answer), 'Pagamento registrado.');
}

/* --------------------------------------------------------------- page -- */

/** A read that answers 404 means "does not exist yet", not a failure. */
async function optional(read) {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) {
      return null;
    }
    throw error;
  }
}

function notFound(message) {
  const section = element('section', 'card');
  const body = element('div', 'card__body');
  const back = element('a', 'btn btn--outlined', 'Voltar ao início');
  back.href = '/app/';
  body.append(emptyState('search_off', 'Apólice não encontrada', message, back));
  section.append(body);
  page.replaceChildren(section);
}

async function render() {
  if (policyId === null || policyId === '') {
    notFound('Informe o identificador da apólice na URL.');
    return;
  }

  let policy;
  try {
    policy = await api.getPolicy(policyId);
  } catch (error) {
    notFound(error instanceof ApiError ? error.message : 'Falha ao consultar a apólice.');
    return;
  }

  const [commission, settlement] = await Promise.all([
    optional(() => api.getCommission(policyId)),
    optional(() => api.getSettlement(policyId)),
  ]);

  const head = element('div', 'page-head');
  const text = element('div', 'page-head__text');
  text.append(
    element('h1', 'text-display', 'Apólice'),
    element('p', 'text-muted', 'Parcelas, comissão acordada × real e repasse ao corretor.'),
  );
  const actions = element('div', 'page-head__actions');
  const another = element('a', 'btn btn--outlined', 'Novo negócio');
  another.href = '/app/proposals/new.html';
  actions.append(another);
  head.append(text, actions);

  page.replaceChildren(
    head,
    policyCard(policy),
    installmentsCard(policy),
    commissionCard(policy, commission),
    settlementCard(policy, settlement),
  );
}

render();
