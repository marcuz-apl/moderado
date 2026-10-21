import { describe, it, expect, vi } from 'vitest';
import type { ApprovalDecision, ApprovalRequest } from '@moderado/contracts';
import { createRunApprovalHandler } from '../src/commands/run.js';

function request(toolName: string, command?: string[]): ApprovalRequest {
  return {
    requestId: 'req_test',
    toolName,
    actionSummary: `Execute ${toolName}`,
    exactPayload: command ? { command } : {},
    timestamp: Date.now(),
  };
}

describe('moderado run approval policy', () => {
  it('asks the operator before a workspace mutation without --auto-approve', async () => {
    const interactive = vi.fn(async (): Promise<ApprovalDecision> => ({ requestId: 'req_test', status: 'denied' }));
    const handler = createRunApprovalHandler({ autoApprove: false, requestInteractiveApproval: interactive });

    const decision = await handler.requestApproval(request('write_file'));

    expect(interactive).toHaveBeenCalledTimes(1);
    expect(decision.status).toBe('denied');
  });

  it('approves workspace mutations without prompting when --auto-approve is set', async () => {
    const interactive = vi.fn(async (): Promise<ApprovalDecision> => ({ requestId: 'req_test', status: 'denied' }));
    const handler = createRunApprovalHandler({ autoApprove: true, requestInteractiveApproval: interactive });

    const decision = await handler.requestApproval(request('run_command', ['node', '--version']));

    expect(decision.status).toBe('approved');
    expect(interactive).not.toHaveBeenCalled();
  });

  it('still prompts for a network command under --auto-approve', async () => {
    const interactive = vi.fn(async (): Promise<ApprovalDecision> => ({ requestId: 'req_test', status: 'approved' }));
    const handler = createRunApprovalHandler({ autoApprove: true, requestInteractiveApproval: interactive });

    await handler.requestApproval(request('run_command', ['curl', 'https://example.com']));

    expect(interactive).toHaveBeenCalledTimes(1);
  });

  it('still prompts for an MCP tool under --auto-approve', async () => {
    const interactive = vi.fn(async (): Promise<ApprovalDecision> => ({ requestId: 'req_test', status: 'approved' }));
    const handler = createRunApprovalHandler({ autoApprove: true, requestInteractiveApproval: interactive });

    await handler.requestApproval(request('mcp.local.search'));

    expect(interactive).toHaveBeenCalledTimes(1);
  });
});
