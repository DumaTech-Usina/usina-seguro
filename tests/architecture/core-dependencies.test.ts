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

    // There is a single module today. This test documents the boundary: when a
    // real crossing appears it must be added here explicitly, together with the
    // requirement that justifies it.
    expect(crossings).toEqual([]);
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
        if (!argument.startsWith('PROPOSAL_MESSAGES.')) {
          literals.push(`${path.relative(ROOT, file)}: ${argument}`);
        }
      }
    }

    // The type system already forbids an arbitrary string here. This test keeps
    // the guarantee if the constructor signature is ever widened.
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
