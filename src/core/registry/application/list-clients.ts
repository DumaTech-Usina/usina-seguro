import type { Client } from '../domain/client.ts';
import type { ClientRepository } from './client-repository.ts';
import { type ClientView, toClientView } from './client-view.ts';

export interface ListClientsInput {
  /** REQ-316: part of the name, or digits of the CPF; absent or blank lists every client. */
  readonly query?: string | undefined;
}

export interface ListClientsDependencies {
  readonly clients: ClientRepository;
}

/** REQ-316: the clients, searched by name or CPF. */
export class ListClients {
  private readonly deps: ListClientsDependencies;

  constructor(deps: ListClientsDependencies) {
    this.deps = deps;
  }

  async execute(input: ListClientsInput = {}): Promise<readonly ClientView[]> {
    return (await searchClients(this.deps.clients, input.query)).map(toClientView);
  }
}

/**
 * REQ-316, and the search of proposals and policies by client (REQ-319): the
 * name matches by part, ignoring case; the CPF matches by its digits, by part,
 * with or without punctuation. The matching is done here and not in the driver
 * so both drivers answer the same thing.
 */
export async function searchClients(
  clients: ClientRepository,
  query: string | undefined,
): Promise<readonly Client[]> {
  return (await clients.list()).filter((client) => matches(client, query));
}

function matches(client: Client, query: string | undefined): boolean {
  const wanted = query?.trim() ?? '';

  if (wanted === '') {
    return true;
  }

  const digits = wanted.replace(/[.-]/g, '');

  return (
    client.name.toLowerCase().includes(wanted.toLowerCase()) ||
    (/^\d+$/.test(digits) && client.cpf.digits.includes(digits))
  );
}
