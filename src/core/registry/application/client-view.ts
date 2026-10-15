import type { Client } from '../domain/client.ts';

/** Representation of a client at the core boundary (V2 section 9E). */
export interface ClientView {
  readonly id: string;
  readonly name: string;
  /** The 11 digits (REQ-312); punctuation is presentation. */
  readonly cpf: string;
  /** REQ-314: every record, oldest first, with who signed it and when. */
  readonly history: readonly ClientRecordView[];
}

export interface ClientRecordView {
  readonly name: string;
  readonly cpf: string;
  readonly signedBy: string;
  readonly signedAt: string;
}

export function toClientView(client: Client): ClientView {
  return {
    id: client.id,
    name: client.name,
    cpf: client.cpf.digits,
    history: client.records.map((record) => ({
      name: record.name,
      cpf: record.cpf.digits,
      signedBy: record.signed.author,
      signedAt: record.signed.at.toISOString(),
    })),
  };
}
