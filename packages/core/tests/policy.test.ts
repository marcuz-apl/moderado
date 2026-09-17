import { describe, it, expect } from 'vitest';
import { PolicyManager } from '../src/policy.js';

describe('PolicyManager', () => {
  it('enforces step bounds', () => {
    const policy = new PolicyManager({ maxSteps: 3 });
    expect(policy.isStepWithinLimit(0)).toBe(true);
    expect(policy.isStepWithinLimit(2)).toBe(true);
    expect(policy.isStepWithinLimit(3)).toBe(false);
  });

  it('allows all tools in default interactive mode', () => {
    const policy = new PolicyManager();
    expect(policy.validateToolAction('read_file', false).allowed).toBe(true);
    expect(policy.validateToolAction('write_file', true).allowed).toBe(true);
    expect(policy.validateToolAction('run_command', true).allowed).toBe(true);
  });

  it('denies mutating operations in read-only mode', () => {
    const policy = new PolicyManager({ readOnly: true });
    expect(policy.validateToolAction('read_file', false).allowed).toBe(true);
    expect(policy.validateToolAction('write_file', true).allowed).toBe(false);
    expect(policy.validateToolAction('run_command', true).allowed).toBe(false);
  });

  it('denies approval-requiring operations in non-interactive mode', () => {
    const policy = new PolicyManager({ nonInteractive: true });
    expect(policy.validateToolAction('read_file', false).allowed).toBe(true);
    expect(policy.validateToolAction('write_file', true).allowed).toBe(false);
    expect(policy.validateToolAction('run_command', true).allowed).toBe(false);
  });
});
