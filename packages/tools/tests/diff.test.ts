import { describe, it, expect } from 'vitest';
import { generateDiffPreview } from '../src/diff.js';
import { TargetNotFoundError, AmbiguousTargetError } from '../src/errors.js';

describe('Diff Utility', () => {
  const sampleCode = `function calculateTotal(items) {
  let total = 0;
  for (const item of items) {
    total += item.price;
  }
  return total;
}`;

  it('generates a clean unified diff for a unique target', () => {
    const target = '    total += item.price;';
    const replacement = '    total += item.price * (1 - item.discount);';

    const result = generateDiffPreview('calc.js', sampleCode, target, replacement);

    expect(result.matchedLine).toBe(4);
    expect(result.diffPreview).toContain('--- a/calc.js');
    expect(result.diffPreview).toContain('+++ b/calc.js');
    expect(result.diffPreview).toContain('-    total += item.price;');
    expect(result.diffPreview).toContain('+    total += item.price * (1 - item.discount);');
    expect(result.newContent).toContain('total += item.price * (1 - item.discount);');
  });

  it('throws TargetNotFoundError when target is not present', () => {
    expect(() =>
      generateDiffPreview('calc.js', sampleCode, 'nonExistentLine();', 'newCode();')
    ).toThrow(TargetNotFoundError);
  });

  it('throws AmbiguousTargetError when target appears more than once', () => {
    const codeWithDuplicates = `const a = 1;\nconst a = 1;`;
    expect(() =>
      generateDiffPreview('calc.js', codeWithDuplicates, 'const a = 1;', 'const a = 2;')
    ).toThrow(AmbiguousTargetError);
  });
});
