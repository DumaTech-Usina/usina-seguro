import { cpfOf } from '../../support/cpf.ts';

/**
 * The client of a proposal as the registration takes it (REQ-317): a name and
 * a CPF. The CPF is derived from the name, so the same name is always the same
 * client and two names are two clients (REQ-312) without a test keeping count.
 */
export function clientNamed(name: string): { name: string; cpf: string } {
  let seed = 0;
  for (const character of name) {
    seed = (seed * 31 + (character.codePointAt(0) ?? 0)) % 900_000;
  }
  // Away from the seeds the broker helpers use (cpfOf(1), cpfOf(2)...).
  return { name, cpf: cpfOf(100_000 + seed) };
}
