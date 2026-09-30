import { describe, expect, it } from 'vitest';
import { createDefaultToolRegistry } from '@moderado/tools';
import type { ApprovalRequest } from '@moderado/contracts';
import { DEFAULT_APPROVAL_SETTINGS, createApprovalGate, withApprovalSettings } from '../src/approval_handler.js';

function request(toolName: string): ApprovalRequest {
  return { requestId: 'req-1', toolName, actionSummary: toolName, exactPayload: {}, timestamp: 1 };
}

describe('VS Code approval gate', () => {
  it('uses the requested defaults and makes disabled reads approvable', () => {
    const settings = { ...DEFAULT_APPROVAL_SETTINGS };
    const tools = withApprovalSettings(createDefaultToolRegistry(), settings);
    expect(settings).toEqual({ read: true, edit: true, web_fetch: true, execute: false, mcp: false });
    expect(tools.get('read_file')?.requiresApproval).toBe(false);
    settings.read = false;
    expect(tools.get('read_file')?.requiresApproval).toBe(true);
    settings.web_fetch = false;
    expect(tools.get('web_search')?.requiresApproval).toBe(true);
  });

  it('auto-approves only enabled categories and waits for commands', async () => {
    const pending: ApprovalRequest[] = [];
    const gate = createApprovalGate({ ...DEFAULT_APPROVAL_SETTINGS }, (item) => pending.push(item));
    await expect(gate.requestApproval(request('edit_file'))).resolves.toMatchObject({ status: 'approved' });
    await expect(gate.requestApproval(request('web_search'))).resolves.toMatchObject({ status: 'approved' });
    const decision = gate.requestApproval(request('run_command'));
    expect(pending).toHaveLength(1);
    expect(gate.resolve('req-1', 'approved')).toBe(true);
    await expect(decision).resolves.toMatchObject({ status: 'approved' });
    gate.dispose();
  });

  it('denies pending decisions on disposal and rejects stale responses', async () => {
    const gate = createApprovalGate({ ...DEFAULT_APPROVAL_SETTINGS }, () => undefined);
    const decision = gate.requestApproval(request('mcp.server.tool'));
    expect(gate.resolve('wrong', 'approved')).toBe(false);
    gate.dispose();
    await expect(decision).resolves.toMatchObject({ status: 'aborted' });
  });
});
