import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { type Page, type PageRequest, offsetOf } from '../../../core/proposal/application/page.ts';

/**
 * REQ-330, REQ-333: one page of a query and the total of the whole result.
 *
 * `from` is everything after `FROM` up to the order — tables, joins and the
 * `WHERE` — so the count and the page read exactly the same rows. The order
 * must end on a unique key, or a row could appear on two pages.
 */
export function readPage<Row>(
  db: DatabaseSync,
  query: { readonly columns: string; readonly from: string; readonly orderBy: string },
  params: readonly SQLInputValue[],
  request: PageRequest,
): Page<Row> {
  const { n } = db.prepare(`SELECT count(*) AS n FROM ${query.from}`).get(...params) as {
    n: number;
  };
  const rows = db
    .prepare(
      `SELECT ${query.columns} FROM ${query.from} ORDER BY ${query.orderBy} LIMIT ? OFFSET ?`,
    )
    .all(...params, request.size, offsetOf(request)) as unknown as Row[];

  return { items: rows, total: n, number: request.number, size: request.size };
}
