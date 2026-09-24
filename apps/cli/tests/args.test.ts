import { describe, it, expect } from 'vitest';
import { parseCliArgs } from '../src/args.js';

describe('CLI Argument Parser', () => {
  it('parses models command', () => {
    const args = parseCliArgs(['models', '--json']);
    expect(args.command).toBe('models');
    expect(args.json).toBe(true);
  });

  it('parses run command with task and options', () => {
    const args = parseCliArgs([
      'run',
      'Add unit tests',
      '--workspace',
      './my-app',
      '--model',
      'meta/llama-3.3-70b-instruct',
      '--max-steps',
      '10',
      '--read-only',
      '--auto-approve',
      '--non-interactive',
      '--allow-paid',
    ]);

    expect(args.command).toBe('run');
    expect(args.task).toBe('Add unit tests');
    expect(args.workspace).toBe('./my-app');
    expect(args.model).toBe('meta/llama-3.3-70b-instruct');
    expect(args.maxSteps).toBe(10);
    expect(args.readOnly).toBe(true);
    expect(args.autoApprove).toBe(true);
    expect(args.nonInteractive).toBe(true);
    expect(args.allowPaid).toBe(true);
  });

  it('parses -y short flag for auto-approve', () => {
    expect(parseCliArgs(['-y']).autoApprove).toBe(true);
  });

  it('infers run command when task is passed directly without run keyword', () => {
    const args = parseCliArgs(['Fix authentication bug', '-w', './src']);
    expect(args.command).toBe('run');
    expect(args.task).toBe('Fix authentication bug');
    expect(args.workspace).toBe('./src');
  });

  it('parses plural skills command only', () => {
    expect(parseCliArgs(['skills']).command).toBe('skills');
    expect(parseCliArgs(['skill']).command).toBe('run');
  });
  it('parses --help and --version flags', () => {
    expect(parseCliArgs(['--help']).help).toBe(true);
    expect(parseCliArgs(['-h']).help).toBe(true);
    expect(parseCliArgs(['--version']).version).toBe(true);
    expect(parseCliArgs(['-v']).version).toBe(true);
  });

  it('requires an explicit doctor migration flag', () => {
    expect(parseCliArgs(['doctor', '--migrate-credentials']).migrateCredentials).toBe(true);
  });

  it('parses host command with workspace and protocol', () => {
    const args = parseCliArgs(['host', '--workspace', './my-workspace', '--protocol', '1']);
    expect(args.command).toBe('host');
    expect(args.workspace).toBe('./my-workspace');
    expect(args.protocol).toBe(1);
  });

  it('leaves workspace empty when host command is called without --workspace', () => {
    const args = parseCliArgs(['host', '--protocol', '1']);
    expect(args.command).toBe('host');
    expect(args.workspace).toBe('');
    expect(args.protocol).toBe(1);
  });

  it('parses custom or invalid protocol version as number or undefined', () => {
    const args = parseCliArgs(['host', '-w', './src', '--protocol', '2']);
    expect(args.command).toBe('host');
    expect(args.protocol).toBe(2);
  });
});
