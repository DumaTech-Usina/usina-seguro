/**
 * The registry the Administrator maintains: references (IN-01).
 *
 * No rate is registered here: the Usina side of a commission comes from the
 * CT (and CTU) informed on each proposal (REQ-236), and the broker's part is
 * the CR informed on each policy (REQ-270).
 *
 * The card writes and reads back the same registry, so what was registered is
 * visible right below the form.
 */

import { ApiError, api } from '/app/shared/api.js';
import { formatInstant, formatPercentage } from '/app/shared/money.js';
import { reportError, showSnackbar } from '/app/shared/shell.js';
import { statusChip } from '/app/shared/status.js';

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

function table(headers, rows) {
  const node = element('table', 'table');
  const head = element('thead');
  const headRow = element('tr');

  for (const [label, className] of headers) {
    headRow.append(element('th', className, label));
  }
  head.append(headRow);

  const body = element('tbody');
  for (const row of rows) {
    body.append(row);
  }

  node.append(head, body);
  return node;
}

function values(form) {
  return Object.fromEntries(new FormData(form).entries());
}

/* ------------------------------------------------------------ registry -- */

/**
 * One registry region: a heading with how many records there are, and the
 * records themselves.
 *
 * The three regions behave the same way — skeleton, then the table, the empty
 * state or the refusal the server gave — so the shape lives here once and each
 * registry only says what a line of it looks like.
 */
function registry({ region, title, read, headers, row, empty }) {
  const host = document.querySelector(region);

  function heading(count) {
    const head = element('div', 'registry__head');
    head.append(element('h3', 'text-label', title));
    if (count !== undefined) {
      head.append(element('span', 'chip', count === 1 ? '1 registro' : `${count} registros`));
    }
    return head;
  }

  function loading() {
    const skeletons = element('div', 'stack');
    for (const width of ['60%', '45%']) {
      const bar = element('div', 'skeleton');
      bar.style.width = width;
      skeletons.append(bar);
    }
    host.replaceChildren(heading(), skeletons);
  }

  async function load() {
    loading();

    let records;
    try {
      records = await read();
    } catch (error) {
      host.replaceChildren(
        heading(),
        emptyState(
          'cloud_off',
          'Não foi possível carregar o cadastro',
          error instanceof ApiError ? error.message : 'Falha de comunicação com o servidor.',
        ),
      );
      return;
    }

    if (records.length === 0) {
      host.replaceChildren(heading(0), emptyState(empty.icon, empty.title, empty.description));
      return;
    }

    host.replaceChildren(heading(records.length), table(headers, records.map(row)));
  }

  return { load };
}

/**
 * Submits, reports a refusal with the server's own sentence, keeps the form,
 * and re-reads the registry so what was just written is on screen.
 */
function wire(selector, send, success, reload) {
  const form = document.querySelector(selector);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Enviando…';

    try {
      const result = await send(values(form));
      showSnackbar(success(result), { tone: 'success' });
      await reload();
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
  });
}

/* ---------------------------------------------------------- reference -- */

/**
 * The kinds of IN-01, in Portuguese (the broker has its own page).
 *
 * Presentation only, like `shared/status.js`: the set is the requirement's and
 * the server refuses anything outside it, so this map never decides anything.
 */
const REFERENCE_KINDS = {
  CLIENT: 'Cliente',
  INSURER: 'Seguradora',
  INTERMEDIARY: 'Intermediária',
  PRODUCT: 'Produto / ramo',
};

const references = registry({
  region: '#list-references',
  title: 'Cadastros registrados',
  read: () => api.listReferences(),
  headers: [
    ['Tipo', ''],
    ['Nome', ''],
    ['Identificador', ''],
    ['Registrado em', ''],
  ],
  row: (reference) => {
    const line = element('tr');
    const kind = element('td');
    kind.append(element('span', 'chip', REFERENCE_KINDS[reference.kind] ?? reference.kind));

    line.append(
      kind,
      element('td', undefined, reference.name),
      element('td', 'registry-key', reference.id),
      element('td', 'text-muted', formatInstant(reference.registeredAt)),
    );
    return line;
  },
  empty: {
    icon: 'groups',
    title: 'Nenhum cadastro registrado',
    description: 'Sem eles, a operação identifica cada negócio pelo código digitado na proposta.',
  },
});

wire(
  '#form-reference',
  (input) => api.registerReference({ kind: input.kind, id: input.id, name: input.name }),
  (reference) =>
    `${REFERENCE_KINDS[reference.kind] ?? reference.kind} ${reference.name} registrado.`,
  () => references.load(),
);

/* --------------------------------------------------------------- load -- */

references.load();
