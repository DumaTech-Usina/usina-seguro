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
 * tela diz por quê: `DEC-008` não definiu a janela de apuração. Os cinco
 * campos que eles exigem já existem — `IN-01` os entregou e este extrato os
 * mostra —, então o que falta é o período, não o dado.
 */

import { ApiError, api } from '/app/shared/api.js';
import { formatInstant, formatMoney } from '/app/shared/money.js';
import { referenceLabel } from '/app/shared/reference.js';
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
 * Os corretores que o extrato completo trouxe, com o nome de IN-01.
 *
 * A lista continua sendo o que os negócios registrados dizem, e não o cadastro:
 * o extrato é por corretor que tem comissão, não por corretor cadastrado. O
 * cadastro só dá nome ao que já estava aqui, e um corretor sem cadastro
 * continua na lista pelo identificador.
 */
let brokers = [];

function renderBrokers(selected) {
  const options = [
    { value: EVERY_BROKER, label: 'Todos os corretores' },
    ...brokers.map(({ id, name }) => ({ value: id, label: referenceLabel(name, id) })),
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

  // REQ-095, CA-028: o comprovante é o documento anexado, e daqui ele é
  // aberto. O nome basta para reconhecê-lo; o tamanho fica na apólice, que é
  // onde o anexo acabou de ser enviado.
  const proof = element('a', 'proof-link');
  proof.href = api.settlementPaymentProofUrl(line.policyId);
  proof.append(icon('attach_file'), element('span', undefined, payment.proof.fileName));

  cell.append(
    element('span', undefined, formatMoney(payment.amount)),
    proof,
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
      `Proposta ${line.proposalNumber ?? 'sem número'} · ${referenceLabel(
        line.clientName,
        line.clientId,
      )}`,
    ),
    element(
      'div',
      'text-muted',
      `${referenceLabel(line.brokerName, line.brokerId)} · ${referenceLabel(
        line.productName,
        line.productId,
      )}`,
    ),
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
    brokers = [...new Map(statement.lines.map((line) => [line.brokerId, line])).values()]
      .map((line) => ({ id: line.brokerId, name: line.brokerName }))
      .sort((a, b) =>
        referenceLabel(a.name, a.id).localeCompare(referenceLabel(b.name, b.id), 'pt-BR'),
      );
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
