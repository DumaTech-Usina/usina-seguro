import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CORE = path.join(ROOT, 'src/core');

/**
 * The dependency rule is verified as a test, not written down as a convention.
 *
 * If anyone imports infrastructure inside `core/`, the suite breaks.
 */
async function coreFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return coreFiles(full);
      return entry.name.endsWith('.ts') ? [full] : [];
    }),
  );
  return files.flat();
}

function importsOf(file: string): string[] {
  const content = readFileSync(file, 'utf8');
  return [...content.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1] as string);
}

describe('core dependency rule', () => {
  it('no core file imports infrastructure, interfaces, config, i18n or Node builtins', async () => {
    const forbidden: string[] = [];

    for (const file of await coreFiles(CORE)) {
      if (file.endsWith('.test.ts')) continue;

      for (const specifier of importsOf(file)) {
        const relative = path.relative(ROOT, file);

        if (specifier.startsWith('node:')) {
          forbidden.push(`${relative} -> ${specifier} (Node builtin)`);
          continue;
        }

        if (!specifier.startsWith('.')) {
          forbidden.push(`${relative} -> ${specifier} (external dependency)`);
          continue;
        }

        const target = path.resolve(path.dirname(file), specifier);
        if (!target.startsWith(CORE)) {
          forbidden.push(`${relative} -> ${specifier} (outside the core)`);
        }
      }
    }

    expect(forbidden).toEqual([]);
  });

  it('no business module imports another business module without a declared need', async () => {
    const crossings: string[] = [];

    for (const file of await coreFiles(CORE)) {
      const module = path.relative(CORE, file).split(path.sep)[0];

      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith('.')) continue;

        const target = path.resolve(path.dirname(file), specifier);
        if (!target.startsWith(CORE)) continue;

        const targetModule = path.relative(CORE, target).split(path.sep)[0];
        if (targetModule !== module) {
          crossings.push(`${module} -> ${targetModule}`);
        }
      }
    }

    // Crossings are allowed only when a requirement forces them, and each one
    // is listed here with its justification.
    //
    // `policy -> proposal`: a policy only exists as the outcome of a proposal
    // (REQ-048), so the policy module loads the proposal, drives its transition
    // to ACCEPTED (REQ-111) and reuses the vocabulary the proposal module
    // already declares (`Money`, `BusinessRuleViolation`, `RecordNotFound`).
    // The reverse direction does not exist, so there is no cycle.
    expect([...new Set(crossings)].sort()).toEqual(['policy -> proposal']);
  });

  it('the domain builds every violation from the message-key constant, never a literal', async () => {
    const literals: string[] = [];

    for (const file of await coreFiles(CORE)) {
      if (file.endsWith('.test.ts')) continue;

      // Second argument of `new BusinessRuleViolation(rule, <here>, ...)`.
      for (const call of readFileSync(file, 'utf8').matchAll(
        /new BusinessRuleViolation\(\s*[^,]+,\s*([^,)]+)/g,
      )) {
        const argument = (call[1] as string).trim();
        if (!/^[A-Z][A-Z_]*_MESSAGES\./.test(argument)) {
          literals.push(`${path.relative(ROOT, file)}: ${argument}`);
        }
      }
    }

    // `BusinessRuleViolation.messageKey` is typed as `string`, because a union
    // over every module's keys would make the modules import each other in a
    // circle. This test is what replaces the narrow type inside the core; the
    // i18n dictionary is what guarantees the key is translated.
    expect(literals).toEqual([]);
  });

  it('no accented Portuguese text sits inside the core', async () => {
    // Heuristic, not a language detector: it catches the common case of a
    // user-facing sentence written as a comment or string in the domain. The
    // real guarantee that messages leave as keys is the type of
    // `BusinessRuleViolation.messageKey`, covered by the test above.
    const accented = (await coreFiles(CORE)).filter((file) =>
      /[\u00C0-\u00FF]/.test(readFileSync(file, 'utf8')),
    );

    expect(accented.map((file) => path.relative(ROOT, file))).toEqual([]);
  });
});
