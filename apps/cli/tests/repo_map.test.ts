import { expect, it } from 'vitest';
import { formatWorkspaceMap } from '../src/repo_map.js';

it('groups files into a compact module map with useful source paths', () => {
  const map = formatWorkspaceMap([
    'README.md', 'apps/cli/tests/chat.test.ts', 'apps/cli/src/commands/chat.ts',
    'apps/cli/package.json', 'packages/core/src/agent.ts', 'packages/core/tests/agent.test.ts',
  ]);
  expect(map).toContain('apps/cli (3 files)');
  expect(map).toContain('src/commands/chat.ts');
  expect(map).toContain('packages/core (2 files)');
  expect(map).toContain('src/agent.ts');
  expect(map).toContain('README.md');
  expect(map.split('\n').length).toBeLessThan(12);
});

it('limits module and file output so large repositories fit a terminal', () => {
  const files = Array.from({ length: 30 }, (_, i) => `module${i}/src/file${i}.ts`);
  const map = formatWorkspaceMap(files);
  expect(map).toContain('more modules');
  expect(map.split('\n').length).toBeLessThanOrEqual(18);
});

it('does not let unusual file names inject terminal control characters', () => {
  const map = formatWorkspaceMap(['src/unsafe\x1b[31m.ts', 'src/line\nbreak.ts']);
  expect(map).not.toContain('\x1b');
  expect(map).not.toContain('line\nbreak');
});
