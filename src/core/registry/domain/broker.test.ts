import { describe, expect, it } from 'vitest';
import { Authorship } from '../../proposal/domain/authorship.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Broker } from './broker.ts';
import { Cpf } from './cpf.ts';
import { REGISTRY_MESSAGES } from './errors.ts';

const SIGNED = Authorship.of('user-1', new Date('2026-10-15T12:00:00.000Z'));
const LATER = Authorship.of('user-2', new Date('2026-10-16T09:00:00.000Z'));

function violationOf(action: () => unknown): BusinessRuleViolation {
  try {
    action();
  } catch (error) {
    if (error instanceof BusinessRuleViolation) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a BusinessRuleViolation');
}

describe('Cpf (REQ-301)', () => {
  it('accepts a CPF with or without punctuation and keeps only the digits (CA-300)', () => {
    expect(Cpf.parse('529.982.247-25', 'BROKER').digits).toBe('52998224725');
    expect(Cpf.parse('52998224725', 'BROKER').digits).toBe('52998224725');
    expect(Cpf.parse(' 529.982.247-25 ', 'BROKER').digits).toBe('52998224725');
  });

  it('refuses invalid check digits (REJ-301)', () => {
    const violation = violationOf(() => Cpf.parse('529.982.247-24', 'BROKER'));

    expect(violation.rule).toBe('REQ-301');
    expect(violation.messageKey).toBe(REGISTRY_MESSAGES.BROKER_CPF_INVALID);
  });

  it('refuses anything but 11 digits (REJ-301)', () => {
    for (const text of ['5299822472', '529982247250', '529.982.247-2A', '529 982 247 25']) {
      expect(violationOf(() => Cpf.parse(text, 'BROKER')).messageKey).toBe(
        REGISTRY_MESSAGES.BROKER_CPF_INVALID,
      );
    }
  });

  it('refuses an empty CPF as missing (REJ-300)', () => {
    const violation = violationOf(() => Cpf.parse('   ', 'BROKER'));

    expect(violation.rule).toBe('REQ-300');
    expect(violation.messageKey).toBe(REGISTRY_MESSAGES.BROKER_CPF_REQUIRED);
  });
});

describe('Broker (REQ-300, REQ-303, REQ-304)', () => {
  it('registers a broker with name and CPF, signed (CA-300)', () => {
    const broker = Broker.register({
      id: 'broker-1',
      name: '  Ana Silva ',
      cpf: '529.982.247-25',
      signed: SIGNED,
    });

    expect(broker.id).toBe('broker-1');
    expect(broker.name).toBe('Ana Silva');
    expect(broker.cpf.digits).toBe('52998224725');
    expect(broker.records).toHaveLength(1);
    expect(broker.records[0]?.signed).toBe(SIGNED);
  });

  it('refuses a broker without name (REJ-300)', () => {
    const violation = violationOf(() =>
      Broker.register({ id: 'broker-1', name: '  ', cpf: '52998224725', signed: SIGNED }),
    );

    expect(violation.rule).toBe('REQ-300');
    expect(violation.messageKey).toBe(REGISTRY_MESSAGES.BROKER_NAME_REQUIRED);
  });

  it('refuses a broker without CPF (REJ-300)', () => {
    expect(
      violationOf(() => Broker.register({ id: 'broker-1', name: 'Ana', cpf: '', signed: SIGNED }))
        .messageKey,
    ).toBe(REGISTRY_MESSAGES.BROKER_CPF_REQUIRED);
  });

  it('changes name and CPF as a new signed record, keeping the earlier one (CA-302)', () => {
    const registered = Broker.register({
      id: 'broker-1',
      name: 'Ana Silva',
      cpf: '52998224725',
      signed: SIGNED,
    });

    const changed = registered.change({
      name: 'Ana Silva Souza',
      cpf: '111.444.777-35',
      signed: LATER,
    });

    expect(changed.name).toBe('Ana Silva Souza');
    expect(changed.cpf.digits).toBe('11144477735');
    expect(
      changed.records.map((record) => [record.name, record.cpf.digits, record.signed]),
    ).toEqual([
      ['Ana Silva', '52998224725', SIGNED],
      ['Ana Silva Souza', '11144477735', LATER],
    ]);
    // Immutable: the registered instance is untouched.
    expect(registered.records).toHaveLength(1);
  });

  it('applies the registration rules to a change (REQ-303)', () => {
    const broker = Broker.register({
      id: 'broker-1',
      name: 'Ana Silva',
      cpf: '52998224725',
      signed: SIGNED,
    });

    expect(
      violationOf(() => broker.change({ name: '', cpf: '52998224725', signed: LATER })).messageKey,
    ).toBe(REGISTRY_MESSAGES.BROKER_NAME_REQUIRED);
    expect(
      violationOf(() => broker.change({ name: 'Ana', cpf: '52998224724', signed: LATER }))
        .messageKey,
    ).toBe(REGISTRY_MESSAGES.BROKER_CPF_INVALID);
  });
});
