/**
 * REQ-330 to REQ-332: the navigation of a listing in pages — the total of
 * records, the page numbers with "anterior" and "próxima", and the choice of
 * 25, 50 or 100 per page.
 *
 * The page and the size live in the address (`?page=2&size=25`), with the
 * filters of the listing (`shared/address.js`), so going back from a detail,
 * or reloading, lands on the same page.
 *
 * Presentation only: the page cuts nothing. The listing asks the server for
 * `{ page, size }` and hands the answer `{ total, page, size }` here; a click
 * calls back with the page or the size wanted, and the listing reads again.
 */

import { rememberInAddress } from '/app/shared/address.js';

export const PAGE_SIZES = [25, 50, 100];
export const DEFAULT_PAGE_SIZE = 50;

/** The first page of the default size: where a listing starts, and goes back to on a new filter. */
export function firstPage(size = DEFAULT_PAGE_SIZE) {
  return { page: 1, size };
}

/** How many pages `total` records fill; at least one, so an empty listing is "1 de 1". */
export function pageCount(total, size) {
  return Math.max(1, Math.ceil(total / size));
}

/**
 * The page numbers to show around `current`: always the first and the last,
 * the two on each side of the current one, and `null` where a run is left out.
 */
export function pageNumbers(current, last) {
  const shown = new Set([1, last]);
  for (let page = current - 2; page <= current + 2; page++) {
    if (page >= 1 && page <= last) {
      shown.add(page);
    }
  }
  const sorted = [...shown].sort((a, b) => a - b);
  const numbers = [];
  for (const [index, page] of sorted.entries()) {
    if (index > 0 && page - sorted[index - 1] > 1) {
      numbers.push(null);
    }
    numbers.push(page);
  }
  return numbers;
}

const COUNT = new Intl.NumberFormat('pt-BR');

/** `1 registro`, `1.987 registros`. */
export function recordCount(total) {
  return `${COUNT.format(total)} ${total === 1 ? 'registro' : 'registros'}`;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function button(className, text, label, onClick, disabled = false) {
  const node = element('button', `btn btn--sm ${className}`, text);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.disabled = disabled;
  node.addEventListener('click', onClick);
  return node;
}

/**
 * The navigation for one answer of a listing. `onPage(n)` and `onSize(s)`
 * are called with what the user chose.
 */
export function pager({ total, page, size }, { onPage, onSize }) {
  const last = pageCount(total, size);
  const nav = element('nav', 'pager');
  nav.setAttribute('aria-label', 'Paginação');

  nav.append(element('span', 'pager__total', recordCount(total)));

  const pages = element('div', 'pager__pages');
  pages.append(button('pager__step', '‹', 'Página anterior', () => onPage(page - 1), page <= 1));
  for (const number of pageNumbers(page, last)) {
    if (number === null) {
      pages.append(element('span', 'pager__gap', '…'));
      continue;
    }
    const current = number === page;
    const link = button(
      `pager__page${current ? ' pager__page--current' : ''}`,
      String(number),
      `Página ${number}`,
      () => onPage(number),
    );
    if (current) {
      link.setAttribute('aria-current', 'page');
    }
    pages.append(link);
  }
  pages.append(button('pager__step', '›', 'Próxima página', () => onPage(page + 1), page >= last));
  nav.append(pages);

  const sizeLabel = element('label', 'pager__size', 'Por página');
  const select = element('select', 'pager__select');
  select.name = 'pageSize';
  for (const option of PAGE_SIZES) {
    const node = element('option', '', String(option));
    node.value = String(option);
    node.selected = option === size;
    select.append(node);
  }
  select.addEventListener('change', () => onSize(Number(select.value)));
  sizeLabel.append(select);
  nav.append(sizeLabel);

  return nav;
}

/**
 * The page to read again when an answer came for a page past the last one —
 * records cannot disappear, but a listing narrowed meanwhile can shrink.
 * `null` when the answer is a page that exists.
 */
export function pageToRetry({ total, page, size }) {
  const last = pageCount(total, size);
  return page > last ? last : null;
}

/** The names in the address: `page`/`size`, or `<name>Page`/`<name>Size` where a screen has several listings. */
function keysOf(name) {
  return name === '' ? ['page', 'size'] : [`${name}Page`, `${name}Size`];
}

/**
 * The page the address asks for, or the first of 50 for what it does not say
 * or says wrong: the address is typed by people too.
 */
export function pagingFromAddress(name = '') {
  const [pageKey, sizeKey] = keysOf(name);
  const params = new URLSearchParams(window.location.search);
  const page = Number(params.get(pageKey));
  const size = Number(params.get(sizeKey));
  return {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    size: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
}

/**
 * Writes the page into the address without a new history entry: the back
 * button still leaves the listing, and comes back to this page. The first
 * page of 50 goes unsaid.
 */
export function rememberPaging({ page, size }, name = '') {
  const [pageKey, sizeKey] = keysOf(name);
  rememberInAddress({
    [pageKey]: page === 1 ? undefined : page,
    [sizeKey]: size === DEFAULT_PAGE_SIZE ? undefined : size,
  });
}
