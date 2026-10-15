import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { PasswordHasher } from '../../core/identity/application/password-hasher.ts';

/** Cost parameters of `scrypt` (Node's defaults, recorded in every hash). */
const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/**
 * REQ-416: the password is kept only as the result of an irreversible
 * function, with a salt of its own.
 *
 * `scrypt` ships with Node, so no dependency is added. The stored value
 * carries its parameters (`scrypt$N$r$p$salt$key`), so raising the cost later
 * does not invalidate the hashes already stored.
 */
export class ScryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(password, salt, N, R, P, KEY_LENGTH);

    return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
  }

  async verify(password: string, hash: string): Promise<boolean> {
    const [scheme, n, r, p, salt, key] = hash.split('$');
    if (scheme !== 'scrypt' || salt === undefined || key === undefined) {
      return false;
    }

    const expected = Buffer.from(key, 'base64');
    const actual = await derive(
      password,
      Buffer.from(salt, 'base64'),
      Number(n),
      Number(r),
      Number(p),
      expected.length,
    );

    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}

function derive(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
  length: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, length, { N: n, r, p }, (error, key) =>
      error === null ? resolve(key) : reject(error),
    );
  });
}
