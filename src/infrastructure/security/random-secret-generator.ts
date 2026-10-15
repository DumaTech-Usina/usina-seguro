import { createHash, randomBytes } from 'node:crypto';
import type { SecretGenerator } from '../../core/identity/application/secret-generator.ts';

/**
 * REQ-416: 256 random bits per session or link, kept only as their SHA-256.
 *
 * A plain digest and not a salted, slow one like the password's: the token is
 * random and long, so there is nothing for a dictionary to guess, and the
 * digest has to be deterministic for the stored row to be found by it.
 */
export class RandomSecretGenerator implements SecretGenerator {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
