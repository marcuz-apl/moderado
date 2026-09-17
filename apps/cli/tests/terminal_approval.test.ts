import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { TerminalApprovalHandler } from '../src/ui/terminal_approval.js';
import { ApprovalRequest } from '@moderado/contracts';

describe('TerminalApprovalHandler', () => {
  const sampleRequest: ApprovalRequest = {
    requestId: 'req_test',
    toolName: 'write_file',
    actionSummary: 'Write config.json',
    exactPayload: {
      targetFile: 'config.json',
      contentPreview: '{"key": "value"}',
    },
    timestamp: Date.now(),
  };

  it('approves action when user inputs y', async () => {
    const stdin = Readable.from(['y\n']);
    const stdout = new Writable({ write(_chunk, _encoding, callback) { callback(); } });

    const handler = new TerminalApprovalHandler({ stdin, stdout });
    const decision = await handler.requestApproval(sampleRequest);

    expect(decision.status).toBe('approved');
  });

  it('denies action when user inputs n or enters empty', async () => {
    const stdin = Readable.from(['n\n']);
    const stdout = new Writable({ write(_chunk, _encoding, callback) { callback(); } });

    const handler = new TerminalApprovalHandler({ stdin, stdout });
    const decision = await handler.requestApproval(sampleRequest);

    expect(decision.status).toBe('denied');
  });

  it('aborts session when user inputs q', async () => {
    const stdin = Readable.from(['q\n']);
    const stdout = new Writable({ write(_chunk, _encoding, callback) { callback(); } });

    const handler = new TerminalApprovalHandler({ stdin, stdout });
    const decision = await handler.requestApproval(sampleRequest);

    expect(decision.status).toBe('aborted');
  });
});
