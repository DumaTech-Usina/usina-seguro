import { describe, expect, it } from 'vitest';
import { RandomSecretGenerator } from './random-secret-generator.ts';

const secrets = new RandomSecretGenerator();

describe('RandomSecretGenerator (REQ-416)', () => {
  it('generates 256 random bits, safe to travel in a URL or a cookie', () => {
    const token = secrets.generate();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secrets.generate()).not.toBe(token);
  });

  it('digests a token deterministically, and the digest is not the token', () => {
    const token = secrets.generate();

    expect(secrets.digest(token)).toBe(secrets.digest(token));
    expect(secrets.digest(token)).not.toBe(token);
    expect(secrets.digest(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});
