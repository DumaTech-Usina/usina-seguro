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
    // Crossings are allowed only when a requirement forces them, and each one
    // is listed here with its justification.
    //
    // Every module also reuses the vocabulary the proposal module declares
    // (`Money`, `Percentage`, `BusinessRuleViolation`, `RecordNotFound`),
    // which is where it lives because the proposal is the module everything
    // else already depends on. That is stated once here rather than repeated
    // in each entry.
    const declared = [
      // A policy only exists as the outcome of a proposal (REQ-048): the
      // policy module loads it and drives its transition to ACCEPTED (REQ-111).
      'policy -> proposal',
      // FP-01 step 7: the commission is calculated once the policy exists. The
      // commission module implements the port the policy module declares
      // (`AgreedCommissionCalculator`) and reads `CalendarDate`, so the arrow
      // points this way and the policy module never names a commission.
      'commission -> policy',
      // REQ-065 selects the agreement by insurer and product and IN-05 selects
      // the broker table by broker. All three live on the proposal (REQ-022),
      // not on the policy.
      'commission -> proposal',
      // FP-02 step 3: a matched line produces the real commission of REQ-075,
      // so the reconciliation drives the commission through its own states.
      'reconciliation -> commission',
      // REQ-082: the conciliation key is the policy number, and the unit of
      // work reuses the `Transaction` contract the policy module declares.
      'reconciliation -> policy',
      // REQ-082, CA-019: a line that brings only the proposal number reaches
      // the policy through the link of REQ-050.
      'reconciliation -> proposal',
      // REQ-093: the transfer is worth what the commission says it is worth,
      // override of REQ-066 included.
      'settlement -> commission',
      // REQ-091: the transfer of a payment method that requires confirmation
      // waits on the first installment of the policy schedule.
      'settlement -> policy',
      // REQ-090 keys the release rule by the payment method, and REQ-096 pays
      // the broker: both live on the proposal.
      'settlement -> proposal',
    ];

    const crossings = new Set<string>();

    for (const file of await coreFiles(CORE)) {
      const module = path.relative(CORE, file).split(path.sep)[0];

      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith('.')) continue;

        const target = path.resolve(path.dirname(file), specifier);
        if (!target.startsWith(CORE)) continue;

        const targetModule = path.relative(CORE, target).split(path.sep)[0];
        if (targetModule !== module) {
          crossings.add(`${module} -> ${targetModule}`);
        }
      }
    }

    expect([...crossings].sort()).toEqual([...declared].sort());
  });

  it('the dependencies between business modules have no cycle', async () => {
    // The list above grows with each slice, and reading nine arrows is no
    // longer enough to see that none of them closes a loop. A topological sort
    // answers it: if every module can be removed once nothing depends on it
    // any more, the graph is acyclic.
    const dependencies = new Map<string, Set<string>>();

    for (const file of await coreFiles(CORE)) {
      const module = path.relative(CORE, file).split(path.sep)[0] as string;
      const targets = dependencies.get(module) ?? new Set<string>();

      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith('.')) continue;

        const target = path.resolve(path.dirname(file), specifier);
        if (!target.startsWith(CORE)) continue;

        const targetModule = path.relative(CORE, target).split(path.sep)[0] as string;
        if (targetModule !== module) targets.add(targetModule);
      }

      dependencies.set(module, targets);
    }

    const remaining = new Map(dependencies);

    while (remaining.size > 0) {
      const settled = [...remaining]
        .filter(([, targets]) => [...targets].every((target) => !remaining.has(target)))
        .map(([module]) => module);

      // Nothing left to remove while modules remain means they depend on each
      // other, directly or through a chain.
      expect(settled, `cycle between: ${[...remaining.keys()].join(', ')}`).not.toEqual([]);

      for (const module of settled) remaining.delete(module);
    }
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
