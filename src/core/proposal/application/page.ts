/**
 * REQ-330 to REQ-333: a listing answers one page of its result at a time.
 *
 * Shared vocabulary, like `Money`: every module that lists something pages it
 * the same way, and the proposal module is the one everything depends on.
 */

/** REQ-332: what the user may choose; 50 when nothing is chosen. */
export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 50;

/** Which page, counted from 1, and how many lines it holds. */
export interface PageRequest {
  readonly number: number;
  readonly size: PageSize;
}

/**
 * REQ-331, REQ-333: the lines of one page and the total of the whole filtered
 * result. A page past the last one is empty, with the total still told.
 */
export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly number: number;
  readonly size: PageSize;
}

export const FIRST_PAGE: PageRequest = { number: 1, size: DEFAULT_PAGE_SIZE };

/** The page asked for, or the first one of 50 for what is not said. */
export function pageRequestOf(input: {
  readonly page?: number;
  readonly size?: PageSize;
}): PageRequest {
  return { number: input.page ?? 1, size: input.size ?? DEFAULT_PAGE_SIZE };
}

/** How many lines of the result come before the page. */
export function offsetOf(request: PageRequest): number {
  return (request.number - 1) * request.size;
}

/** The same page with other lines: what a listing does after reading the keys. */
export function mapPage<T, U>(page: Page<T>, items: readonly U[]): Page<U> {
  return { items, total: page.total, number: page.number, size: page.size };
}

/** One page cut from a result already in order: what the in-memory drivers answer. */
export function pageOf<T>(all: readonly T[], request: PageRequest): Page<T> {
  const start = offsetOf(request);
  return {
    items: all.slice(start, start + request.size),
    total: all.length,
    number: request.number,
    size: request.size,
  };
}
