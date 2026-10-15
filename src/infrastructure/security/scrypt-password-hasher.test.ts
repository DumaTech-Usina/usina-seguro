import { describe, expect, it } from 'vitest';
import { ScryptPasswordHasher } from './scrypt-password-hasher.ts';

const hasher = new ScryptPasswordHasher();

describe('ScryptPasswordHasher (REQ-416)', () => {
  it('verifies the password it hashed and refuses another one', async () => {
    const hash = await hasher.hash('correct horse battery');

    await expect(hasher.verify('correct horse battery', hash)).resolves.toBe(true);
    await expect(hasher.verify('correct horse batterz', hash)).resolves.toBe(false);
  });

  it('never keeps the password in the result', async () => {
    const hash = await hasher.hash('correct horse battery');

    expect(hash).not.toContain('correct horse battery');
  });

  it('salts each hash: the same password gives two different results', async () => {
    const first = await hasher.hash('correct horse battery');
    const second = await hasher.hash('correct horse battery');

    expect(first).not.toBe(second);
    await expect(hasher.verify('correct horse battery', second)).resolves.toBe(true);
  });

  it('answers false, without failing, to a stored value it cannot read', async () => {
    await expect(hasher.verify('correct horse battery', 'not-a-hash')).resolves.toBe(false);
  });
});
