import { describe, expect, it } from 'vitest';
import { InMemoryBrokerCommissionRateRepository } from '../../../infrastructure/persistence/in-memory/in-memory-broker-commission-rate-repository.ts';
import { Percentage } from '../../proposal/domain/percentage.ts';
import { BrokerCommissionRate } from '../domain/broker-commission-rate.ts';
import { ListBrokerCommissionRates } from './list-broker-commission-rates.ts';

function rate(brokerId: string, percentage: string, registeredAt = '2026-09-18T12:00:00.000Z') {
  return BrokerCommissionRate.register({
    brokerId,
    rate: Percentage.fromString(percentage),
    registeredAt: new Date(registeredAt),
  });
}

describe('ListBrokerCommissionRates', () => {
  it('answers the table as it stands, by broker (IN-05, REQ-093)', async () => {
    const brokerRates = new InMemoryBrokerCommissionRateRepository();
    await brokerRates.save(rate('broker-2', '45'));
    await brokerRates.save(rate('broker-1', '50'));

    const listed = await new ListBrokerCommissionRates({ brokerRates }).execute();

    expect(listed.map((line) => line.brokerId)).toEqual(['broker-1', 'broker-2']);
    expect(listed.map((line) => line.rate)).toEqual(['50', '45']);
  });

  it('preserves the scale the rate was informed with (REQ-121)', async () => {
    const brokerRates = new InMemoryBrokerCommissionRateRepository();
    await brokerRates.save(rate('broker-1', '12.50'));

    const [listed] = await new ListBrokerCommissionRates({ brokerRates }).execute();

    expect(listed?.rate).toBe('12.50');
  });

  it('shows the current rate of a broker registered twice, only once', async () => {
    const brokerRates = new InMemoryBrokerCommissionRateRepository();
    await brokerRates.save(rate('broker-1', '50', '2026-09-18T12:00:00.000Z'));
    await brokerRates.save(rate('broker-1', '55', '2026-09-19T12:00:00.000Z'));

    const listed = await new ListBrokerCommissionRates({ brokerRates }).execute();

    // One rate per broker: no requirement makes the table vary by period, so
    // re-registering is a correction, not a second line (REQ-093).
    expect(listed).toHaveLength(1);
    expect(listed[0]?.rate).toBe('55');
    expect(listed[0]?.registeredAt).toBe('2026-09-19T12:00:00.000Z');
  });

  it('answers an empty table rather than failing', async () => {
    const useCase = new ListBrokerCommissionRates({
      brokerRates: new InMemoryBrokerCommissionRateRepository(),
    });

    await expect(useCase.execute()).resolves.toEqual([]);
  });
});
