import type { Client } from '../domain/client.ts';

export interface ClientRepository {
  /** Inserts the client or appends its new records; a stored record is never rewritten (REQ-314). */
  save(client: Client): Promise<void>;
  findById(id: string): Promise<Client | null>;
  /** The client holding this CPF today, by its digits (REQ-312). */
  findByCpf(digits: string): Promise<Client | null>;
  /** Every client, by current name and then by id. */
  list(): Promise<readonly Client[]>;
}
