import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { TerminalApprovalHandler } from '../src/ui/terminal_approval.js';
import { displayWidth } from '../src/ui/box.js';
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

  it('always approves subsequent actions when user inputs a', async () => {
    const stdin = Readable.from(['a\n']);
    const stdout = new Writable({ write(_chunk, _encoding, callback) { callback(); } });

    const handler = new TerminalApprovalHandler({ stdin, stdout });
    const decision1 = await handler.requestApproval(sampleRequest);
    expect(decision1.status).toBe('approved');

    // Subsequent call auto-approves without reading stdin again
    const secondRequest: ApprovalRequest = {
      ...sampleRequest,
      requestId: 'req_test_2',
    };
    const decision2 = await handler.requestApproval(secondRequest);
    expect(decision2.status).toBe('approved');
  });

  it('denies action when user inputs n', async () => {
    const stdin = Readable.from(['n\n']);
    const stdout = new Writable({ write(_chunk, _encoding, callback) { callback(); } });

    const handler = new TerminalApprovalHandler({ stdin, stdout });
    const decision = await handler.requestApproval(sampleRequest);

    expect(decision.status).toBe('denied');
  });

  it('approves on a bare Enter, which the box advertises as the default', async () => {
    // Enter used to deny while the box printed a capitalised default key, so an
    // ordinary `npx` scaffold looked like a permissions bug.
    const stdin = Readable.from(['\n']);
    const stdout = new Writable({ write(_chunk, _encoding, callback) { callback(); } });

    const handler = new TerminalApprovalHandler({ stdin, stdout });
    const decision = await handler.requestApproval(sampleRequest);

    expect(decision.status).toBe('approved');
  });

  it('re-asks on an unrecognised key instead of silently denying', async () => {
    let output = '';
    const stdin = Readable.from(['x\n', 'y\n']);
    const stdout = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });

    const handler = new TerminalApprovalHandler({ stdin, stdout });
    const decision = await handler.requestApproval(sampleRequest);

    expect(decision.status).toBe('approved');
    expect(output).toContain('Please answer y, a, n, or q.');
  });

  it('keeps the permission box inside the terminal and summarises a long diff', async () => {
    let output = '';
    const stdout = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    Object.assign(stdout, { columns: 50 });
    const diffPreview = Array.from({ length: 40 }, (_, index) => `+${'const value = compute(); '.repeat(8)}${index}`).join('\n');
    const request: ApprovalRequest = {
      ...sampleRequest,
      toolName: 'apply_patch',
      exactPayload: { targetFile: 'src/App.tsx', diffPreview },
    };

    const handler = new TerminalApprovalHandler({ stdin: Readable.from(['n\n']), stdout });
    const decision = await handler.requestApproval(request);

    expect(decision.status).toBe('denied');
    const plain = output.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
    const lines = plain.split('\n').filter((line) => line.trim().length > 0);
    // The prompt used to widen to the longest diff line and wrap out of the frame.
    expect(lines.every((line) => displayWidth(line) <= 50)).toBe(true);
    // The tail of a huge patch is a count, not forty rows of source.
    expect(plain).toContain('30 more lines');
    expect(plain).toContain('not shown');
  });

  it('fails closed when stdin ends without an answer', async () => {
    // A closed stream resolves like a bare Enter. Approving there would turn an
    // unattended session into an auto-approver.
    const stdout = new Writable({ write(_chunk, _encoding, callback) { callback(); } });

    const handler = new TerminalApprovalHandler({ stdin: Readable.from([]), stdout });
    const decision = await handler.requestApproval(sampleRequest);

    expect(decision.status).toBe('aborted');
  });

  it('aborts session when user inputs q', async () => {
    const stdin = Readable.from(['q\n']);
    const stdout = new Writable({ write(_chunk, _encoding, callback) { callback(); } });

    const handler = new TerminalApprovalHandler({ stdin, stdout });
    const decision = await handler.requestApproval(sampleRequest);

    expect(decision.status).toBe('aborted');
  });
});
