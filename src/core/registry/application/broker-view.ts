import type { Broker } from '../domain/broker.ts';

/** Representation of a broker at the core boundary (V2 section 9D). */
export interface BrokerView {
  readonly id: string;
  readonly name: string;
  /** The 11 digits (REQ-301); punctuation is presentation. */
  readonly cpf: string;
  /** REQ-304: every record, oldest first, with who signed it and when. */
  readonly history: readonly BrokerRecordView[];
}

export interface BrokerRecordView {
  readonly name: string;
  readonly cpf: string;
  readonly signedBy: string;
  readonly signedAt: string;
}

export function toBrokerView(broker: Broker): BrokerView {
  return {
    id: broker.id,
    name: broker.name,
    cpf: broker.cpf.digits,
    history: broker.records.map((record) => ({
      name: record.name,
      cpf: record.cpf.digits,
      signedBy: record.signed.author,
      signedAt: record.signed.at.toISOString(),
    })),
  };
}
