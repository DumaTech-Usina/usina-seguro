import type { BrokerRepository } from './broker-repository.ts';

/**
 * The name to show or to copy for the broker a proposal identifies (REQ-308).
 *
 * The proposal holds the broker's id. A proposal registered before the broker
 * registry holds the text that was typed or read instead (REQ-309): no broker
 * has that id, and the text itself is the answer — kept as it is, never
 * matched to a broker.
 */
export async function brokerNameOf(brokers: BrokerRepository, brokerId: string): Promise<string> {
  return (await brokers.findById(brokerId))?.name ?? brokerId;
}
