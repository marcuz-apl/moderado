import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AgentLoop, PolicyManager, Router } from '@moderado/core';
import { FakeProviderAdapter } from '@moderado/providers';
import { createDefaultToolRegistry } from '@moderado/tools';
import { AgentEvent, IApprovalHandler } from '@moderado/contracts';

describe('E2E Integration: Autonomous Coding Flow', () => {
  let tempDir: string;
  let provider: FakeProviderAdapter;
  let tools: ReturnType<typeof createDefaultToolRegistry>;
  let loop: AgentLoop;
  let events: AgentEvent[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-e2e-flow-'));
    provider = new FakeProviderAdapter();
    tools = createDefaultToolRegistry();
    loop = new AgentLoop();
    events = [];
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const autoApproveHandler: IApprovalHandler = {
    async requestApproval(req) {
      return { requestId: req.requestId, status: 'approved' };
    },
  };

  it('orchestrates complete coding workflow: create code, write test, run test, summarize', async () => {
    // Turn 1: Assistant creates math.js
    provider.queueToolCallResponse(
      'write_file',
      { path: 'math.js', content: 'export function sum(a, b) { return a + b; }' },
      'Creating math.js utility.'
    );

    // Turn 2: Assistant creates test script test.js
    provider.queueToolCallResponse(
      'write_file',
      {
        path: 'test.js',
        content: `import { sum } from './math.js';
if (sum(2, 3) !== 5) { throw new Error('Sum failed'); }
console.log('Math test passed!');`,
      },
      'Creating test suite.'
    );

    // Turn 3: Assistant runs node test.js
    provider.queueToolCallResponse(
      'run_command',
      { command: process.execPath, args: ['test.js'] },
      'Executing tests now.'
    );

    // Turn 4: Assistant summarizes success
    provider.queueTextResponse('All tests passed successfully! Function sum(a, b) is verified.');

    const result = await loop.run('Implement sum function with tests', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      router: new Router(),
      policy: new PolicyManager({ maxSteps: 10 }),
      eventListener: (e) => events.push(e),
    });

    expect(result.status).toBe('completed');
    expect(result.totalSteps).toBe(4);
    expect(result.finalMessage).toContain('All tests passed successfully!');

    // Verify files on disk
    expect(fs.existsSync(path.join(tempDir, 'math.js'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'test.js'))).toBe(true);

    // Verify event stream
    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolResults.length).toBe(3);
    const commandResult = toolResults.find((r: any) => r.result.toolName === 'run_command');
    expect((commandResult as any)?.result.output).toContain('Math test passed!');
  });
});
