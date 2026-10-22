/**
 * The clients (V2 section 9E): register, search, change, and the history.
 *
 * Every rule — a name and a valid CPF (REQ-311, REQ-312), one client per CPF
 * (REQ-312) — is the server's; this page learns it by being refused and shows
 * the server's sentence. Who signs is the session (REQ-314): nothing here asks
 * for it. There is no removal (REQ-315), so there is no button for it.
 */

import { fromAddress, rememberInAddress } from '/app/shared/address.js';
import { ApiError, api } from '/app/shared/api.js';
import { authorName, loadAuthors } from '/app/shared/authors.js';
import { formatCpf } from '/app/shared/brokers.js';
import { formatInstant } from '/app/shared/money.js';
import {
  firstPage,
  pageToRetry,
  pager,
  pagingFromAddress,
  rememberPaging,
} from '/app/shared/pager.js';
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

const listHost = document.querySelector('#list-clients');
const searchForm = document.querySelector('#form-client-search');
const search = searchForm.querySelector('[name="q"]');
// The search the address asks for.
search.value = fromAddress('q');
let listRequest = 0;
// REQ-330, REQ-332: the page on screen and how many lines it holds.
let paging = pagingFromAddress();

/** REQ-316: by name or CPF, as the server matches it. Only the latest answer is shown. */
async function loadList() {
  rememberPaging(paging);
  rememberInAddress({ q: search.value });
  const request = ++listRequest;
  let clients;
  try {
    clients = await api.listClients(search.value, paging);
  } catch (error) {
    if (request !== listRequest) {
      return;
    }
    listHost.replaceChildren(
      heading('Clientes'),
      emptyState(
        'cloud_off',
        'Não foi possível carregar os clientes',
        error instanceof ApiError ? error.message : 'Falha de comunicação com o servidor.',
      ),
    );
    return;
  }

  if (request !== listRequest) {
    return;
  }

  const retry = pageToRetry(clients);
  if (retry !== null && clients.total > 0) {
    paging = { ...paging, page: retry };
    loadList();
    return;
  }

  if (clients.total === 0) {
    listHost.replaceChildren(
      heading('Clientes', 0),
      search.value.trim() === ''
        ? emptyState('group', 'Nenhum cliente cadastrado', 'Cadastre o primeiro acima.')
        : emptyState('search_off', 'Nenhum cliente encontrado', 'Busque por outro nome ou CPF.'),
    );
    return;
  }

  listHost.replaceChildren(
    heading('Clientes', clients.total),
    table(
      ['Nome', 'CPF', ''],
      clients.items.map((client) => {
        const row = element('tr');
        row.dataset.clientId = client.id;
        const open = element('button', 'btn btn--text', 'Alterar');
        open.type = 'button';
        open.addEventListener('click', () => select(client.id));
        const actions = element('td');
        actions.append(open);
        row.append(
          element('td', undefined, client.name),
          element('td', 'registry-key', formatCpf(client.cpf)),
          actions,
        );
        return row;
      }),
    ),
    pager(clients, {
      onPage: (page) => {
        paging = { ...paging, page };
        loadList();
      },
      onSize: (size) => {
        paging = firstPage(size);
        loadList();
      },
    }),
  );
}

/** A new search starts on the first page, with the same size (REQ-333). */
function searchAgain() {
  paging = firstPage(paging.size);
  loadList();
}

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  searchAgain();
});
search.addEventListener('input', () => searchAgain());

/* ------------------------------------------------------------- create -- */

const createForm = document.querySelector('#form-client');

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const client = await submitting(createForm, () => api.registerClient(values(createForm)));
  if (client === null) {
    return;
  }
  showSnackbar(`Cliente ${client.name} cadastrado.`, { tone: 'success' });
  createForm.reset();
  await loadList();
});

/* ------------------------------------------------- change and history -- */

const detail = document.querySelector('#client-detail');
const changeForm = document.querySelector('#form-client-change');
const historyHost = document.querySelector('#client-history');
let selected = null;

function showDetail(client) {
  selected = client.id;
  detail.classList.remove('hidden');
  changeForm.querySelector('[name="name"]').value = client.name;
  changeForm.querySelector('[name="cpf"]').value = formatCpf(client.cpf);

  // REQ-314: every record, newest first, with who signed it and when.
  historyHost.replaceChildren(
    heading('Histórico', client.history.length),
    table(
      ['Nome', 'CPF', 'Por', 'Em'],
      [...client.history].reverse().map((record) => {
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
    showDetail(await api.getClient(id));
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
  const client = await submitting(changeForm, () => api.changeClient(id, values(changeForm)));
  if (client === null) {
    return;
  }
  showSnackbar(`Cliente ${client.name} alterado.`, { tone: 'success' });
  showDetail(client);
  await loadList();
});

/* ---------------------------------------------------------------- go -- */

loadAuthors()
  .catch(() => {})
  .finally(() => loadList());
