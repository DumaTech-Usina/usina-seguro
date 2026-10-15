/**
 * The brokers (V2 section 9D): register, search, change, and the history.
 *
 * Every rule — a name and a valid CPF (REQ-300, REQ-301), one broker per CPF
 * (REQ-302) — is the server's; this page learns it by being refused and shows
 * the server's sentence. Who signs is the session (REQ-304): nothing here asks
 * for it. There is no removal (REQ-305), so there is no button for it.
 */

import { ApiError, api } from '/app/shared/api.js';
import { authorName, loadAuthors } from '/app/shared/authors.js';
import { formatCpf } from '/app/shared/brokers.js';
import { formatInstant } from '/app/shared/money.js';
import { reportError, showSnackbar } from '/app/shared/shell.js';

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

function emptyState(iconName, title, description) {
  const empty = element('div', 'empty');
  empty.append(
    element('span', 'material-symbols-outlined', iconName),
    element('h3', 'text-subtitle', title),
    element('p', undefined, description),
  );
  return empty;
}

function table(headers, rows) {
  const node = element('table', 'table');
  const head = element('thead');
  const headRow = element('tr');
  for (const label of headers) {
    headRow.append(element('th', undefined, label));
  }
  head.append(headRow);
  const body = element('tbody');
  body.append(...rows);
  node.append(head, body);
  return node;
}

function heading(title, count) {
  const head = element('div', 'registry__head');
  head.append(element('h3', 'text-label', title));
  if (count !== undefined) {
    head.append(element('span', 'chip', count === 1 ? '1 registro' : `${count} registros`));
  }
  return head;
}

function values(form) {
  return Object.fromEntries(new FormData(form).entries());
}

/** Submits, shows the server's refusal as it is, and keeps what was typed. */
async function submitting(form, send) {
  const button = form.querySelector('button[type="submit"]');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Enviando…';

  try {
    return await send();
  } catch (error) {
    if (error instanceof ApiError) {
      reportError(error);
    } else {
      showSnackbar('Falha de comunicação com o servidor.', { tone: 'danger' });
    }
    return null;
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

/* --------------------------------------------------------------- list -- */

const listHost = document.querySelector('#list-brokers');
const searchForm = document.querySelector('#form-broker-search');
const search = searchForm.querySelector('[name="q"]');
let listRequest = 0;

/** REQ-306: by name or CPF, as the server matches it. Only the latest answer is shown. */
async function loadList() {
  const request = ++listRequest;
  let brokers;
  try {
    brokers = await api.listBrokers(search.value);
  } catch (error) {
    if (request !== listRequest) {
      return;
    }
    listHost.replaceChildren(
      heading('Corretores'),
      emptyState(
        'cloud_off',
        'Não foi possível carregar os corretores',
        error instanceof ApiError ? error.message : 'Falha de comunicação com o servidor.',
      ),
    );
    return;
  }

  if (request !== listRequest) {
    return;
  }

  if (brokers.length === 0) {
    listHost.replaceChildren(
      heading('Corretores', 0),
      search.value.trim() === ''
        ? emptyState('badge', 'Nenhum corretor cadastrado', 'Cadastre o primeiro acima.')
        : emptyState('search_off', 'Nenhum corretor encontrado', 'Busque por outro nome ou CPF.'),
    );
    return;
  }

  listHost.replaceChildren(
    heading('Corretores', brokers.length),
    table(
      ['Nome', 'CPF', ''],
      brokers.map((broker) => {
        const row = element('tr');
        row.dataset.brokerId = broker.id;
        const open = element('button', 'btn btn--text', 'Alterar');
        open.type = 'button';
        open.addEventListener('click', () => select(broker.id));
        const actions = element('td');
        actions.append(open);
        row.append(
          element('td', undefined, broker.name),
          element('td', 'registry-key', formatCpf(broker.cpf)),
          actions,
        );
        return row;
      }),
    ),
  );
}

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  loadList();
});
search.addEventListener('input', () => loadList());

/* ------------------------------------------------------------- create -- */

const createForm = document.querySelector('#form-broker');

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const broker = await submitting(createForm, () => api.registerBroker(values(createForm)));
  if (broker === null) {
    return;
  }
  showSnackbar(`Corretor ${broker.name} cadastrado.`, { tone: 'success' });
  createForm.reset();
  await loadList();
});

/* ------------------------------------------------- change and history -- */

const detail = document.querySelector('#broker-detail');
const changeForm = document.querySelector('#form-broker-change');
const historyHost = document.querySelector('#broker-history');
let selected = null;

function showDetail(broker) {
  selected = broker.id;
  detail.classList.remove('hidden');
  changeForm.querySelector('[name="name"]').value = broker.name;
  changeForm.querySelector('[name="cpf"]').value = formatCpf(broker.cpf);

  // REQ-304: every record, newest first, with who signed it and when.
  historyHost.replaceChildren(
    heading('Histórico', broker.history.length),
    table(
      ['Nome', 'CPF', 'Por', 'Em'],
      [...broker.history].reverse().map((record) => {
        const row = element('tr');
        row.append(
          element('td', undefined, record.name),
          element('td', 'registry-key', formatCpf(record.cpf)),
          element('td', undefined, authorName(record.signedBy)),
          element('td', undefined, formatInstant(record.signedAt)),
        );
        return row;
      }),
    ),
  );
}

async function select(id) {
  try {
    showDetail(await api.getBroker(id));
  } catch (error) {
    reportError(error);
  }
}

changeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (selected === null) {
    return;
  }
  const id = selected;
  const broker = await submitting(changeForm, () => api.changeBroker(id, values(changeForm)));
  if (broker === null) {
    return;
  }
  showSnackbar(`Corretor ${broker.name} alterado.`, { tone: 'success' });
  showDetail(broker);
  await loadList();
});

/* ---------------------------------------------------------------- go -- */

loadAuthors()
  .catch(() => {})
  .finally(() => loadList());
