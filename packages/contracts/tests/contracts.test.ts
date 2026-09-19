import { describe, it, expect } from 'vitest';
import {
  AccessTierSchema,
  ToolSupportSchema,
  ModelInventoryEntrySchema,
  ModelClassificationSchema,
  ChatMessageSchema,
  ProviderError,
  AuthenticationError,
  RateLimitError,
  ModelUnavailableError,
  ReadFileParamsSchema,
  WriteFileParamsSchema,
  EditFileParamsSchema,
  ListFilesParamsSchema,
  SearchFilesParamsSchema,
  RunCommandParamsSchema,
  RunDiagnosticsParamsSchema,
  DiagnosticSchema,
  GitDiffParamsSchema,
  ApprovalRequestSchema,
  ApprovalDecisionSchema,
  AgentEventSchema,
} from '../src/index.js';

describe('Contracts: Models & Classifications', () => {
  it('validates correct access tiers and rejects invalid ones', () => {
    expect(AccessTierSchema.parse('free_trial')).toBe('free_trial');
    expect(AccessTierSchema.parse('paid')).toBe('paid');
    expect(AccessTierSchema.parse('local')).toBe('local');
    expect(AccessTierSchema.parse('unknown')).toBe('unknown');
    expect(() => AccessTierSchema.parse('invalid_tier')).toThrow();
  });

  it('validates tool support tiers', () => {
    expect(ToolSupportSchema.parse('supported')).toBe('supported');
    expect(ToolSupportSchema.parse('unsupported')).toBe('unsupported');
    expect(ToolSupportSchema.parse('unknown')).toBe('unknown');
    expect(() => ToolSupportSchema.parse('maybe')).toThrow();
  });

  it('parses model inventory entry', () => {
    const entry = {
      id: 'meta/llama-3.3-70b-instruct',
      object: 'model',
      created: 1700000000,
      owned_by: 'nvidia',
    };
    const parsed = ModelInventoryEntrySchema.parse(entry);
    expect(parsed.id).toBe('meta/llama-3.3-70b-instruct');
    expect(parsed.owned_by).toBe('nvidia');
  });

  it('parses model classification schema with ISO timestamp', () => {
    const classification = {
      modelId: 'meta/llama-3.3-70b-instruct',
      accessTier: 'free_trial',
      toolSupport: 'supported',
      source: 'official_metadata',
      verifiedAt: '2026-09-16T21:00:00Z',
    };
    const parsed = ModelClassificationSchema.parse(classification);
    expect(parsed.accessTier).toBe('free_trial');
    expect(parsed.toolSupport).toBe('supported');
  });
});

describe('Contracts: Chat Messages & Tool Calls', () => {
  it('parses system, user, and assistant messages', () => {
    const sys = ChatMessageSchema.parse({ role: 'system', content: 'You are Moderado.' });
    expect(sys.role).toBe('system');

    const user = ChatMessageSchema.parse({ role: 'user', content: 'Hello' });
    expect(user.role).toBe('user');

    const assistant = ChatMessageSchema.parse({
      role: 'assistant',
      content: 'I will read the file.',
      toolCalls: [
        {
          id: 'call_1',
          name: 'read_file',
          arguments: { path: 'package.json' },
        },
      ],
    });
    expect(assistant.role).toBe('assistant');
    if (assistant.role === 'assistant') {
      expect(assistant.toolCalls?.length).toBe(1);
      expect(assistant.toolCalls?.[0].name).toBe('read_file');
    }
  });

  it('parses tool execution message', () => {
    const toolMsg = ChatMessageSchema.parse({
      role: 'tool',
      toolCallId: 'call_1',
      name: 'read_file',
      content: '{"name": "test"}',
      status: 'success',
    });
    expect(toolMsg.role).toBe('tool');
  });
});

describe('Contracts: Provider Error Hierarchy', () => {
  it('instantiates typed provider errors correctly', () => {
    const authErr = new AuthenticationError();
    expect(authErr).toBeInstanceOf(ProviderError);
    expect(authErr.name).toBe('AuthenticationError');
    expect(authErr.code).toBe('ERR_PROVIDER_AUTHENTICATION');
    expect(authErr.statusCode).toBe(401);

    const rateErr = new RateLimitError('Too many calls', 15);
    expect(rateErr).toBeInstanceOf(ProviderError);
    expect(rateErr.retryAfterSeconds).toBe(15);
    expect(rateErr.code).toBe('ERR_PROVIDER_RATE_LIMIT');

    const unavailErr = new ModelUnavailableError('Service down', 503);
    expect(unavailErr.code).toBe('ERR_MODEL_UNAVAILABLE');
    expect(unavailErr.statusCode).toBe(503);
  });
});

describe('Contracts: 7 Tool Parameter Schemas', () => {
  it('validates read_file parameters with defaults', () => {
    const parsed = ReadFileParamsSchema.parse({ path: 'src/index.ts' });
    expect(parsed.path).toBe('src/index.ts');
    expect(parsed.offset).toBe(1);
    expect(parsed.limit).toBe(500);

    expect(() => ReadFileParamsSchema.parse({ path: '' })).toThrow();
  });

  it('validates write_file parameters', () => {
    const parsed = WriteFileParamsSchema.parse({ path: 'test.txt', content: 'hello' });
    expect(parsed.content).toBe('hello');
    expect(() => WriteFileParamsSchema.parse({ path: '' })).toThrow();
  });

  it('validates edit_file parameters', () => {
    const parsed = EditFileParamsSchema.parse({
      path: 'index.ts',
      targetContent: 'old code',
      replacementContent: 'new code',
    });
    expect(parsed.targetContent).toBe('old code');
    expect(() => EditFileParamsSchema.parse({ path: 'x', targetContent: '', replacementContent: '' })).toThrow();
  });

  it('validates list_files parameters', () => {
    const parsed = ListFilesParamsSchema.parse({});
    expect(parsed.subpath).toBe('.');
    expect(parsed.recursive).toBe(false);
    expect(parsed.maxDepth).toBe(3);
  });

  it('validates search_files parameters', () => {
    const parsed = SearchFilesParamsSchema.parse({ query: 'export function' });
    expect(parsed.query).toBe('export function');
    expect(parsed.isRegex).toBe(false);
    expect(parsed.caseSensitive).toBe(true);
  });

  it('validates run_command parameters', () => {
    const parsed = RunCommandParamsSchema.parse({ command: 'npm', args: ['test'] });
    expect(parsed.command).toBe('npm');
    expect(parsed.args).toEqual(['test']);
    expect(parsed.timeoutSeconds).toBe(60);
  });

  it('validates diagnostics parameters', () => {
    expect(RunDiagnosticsParamsSchema.parse({ script: 'typecheck' }).script).toBe('typecheck');
    expect(() => RunDiagnosticsParamsSchema.parse({ script: 'prepare' })).toThrow();
    expect(DiagnosticSchema.parse({ severity: 'error', message: 'Type mismatch', file: 'src/a.ts', line: 4, column: 2, code: 'TS2322' }).code).toBe('TS2322');
  });

  it('validates git_diff parameters', () => {
    const parsed = GitDiffParamsSchema.parse({ staged: true });
    expect(parsed.staged).toBe(true);
  });
});

describe('Contracts: Approvals and Lifecycle Events', () => {
  it('validates approval request and decision', () => {
    const req = ApprovalRequestSchema.parse({
      requestId: 'req_123',
      toolName: 'run_command',
      actionSummary: 'Execute npm test',
      exactPayload: {
        command: ['npm', 'test'],
        cwd: '/workspace',
      },
      timestamp: Date.now(),
    });
    expect(req.requestId).toBe('req_123');

    const dec = ApprovalDecisionSchema.parse({
      requestId: 'req_123',
      status: 'approved',
    });
    expect(dec.status).toBe('approved');
  });

  it('validates agent lifecycle events discriminated by type', () => {
    const modelEvent = AgentEventSchema.parse({
      type: 'model_change',
      newModelId: 'meta/llama-3.3-70b-instruct',
      reason: 'initial_selection',
      accessClass: 'free_trial',
      timestamp: Date.now(),
    });
    expect(modelEvent.type).toBe('model_change');

    const progressEvent = AgentEventSchema.parse({
      type: 'progress',
      step: 1,
      maxSteps: 25,
      status: 'Inferring next action...',
      timestamp: Date.now(),
    });
    expect(progressEvent.type).toBe('progress');

    const reasoningEvent = AgentEventSchema.parse({
      type: 'reasoning_delta',
      delta: 'Considering approaches...',
      timestamp: Date.now(),
    });
    expect(reasoningEvent.type).toBe('reasoning_delta');

    const completionEvent = AgentEventSchema.parse({
      type: 'completion',
      status: 'completed',
      totalSteps: 3,
      timestamp: Date.now(),
    });
    expect(completionEvent.type).toBe('completion');
  });
});
