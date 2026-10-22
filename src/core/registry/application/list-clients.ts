import {
  type Page,
  type PageSize,
  mapPage,
  pageRequestOf,
} from '../../proposal/application/page.ts';
import type { ClientRepository } from './client-repository.ts';
import { type ClientView, toClientView } from './client-view.ts';

export interface ListClientsInput {
  /** REQ-316: part of the name, or digits of the CPF; absent or blank lists every client. */
  readonly query?: string | undefined;
  /** REQ-330 to REQ-332: the page, from 1, and its size; the first of 50 when absent. */
  readonly page?: number;
  readonly size?: PageSize;
}

export interface ListClientsDependencies {
  readonly clients: ClientRepository;
}

/** REQ-316: the clients, searched by name or CPF, one page at a time (REQ-330). */
export class ListClients {
  private readonly deps: ListClientsDependencies;

  constructor(deps: ListClientsDependencies) {
    this.deps = deps;
  }

  async execute(input: ListClientsInput = {}): Promise<Page<ClientView>> {
    const query = input.query?.trim() ?? '';
    const clients = await this.deps.clients.page(
      query === '' ? {} : { query },
      pageRequestOf(input),
    );
    return mapPage(clients, clients.items.map(toClientView));
  }
}

/**
 * REQ-316, and the search of proposals and policies by client (REQ-319): the
 * name matches by part, ignoring case; the CPF matches by its digits, by part,
 * with or without punctuation. A blank term matches every client.
 *
 * The one statement of the rule: the in-memory drivers call it, and SQLite
 * runs it as a function of its own queries, so both drivers answer the same.
 */
export function matchesClientQuery(
  name: string,
  cpfDigits: string,
  query: string | undefined,
): boolean {
  const wanted = query?.trim() ?? '';

  if (wanted === '') {
    return true;
  }

  const digits = wanted.replace(/[.-]/g, '');

  return (
    name.toLowerCase().includes(wanted.toLowerCase()) ||
    (/^\d+$/.test(digits) && cpfDigits.includes(digits))
  );
}
