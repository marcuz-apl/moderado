import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IApprovalHandler } from '@moderado/contracts';
import { AgentEvent } from '@moderado/contracts';
import { FakeProviderAdapter } from '@moderado/providers';
import { createDefaultToolRegistry } from '@moderado/tools';
import { SubagentDelegator } from '../src/subagent.js';

describe('SubagentDelegator', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('uses the injected approval handler for a child mutation', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-subagent-'));
    temporaryDirectories.push(workspaceRoot);
    const provider = new FakeProviderAdapter();
    const tools = createDefaultToolRegistry();
    let approvalRequests = 0;
    const approvalHandler: IApprovalHandler = {
      async requestApproval(request) {
        approvalRequests++;
        return { requestId: request.requestId, status: 'denied' };
      },
    };
    const delegator = new SubagentDelegator(workspaceRoot, tools, approvalHandler);

    provider.queueToolCallResponse('write_file', { path: 'blocked.txt', content: 'blocked' });
    provider.queueTextResponse('The write was denied.');

    const result = await delegator.delegate('Write blocked.txt', provider);

    expect(result.status).toBe('completed');
    expect(approvalRequests).toBe(1);
    expect(fs.existsSync(path.join(workspaceRoot, 'blocked.txt'))).toBe(false);
  });

  it('forwards child mutation lifecycle hooks', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-subagent-'));
    temporaryDirectories.push(workspaceRoot);
    const provider = new FakeProviderAdapter();
    const lifecycle: string[] = [];
    const approvalHandler: IApprovalHandler = {
      async requestApproval(request) {
        return { requestId: request.requestId, status: 'approved' };
      },
    };
    const delegator = new SubagentDelegator(
      workspaceRoot,
      createDefaultToolRegistry(),
      approvalHandler,
      undefined,
      undefined,
      (toolName) => lifecycle.push(`approved:${toolName}`),
      (toolName, _parameters, result) => lifecycle.push(`completed:${toolName}:${result.status}`),
    );
    provider.queueToolCallResponse('write_file', { path: 'child.txt', content: 'child' });
    provider.queueTextResponse('Written.');

    await delegator.delegate('Write child.txt', provider);

    expect(lifecycle).toEqual(['approved:write_file', 'completed:write_file:success']);
  });

  it('does not advertise or execute nested subagent delegation', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-subagent-'));
    temporaryDirectories.push(workspaceRoot);
    const provider = new FakeProviderAdapter();
    provider.queueToolCallResponse('subagent', { detail: 'nested task' });
    provider.queueTextResponse('Nested delegation was rejected.');
    const approvalHandler: IApprovalHandler = {
      async requestApproval(request) {
        return { requestId: request.requestId, status: 'approved' };
      },
    };

    const events: AgentEvent[] = [];
    const result = await new SubagentDelegator(
      workspaceRoot,
      createDefaultToolRegistry(),
      approvalHandler,
      (event) => events.push(event),
    ).delegate('Parent child task', provider);

    expect(provider.recordedCalls[0]?.tools?.some((tool) => tool.name === 'subagent')).toBe(false);
    expect(result.finalMessage).toBe('');
    expect(events.some((event) => event.type === 'tool_result' && event.result.output === 'Nested subagent delegation is not allowed.')).toBe(true);
  });
});
