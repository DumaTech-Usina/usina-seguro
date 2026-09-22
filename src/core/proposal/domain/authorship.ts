import { BusinessRuleViolation, PROPOSAL_MESSAGES } from './errors.ts';

/**
 * Who signed an audited act, and when (REQ-215, REQ-223).
 *
 * REQ-216 keeps the way of signing apart from the rules that demand a
 * signature. The domain only knows that an act carries an author identifier
 * and an instant; where the identifier comes from — typed by the user today, the
 * logged-in username tomorrow — is decided outside the core, so changing it
 * touches no rule of the proposal.
 */
export class Authorship {
  readonly author: string;
  readonly at: Date;

  private constructor(author: string, at: Date) {
    this.author = author;
    this.at = at;
  }

  /** REQ-216, REJ-206, REJ-213: an audited act nobody signed is refused. */
  static of(author: string, at: Date): Authorship {
    const identifier = author.trim();

    if (identifier === '') {
      throw new BusinessRuleViolation('REQ-216', PROPOSAL_MESSAGES.AUTHOR_REQUIRED);
    }

    return new Authorship(identifier, at);
  }

  /** Rebuilds a stored signature without re-applying the rule (REQ-124). */
  static restore(author: string, at: Date): Authorship {
    return new Authorship(author, at);
  }
}
