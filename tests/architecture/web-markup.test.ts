// @vitest-environment jsdom

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural rules of the operator's pages, verified instead of trusted.
 *
 * The web layer has no build step: what is served is what is on disk, and
 * nothing stands between a broken piece of markup and the browser. There is
 * also no visual test. So the contracts the stylesheet depends on are checked
 * here, the same way `core-dependencies.test.ts` checks the ones the core
 * depends on.
 */
const WEB_PUBLIC = path.resolve(import.meta.dirname, '../../src/interfaces/web/public');

/** See the note in `web-fp01-flow.test.ts`: the DOM is outside the type program. */
// biome-ignore lint/suspicious/noExplicitAny: see above.
type Untyped = any;

const { DOMParser } = globalThis as Untyped;

function pages(): string[] {
  return readdirSync(WEB_PUBLIC, { recursive: true, encoding: 'utf8' }).filter((entry) =>
    entry.endsWith('.html'),
  );
}

function documentOf(page: string): Untyped {
  return new DOMParser().parseFromString(
    readFileSync(path.join(WEB_PUBLIC, page), 'utf8'),
    'text/html',
  );
}

describe('the markup contracts of the operator pages', () => {
  it('lifts the label of every field, whatever sits between it and its control', () => {
    // The floating label is CSS alone, and it selects the label as a sibling
    // of the control. With the *adjacent* combinator it stopped matching the
    // moment a `<datalist>` was added between the two, and four fields of the
    // proposal form silently lost the lift: the label stayed put and the text
    // being typed landed on top of it.
    //
    // `base.css` selects with `~`, so what the markup has to guarantee is that
    // the label comes *after* its control inside `.field`. A label placed
    // before its control is a deliberate opt-out and says so with `--static`.
    const stuck: string[] = [];

    for (const page of pages()) {
      for (const label of documentOf(page).querySelectorAll('.field__label')) {
        if (label.classList.contains('field__label--static')) {
          continue;
        }

        if (!label.matches('.field__input ~ .field__label')) {
          const control = label.closest('.field')?.querySelector('.field__input');
          stuck.push(`${page}: ${control?.getAttribute('name') ?? label.textContent?.trim()}`);
        }
      }
    }

    expect(stuck).toEqual([]);
  });

  it('keeps the stylesheet on the combinator the markup was written for', () => {
    // The check above only means something while the rule is written with
    // `~`. Going back to `+` would pass it and break the pages again.
    const stylesheet = readFileSync(path.join(WEB_PUBLIC, 'shared/base.css'), 'utf8');

    expect(stylesheet).not.toMatch(/\.field__input[^,{]*\+\s*\.field__label/);
  });

  it('gives every floating label a control with a placeholder', () => {
    // `:not(:placeholder-shown)` is what means "the field has content". An
    // input with no `placeholder` attribute never matches `:placeholder-shown`,
    // so its label would be stuck in the lifted position over an empty field.
    // A `select` is exempt: it has no placeholder and its label is meant to
    // stay lifted, which is why `select.field__input` carries extra padding.
    const missing: string[] = [];

    for (const page of pages()) {
      for (const input of documentOf(page).querySelectorAll('input.field__input')) {
        const field = input.closest('.field');
        const label = field?.querySelector('.field__label:not(.field__label--static)');

        if (label === null || label === undefined || input.type === 'date') {
          continue;
        }

        if (!input.hasAttribute('placeholder')) {
          missing.push(`${page}: ${input.getAttribute('name') ?? '?'}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
