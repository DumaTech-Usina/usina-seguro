import type { Broker } from '../domain/broker.ts';

export interface BrokerRepository {
  /** Inserts the broker or appends its new records; a stored record is never rewritten (REQ-304). */
  save(broker: Broker): Promise<void>;
  findById(id: string): Promise<Broker | null>;
  /** The broker holding this CPF today, by its digits (REQ-302). */
  findByCpf(digits: string): Promise<Broker | null>;
  /** Every broker, by current name and then by id. */
  list(): Promise<readonly Broker[]>;
}
