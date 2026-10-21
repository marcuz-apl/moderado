import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts', 'apps/*/tests/**/*.test.ts', 'tests/**/*.test.ts'],
    // Several suites spawn real child processes (git, npm, node, PowerShell) and
    // pack tarballs. Creating a process costs 0.5-3s on Windows, so the 5s
    // default raced under full-suite parallelism and failed healthy code.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
