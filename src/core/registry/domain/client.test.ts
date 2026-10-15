import { describe, expect, it } from 'vitest';
import { Authorship } from '../../proposal/domain/authorship.ts';
import { BusinessRuleViolation } from '../../proposal/domain/errors.ts';
import { Client } from './client.ts';
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

describe('Cpf of a client (REQ-312)', () => {
  it('follows the broker rule and keeps only the digits (CA-310)', () => {
    expect(Cpf.parse('529.982.247-25', 'CLIENT').digits).toBe('52998224725');
  });

  it('refuses invalid check digits or anything but 11 digits, naming the client (REJ-311)', () => {
    for (const text of ['529.982.247-24', '5299822472', '529 982 247 25']) {
      const violation = violationOf(() => Cpf.parse(text, 'CLIENT'));

      expect(violation.rule).toBe('REQ-312');
      expect(violation.messageKey).toBe(REGISTRY_MESSAGES.CLIENT_CPF_INVALID);
    }
  });

  it('refuses an empty CPF as missing (REJ-310)', () => {
    const violation = violationOf(() => Cpf.parse('  ', 'CLIENT'));

    expect(violation.rule).toBe('REQ-311');
    expect(violation.messageKey).toBe(REGISTRY_MESSAGES.CLIENT_CPF_REQUIRED);
  });
});

describe('Client (REQ-311, REQ-313, REQ-314)', () => {
  it('registers a client with name and CPF, signed (CA-310)', () => {
    const client = Client.register({
      id: 'client-1',
      name: '  Maria Souza ',
      cpf: '529.982.247-25',
      signed: SIGNED,
    });

    expect(client.id).toBe('client-1');
    expect(client.name).toBe('Maria Souza');
    expect(client.cpf.digits).toBe('52998224725');
    expect(client.records).toHaveLength(1);
    expect(client.records[0]?.signed).toBe(SIGNED);
  });

  it('refuses a client without name (REJ-310)', () => {
    const violation = violationOf(() =>
      Client.register({ id: 'client-1', name: ' ', cpf: '52998224725', signed: SIGNED }),
    );

    expect(violation.rule).toBe('REQ-311');
    expect(violation.messageKey).toBe(REGISTRY_MESSAGES.CLIENT_NAME_REQUIRED);
  });

  it('refuses a client without CPF (REJ-310)', () => {
    expect(
      violationOf(() => Client.register({ id: 'client-1', name: 'Maria', cpf: '', signed: SIGNED }))
        .messageKey,
    ).toBe(REGISTRY_MESSAGES.CLIENT_CPF_REQUIRED);
  });

  it('changes name and CPF as a new signed record, keeping the earlier one (CA-312)', () => {
    const registered = Client.register({
      id: 'client-1',
      name: 'Maria Souza',
      cpf: '52998224725',
      signed: SIGNED,
    });

    const changed = registered.change({
      name: 'Maria Souza Lima',
      cpf: '111.444.777-35',
      signed: LATER,
    });

    expect(changed.name).toBe('Maria Souza Lima');
    expect(changed.cpf.digits).toBe('11144477735');
    expect(
      changed.records.map((record) => [record.name, record.cpf.digits, record.signed]),
    ).toEqual([
      ['Maria Souza', '52998224725', SIGNED],
      ['Maria Souza Lima', '11144477735', LATER],
    ]);
    expect(registered.records).toHaveLength(1);
  });

  it('applies the registration rules to a change (REQ-313)', () => {
    const client = Client.register({
      id: 'client-1',
      name: 'Maria',
      cpf: '52998224725',
      signed: SIGNED,
    });

    expect(
      violationOf(() => client.change({ name: '', cpf: '52998224725', signed: LATER })).messageKey,
    ).toBe(REGISTRY_MESSAGES.CLIENT_NAME_REQUIRED);
    expect(
      violationOf(() => client.change({ name: 'Maria', cpf: '52998224724', signed: LATER }))
        .messageKey,
    ).toBe(REGISTRY_MESSAGES.CLIENT_CPF_INVALID);
  });
});
