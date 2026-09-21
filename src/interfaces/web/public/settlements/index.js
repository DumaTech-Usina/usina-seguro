/**
 * OUT-07: o extrato de comissão por corretor.
 *
 * FP-03 acontece por apólice — abrir, liberar e registrar o pagamento — e até
 * aqui só era alcançável a partir da apólice. Este extrato é a outra metade:
 * por corretor, o que a Usina deve, o que está retido aguardando a confirmação
 * do recebimento (EX-07), o que está liberado a pagar e o que já foi pago
 * (REQ-095). Cada linha leva à apólice, que continua sendo onde o ato é feito.
 *
 * A página lê e filtra; não decide nada. Os totais vêm somados pelo backend,
 * em centavos exatos (REQ-120), e não são recalculados aqui. Trocar de
 * corretor é uma nova leitura, não uma fatia local.
 *
 * O relatório do período e o recibo de REQ-094/REQ-096 não estão aqui, e a
 * tela diz por quê: `DEC-008` não definiu a janela de apuração e `IN-01` não
 * existe, então não há nome de cliente nem ramo para imprimir.
 */

import { ApiError, api } from '/app/shared/api.js';
import { formatInstant, formatMoney } from '/app/shared/money.js';
import { reportError } from '/app/shared/shell.js';
import { describeStatus, statusChip } from '/app/shared/status.js';

const list = document.querySelector('#list');
const totals = document.querySelector('#totals');
const broker = document.querySelector('#broker');

const EVERY_BROKER = '';

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

function emptyState(iconName, title, description) {
  const empty = element('div', 'empty');
  empty.append(
    icon(iconName),
    element('h3', 'text-subtitle', title),
    element('p', undefined, description),
  );
  return empty;
}

function metric(label, value, highlight = false) {
  const wrapper = element('div', `metric${highlight ? ' metric--highlight' : ''}`);
  wrapper.append(element('span', 'text-label', label), element('span', 'metric__value', value));
  return wrapper;
}

/* -------------------------------------------------------------- filtro -- */

/**
 * Os corretores que o extrato completo trouxe.
 *
 * Não há cadastro de corretor (IN-01), então a lista é o que os negócios
 * registrados dizem — nada é inventado nem digitado a esmo.
 */
let brokers = [];

function renderBrokers(selected) {
  const options = [
    { value: EVERY_BROKER, label: 'Todos os corretores' },
    ...brokers.map((id) => ({ value: id, label: id })),
  ];

  broker.replaceChildren(
    ...options.map(({ value, label }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = value === selected;
      return option;
    }),
  );
}

/* --------------------------------------------------------------- table -- */

function settlementCell(line) {
  const cell = element('td');

  if (line.settlement === null) {
    // FP-03 passo 1: o repasse é aberto por ato do Financeiro, na apólice.
    cell.append(element('span', 'chip', 'Repasse não aberto'));
    cell.append(element('div', 'text-muted', 'Previsto pelo acordo vigente'));
    return cell;
  }

  cell.append(statusChip('settlement', line.settlement.status));
  cell.append(
    element('div', 'text-muted', describeStatus('releaseRule', line.settlement.releaseRule).label),
  );

  // REQ-124: o repasse carrega o valor com que foi aberto; um ajuste posterior
  // muda o que se espera, não o que já está em trânsito.
  if (line.settlement.amount !== line.payable) {
    cell.append(element('div', 'text-muted', `aberto por ${formatMoney(line.settlement.amount)}`));
  }

  return cell;
}

function paymentCell(line) {
  const cell = element('td');
  const payment = line.settlement?.payment ?? null;

  if (payment === null) {
    cell.textContent = '—';
    return cell;
  }

  cell.append(
    element('span', undefined, formatMoney(payment.amount)),
    element('div', 'text-muted proof', payment.proofReference),
    element('div', 'text-muted', `${payment.userId} · ${formatInstant(payment.paidAt)}`),
  );
  return cell;
}

function row(line) {
  const node = element('tr');

  const identification = element('td');
  identification.append(
    element('span', 'policy-number', line.policyNumber),
    element(
      'div',
      'text-muted',
      `Proposta ${line.proposalNumber ?? 'sem número'} · Cliente ${line.clientId}`,
    ),
    element('div', 'text-muted', `Corretor ${line.brokerId} · Ramo ${line.productId}`),
  );
  node.append(identification);

  const payable = element('td', 'is-numeric');
  payable.append(element('span', undefined, formatMoney(line.payable)));
  // REQ-076: a divergência da comissão a receber não bloqueia o repasse
  // (REQ-077), mas é o que OUT-07 pede que apareça no extrato.
  if (line.divergent) {
    payable.append(element('div', 'chip chip--danger', 'Comissão divergente'));
  }
  node.append(payable);

  node.append(settlementCell(line), paymentCell(line));

  const action = element('td', 'is-action');
  const open = element('a', 'btn btn--sm btn--outlined', 'Abrir apólice');
  open.href = `/app/policies/detail.html?id=${encodeURIComponent(line.policyId)}`;
  action.append(open);
  node.append(action);

  return node;
}

function table(lines) {
  const node = element('table', 'table');
  const head = element('thead');
  const headRow = element('tr');

  for (const [label, className] of [
    ['Apólice', ''],
    ['A pagar ao corretor', 'is-numeric'],
    ['Repasse', ''],
    ['Pagamento', ''],
    ['', 'is-action'],
  ]) {
    headRow.append(element('th', className, label));
  }

  head.append(headRow);
  const body = element('tbody');
  for (const line of lines) {
    body.append(row(line));
  }

  node.append(head, body);
  return node;
}

/* ---------------------------------------------------------------- page -- */

function loading() {
  const bar = element('div', 'stack');
  const skeleton = element('div', 'skeleton');
  skeleton.style.width = '40%';
  bar.append(skeleton);
  totals.replaceChildren(bar);

  const skeletons = element('div', 'card__body stack');
  for (const width of ['40%', '70%', '55%']) {
    const line = element('div', 'skeleton');
    line.style.width = width;
    skeletons.append(line);
  }
  list.replaceChildren(skeletons);
}

/** Os quatro números de OUT-07, como o backend os somou. */
function renderTotals(statement) {
  const grid = element('div', 'totals');
  grid.append(
    metric('Previsto (acordado)', formatMoney(statement.totals.payable)),
    metric('Aguardando confirmação', formatMoney(statement.totals.awaitingConfirmation)),
    metric(
      'Liberado a pagar',
      formatMoney(statement.totals.released),
      statement.totals.released !== '0.00',
    ),
    metric('Pago', formatMoney(statement.totals.paid)),
  );
  totals.replaceChildren(grid);
}

async function load(brokerId) {
  loading();

  let statement;
  try {
    statement = await api.getBrokerStatement(brokerId === EVERY_BROKER ? undefined : brokerId);
  } catch (error) {
    if (error instanceof ApiError) {
      reportError(error);
    }
    totals.replaceChildren();
    list.replaceChildren(
      emptyState(
        'cloud_off',
        'Não foi possível carregar o extrato',
        error instanceof ApiError ? error.message : 'Falha de comunicação com o servidor.',
      ),
    );
    return;
  }

  // A lista de corretores é a do extrato completo: um filtro não a encolhe.
  if (statement.brokerId === null) {
    brokers = [...new Set(statement.lines.map((line) => line.brokerId))].sort();
  }
  renderBrokers(statement.brokerId ?? EVERY_BROKER);
  renderTotals(statement);

  if (statement.lines.length === 0) {
    list.replaceChildren(
      emptyState(
        'payments',
        'Nenhuma comissão para este corretor',
        'O extrato começa quando a apólice é registrada e a comissão acordada é calculada.',
      ),
    );
    return;
  }

  list.replaceChildren(table(statement.lines));
}

broker.addEventListener('change', () => {
  load(broker.value);
});

renderBrokers(EVERY_BROKER);
load(EVERY_BROKER);
