/**
 * Turns a password into what is stored, and checks a password against it
 * (REQ-416).
 *
 * A port because the core imports no `node:` builtin: the adapter lives in
 * `infrastructure/security/`. `verify` answers `false`, never throws, for a
 * stored value it cannot read.
 */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}
