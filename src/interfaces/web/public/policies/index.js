/**
 * OUT-03 e OUT-04: o controle das apólices vendidas e as que estão a vencer.
 *
 * Até aqui uma apólice só era alcançável pela proposta que a originou ou pelo
 * identificador digitado à mão. Esta é a porta de entrada que faltava: a lista
 * do que a Usina intermediou, com vigência, prêmio e situação (REQ-020), e o
 * corte por data de renovação que REQ-055 pede.
 *
 * A página lê e filtra; não decide nada. Mudar a data é uma nova leitura no
 * backend, não uma fatia da anterior, e a ordem — renovação mais próxima
 * primeiro — vem de lá. Nenhum requisito define o que é uma renovação
 * "próxima" (CA-032), então a janela é informada pelo operador e nada é
 * arbitrado aqui.
 *
 * Cada linha termina na apólice, que é onde as parcelas, a comissão e o
 * repasse são operados.
 */

import { ApiError, api } from '/app/shared/api.js';
import { formatDate, formatMoney } from '/app/shared/money.js';
import { reportError } from '/app/shared/shell.js';
import { statusChip } from '/app/shared/status.js';

const list = document.querySelector('#list');
const summary = document.querySelector('#summary');
const renewalUntil = document.querySelector('#renewal-until');
const clear = document.querySelector('#clear');

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

/* --------------------------------------------------------------- table -- */

function row(policy) {
  const line = element('tr');

  const identification = element('td');
  identification.append(
    element('span', 'policy-number', policy.policyNumber),
    // REQ-050: os dois números ficam consultáveis, mesmo quando coincidem.
    element(
      'div',
      'text-muted',
      `Proposta ${policy.proposalNumber ?? 'sem número'} · Cliente ${policy.clientId}`,
    ),
    element('div', 'text-muted', `Seguradora ${policy.insurerId} · Ramo ${policy.productId}`),
  );
  line.append(identification);

  // REQ-020: a vigência é um par de dias de calendário, não um instante.
  const coverage = element('td');
  coverage.append(
    element(
      'span',
      undefined,
      `${formatDate(policy.coverageStart)} — ${formatDate(policy.coverageEnd)}`,
    ),
  );
  line.append(coverage);

  line.append(
    element('td', 'renewal', formatDate(policy.renewalDate)),
    element('td', 'is-numeric', formatMoney(policy.premium)),
  );

  const status = element('td');
  status.append(statusChip('policy', policy.status));
  line.append(status);

  const action = element('td', 'is-action');
  const open = element('a', 'btn btn--sm btn--outlined', 'Abrir apólice');
  open.href = `/app/policies/detail.html?id=${encodeURIComponent(policy.id)}`;
  action.append(open);
  line.append(action);

  return line;
}

function table(policies) {
  const node = element('table', 'table');
  const head = element('thead');
  const headRow = element('tr');

  for (const [label, className] of [
    ['Apólice', ''],
    ['Vigência', ''],
    ['Renovação', ''],
    ['Prêmio', 'is-numeric'],
    ['Situação', ''],
    ['', 'is-action'],
  ]) {
    headRow.append(element('th', className, label));
  }

  head.append(headRow);
  const body = element('tbody');
  for (const policy of policies) {
    body.append(row(policy));
  }

  node.append(head, body);
  return node;
}

/* ---------------------------------------------------------------- page -- */

function loading() {
  summary.replaceChildren();
  const skeletons = element('div', 'card__body stack');
  for (const width of ['40%', '70%', '55%']) {
    const bar = element('div', 'skeleton');
    bar.style.width = width;
    skeletons.append(bar);
  }
  list.replaceChildren(skeletons);
}

/** Quantas apólices estão em tela, e sob qual corte de renovação. */
function renderSummary(policies, until) {
  const chips = [element('span', 'chip', `${policies.length} apólices`)];

  if (until !== undefined) {
    chips.push(element('span', 'chip chip--warning', `Renovam até ${formatDate(until)}`));
  }

  summary.replaceChildren(...chips);
}

async function load() {
  const until = renewalUntil.value === '' ? undefined : renewalUntil.value;
  clear.hidden = until === undefined;
  loading();

  let policies;
  try {
    policies = await api.listPolicies(until);
  } catch (error) {
    if (error instanceof ApiError) {
      reportError(error);
    }
    summary.replaceChildren();
    list.replaceChildren(
      emptyState(
        'cloud_off',
        'Não foi possível carregar as apólices',
        error instanceof ApiError ? error.message : 'Falha de comunicação com o servidor.',
      ),
    );
    return;
  }

  renderSummary(policies, until);

  if (policies.length === 0) {
    list.replaceChildren(
      until === undefined
        ? emptyState(
            'shield',
            'Nenhuma apólice registrada',
            'A apólice nasce do aceite da seguradora, registrado na proposta transmitida.',
          )
        : emptyState(
            'event_available',
            'Nenhuma apólice renova até essa data',
            'Escolha uma data mais distante ou volte à lista completa.',
          ),
    );
    return;
  }

  list.replaceChildren(table(policies));
}

renewalUntil.addEventListener('change', load);
clear.addEventListener('click', () => {
  renewalUntil.value = '';
  load();
});

load();
