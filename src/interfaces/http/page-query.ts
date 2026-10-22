import { PAGE_SIZES, type Page, type PageSize } from '../../core/proposal/application/page.ts';

/**
 * REQ-330 to REQ-332: the page of a listing in its query string —
 * `?page=2&size=100`. Both are text in a query string, and the server does
 * not coerce types: the schema checks their shape, `pageOf` turns them into
 * numbers. Absent, the first page of 50.
 */
export const PAGE_QUERY = {
  page: { type: 'string', pattern: '^[1-9][0-9]{0,8}$' },
  size: { type: 'string', enum: PAGE_SIZES.map(String) },
} as const;

export function pageOf(query: { page?: string; size?: string }): {
  page?: number;
  size?: PageSize;
} {
  return {
    ...(query.page === undefined ? {} : { page: Number(query.page) }),
    ...(query.size === undefined ? {} : { size: Number(query.size) as PageSize }),
  };
}

/** The filters of a listing's query string, without the page. */
export function filtersOf<T extends { page?: string; size?: string }>(
  query: T,
): Omit<T, 'page' | 'size'> {
  const { page: _page, size: _size, ...filters } = query;
  return filters;
}

/** What a listing answers: the lines of the page, the total, which page and of what size. */
export function paged<T>(page: Page<T>): {
  items: readonly T[];
  total: number;
  page: number;
  size: number;
} {
  return { items: page.items, total: page.total, page: page.number, size: page.size };
}
