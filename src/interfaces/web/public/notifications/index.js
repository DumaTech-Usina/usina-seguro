/**
 * OUT-10: as notificações de emissão efetivada.
 *
 * É o outro lado de FP-01 passo 7. O cálculo da comissão acordada já era
 * visível na apólice; o que o corretor foi avisado não era visível em lugar
 * nenhum. Esta tela é a entrega interna de REQ-102: a notificação registrada
 * por REQ-105 lida dentro do próprio sistema.
 *
 * A página lê e filtra; não decide nada e não escreve nada. Os cinco campos de
 * REQ-100 vêm como foram notificados — o backend guardou o nome que o cadastro
 * de IN-01 tinha naquele momento, e não o que ele tem hoje —, e trocar de
 * corretor é uma nova leitura, não uma fatia local.
 *
 * Não há "marcar como lida" nem exclusão: nenhum requisito define essas
 * operações, e REQ-105 pede um registro do que foi notificado.
 */

import { ApiError, api } from '/app/shared/api.js';
import { formatInstant, formatMoney, formatPercentage } from '/app/shared/money.js';
import { referenceLabel } from '/app/shared/reference.js';
import { reportError } from '/app/shared/shell.js';

const list = document.querySelector('#list');
const recipient = document.querySelector('#recipient');

const EVERY_RECIPIENT = '';

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

/* -------------------------------------------------------------- filtro -- */

/**
 * Os corretores que a leitura completa trouxe, com o nome de IN-01.
 *
 * A lista é a dos corretores que têm notificação, não a do cadastro: quem
 * nunca teve uma emissão efetivada não tem nada a mostrar aqui. Um corretor
 * sem cadastro continua na lista, pelo identificador (REQ-002).
 */
let recipients = [];

function renderRecipients(selected) {
  const options = [
    { value: EVERY_RECIPIENT, label: 'Todos os corretores' },
    ...recipients.map(({ id, name }) => ({ value: id, label: referenceLabel(name, id) })),
  ];

  recipient.replaceChildren(
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

function row(notification) {
  const line = element('tr');

  const emission = element('td');
  emission.append(
    element('span', 'policy-number', notification.policyNumber),
    // REQ-105: quando. O instante é mostrado no fuso de quem lê.
    element('div', 'text-muted', formatInstant(notification.occurredAt)),
  );
  line.append(emission);

  // Os cinco campos de REQ-100/REQ-096, um por coluna.
  line.append(
    element('td', undefined, referenceLabel(notification.client.name, notification.client.id)),
    element('td', undefined, referenceLabel(notification.product.name, notification.product.id)),
    element('td', undefined, referenceLabel(notification.broker.name, notification.broker.id)),
    element(
      'td',
      'is-numeric',
      notification.workedCommission === null
        ? '—'
        : formatPercentage(notification.workedCommission),
    ),
    element('td', 'is-numeric', formatMoney(notification.netPremium)),
  );

  const action = element('td', 'is-action');
  // FP-01 passo 8: a apólice é o que o corretor encaminha ao segurado.
  const open = element('a', 'btn btn--sm btn--outlined', 'Abrir apólice');
  open.href = `/app/policies/detail.html?id=${encodeURIComponent(notification.policyId)}`;
  action.append(open);
  line.append(action);

  return line;
}

function table(notifications) {
  const node = element('table', 'table');
  const head = element('thead');
  const headRow = element('tr');

  for (const [label, className] of [
    ['Emissão efetivada', ''],
    ['Cliente', ''],
    ['Ramo', ''],
    ['Corretor', ''],
    ['% trabalhada', 'is-numeric'],
    ['Valor líquido', 'is-numeric'],
    ['', 'is-action'],
  ]) {
    headRow.append(element('th', className, label));
  }

  head.append(headRow);
  const body = element('tbody');
  for (const notification of notifications) {
    body.append(row(notification));
  }

  node.append(head, body);
  return node;
}

/* ---------------------------------------------------------------- page -- */

function loading() {
  const skeletons = element('div', 'card__body stack');
  for (const width of ['40%', '70%', '55%']) {
    const bar = element('div', 'skeleton');
    bar.style.width = width;
    skeletons.append(bar);
  }
  list.replaceChildren(skeletons);
}

async function load(recipientId) {
  loading();

  let notifications;
  try {
    notifications = await api.listNotifications(
      recipientId === EVERY_RECIPIENT ? undefined : recipientId,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      reportError(error);
    }
    list.replaceChildren(
      emptyState(
        'cloud_off',
        'Não foi possível carregar as notificações',
        error instanceof ApiError ? error.message : 'Falha de comunicação com o servidor.',
      ),
    );
    return;
  }

  // A lista de corretores é a da leitura completa: um filtro não a encolhe.
  if (recipientId === EVERY_RECIPIENT) {
    recipients = [
      ...new Map(
        notifications.map((notification) => [notification.recipientId, notification.broker]),
      ).values(),
    ].sort((a, b) =>
      referenceLabel(a.name, a.id).localeCompare(referenceLabel(b.name, b.id), 'pt-BR'),
    );
  }
  renderRecipients(recipientId);

  if (notifications.length === 0) {
    // Uma só mensagem porque só há um caso: a lista de corretores é a da
    // leitura completa, então um corretor que aparece no filtro tem ao menos
    // uma notificação. Um estado "nada para este corretor" seria texto que
    // ninguém consegue alcançar.
    list.replaceChildren(
      emptyState(
        'notifications_off',
        'Nenhuma emissão notificada ainda',
        'A notificação é produzida quando a apólice é registrada a partir da proposta aceita.',
      ),
    );
    return;
  }

  list.replaceChildren(table(notifications));
}

recipient.addEventListener('change', () => {
  load(recipient.value);
});

renderRecipients(EVERY_RECIPIENT);
load(EVERY_RECIPIENT);
