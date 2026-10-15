/**
 * The secrets behind a session and the links of an invitation (REQ-416).
 *
 * `generate` answers the token handed to the person — in the cookie or in the
 * link — and `digest` answers what is stored in its place. The token itself is
 * never kept: a stored digest cannot be turned back into a token that works.
 */
export interface SecretGenerator {
  generate(): string;
  digest(token: string): string;
}
