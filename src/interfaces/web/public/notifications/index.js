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
 * corretor é uma nova leitura, não uma fatia local. A lista vem em páginas
 * (REQ-330), e o filtro oferece os corretores cadastrados (REQ-334).
 *
 * Não há "marcar como lida" nem exclusão: nenhum requisito define essas
 * operações, e REQ-105 pede um registro do que foi notificado.
 */

import { fromAddress, rememberInAddress } from '/app/shared/address.js';
import { ApiError, api } from '/app/shared/api.js';
import { formatInstant, formatMoney, formatPercentage } from '/app/shared/money.js';
import {
  firstPage,
  pageToRetry,
  pager,
  pagingFromAddress,
  rememberPaging,
} from '/app/shared/pager.js';
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
        : // REQ-228: a parcelled CT is notified with both CTs, first / subsequent.
          [notification.workedCommission, notification.subsequentWorkedCommission]
            .filter((rate) => rate !== null)
            .map(formatPercentage)
            .join(' / '),
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

/** The recipient of the reading on screen: the select may not offer it before the brokers load. */
let shownRecipient = EVERY_RECIPIENT;

// REQ-330, REQ-332: the page on screen and how many lines it holds.
let paging = pagingFromAddress();

/**
 * REQ-334: the filter offers the registered brokers — the recipient is always
 * a broker (REQ-100) — including the ones with no notification yet.
 */
async function loadRecipients() {
  try {
    recipients = (await api.listBrokers()).map(({ id, name }) => ({ id, name }));
  } catch (error) {
    if (error instanceof ApiError) {
      reportError(error);
    }
  }
  renderRecipients(shownRecipient);
}

async function load(recipientId) {
  rememberPaging(paging);
  shownRecipient = recipientId;
  rememberInAddress({ recipientId });
  loading();

  let notifications;
  try {
    notifications = await api.listNotifications(
      recipientId === EVERY_RECIPIENT ? undefined : recipientId,
      paging,
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

  const retry = pageToRetry(notifications);
  if (retry !== null && notifications.total > 0) {
    paging = { ...paging, page: retry };
    load(recipientId);
    return;
  }

  if (notifications.total === 0) {
    list.replaceChildren(
      recipientId === EVERY_RECIPIENT
        ? emptyState(
            'notifications_off',
            'Nenhuma emissão notificada ainda',
            'A notificação é produzida quando a apólice é registrada a partir da proposta emitida.',
          )
        : emptyState(
            'notifications_off',
            'Nenhuma notificação para este corretor',
            'Escolha outro corretor ou volte a todos.',
          ),
    );
    return;
  }

  list.replaceChildren(
    table(notifications.items),
    pager(notifications, {
      onPage: (page) => {
        paging = { ...paging, page };
        load(recipientId);
      },
      onSize: (size) => {
        paging = firstPage(size);
        load(recipientId);
      },
    }),
  );
}

recipient.addEventListener('change', () => {
  paging = firstPage(paging.size);
  load(recipient.value);
});

// The recipient the address asks for, kept while the registry of brokers loads.
const asked = fromAddress('recipientId');
renderRecipients(asked);
recipient.value = asked;
loadRecipients();
load(asked);
