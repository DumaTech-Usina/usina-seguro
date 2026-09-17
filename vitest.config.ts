import { defineConfig } from 'vitest/config';

/**
 * Tres suites com propositos distintos:
 *
 * - unit:        colocado junto ao codigo, usa fakes/InMemory, sem I/O.
 * - integration: componentes reais entre si, incluindo SQLite em disco.
 * - e2e:         processo HTTP real, exercitado por fora via fetch.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'tests/architecture/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.test.ts'],
          environment: 'node',
          // Cada arquivo e2e sobe o servidor em porta efemera (PORT=0) e usa seu
          // proprio arquivo SQLite temporario, entao arquivos nao colidem.
          testTimeout: 20_000,
        },
      },
    ],
  },
});
