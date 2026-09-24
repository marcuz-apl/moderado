import { describe, expect, it } from 'vitest';
import type { ApprovalRequest } from '@moderado/contracts';
import { ApprovalQueue } from '../src/host/approval_queue.js';

describe('Host ApprovalQueue', () => {
  const sampleRequest: ApprovalRequest = {
    requestId: 'appr-1',
    toolName: 'write_file',
    actionSummary: 'Write to file foo.ts',
    exactPayload: {
      targetFile: 'foo.ts',
      contentPreview: 'console.log("hello");',
    },
    timestamp: Date.now(),
  };

  it('resolves an approval request with approved status', async () => {
    const queue = new ApprovalQueue();
    const promise = queue.requestApproval(sampleRequest);

    const resolved = queue.resolve('appr-1', 'approved');
    expect(resolved).toBe(true);

    const decision = await promise;
    expect(decision).toEqual({
      requestId: 'appr-1',
      status: 'approved',
    });
  });

  it('resolves an approval request with denied status', async () => {
    const queue = new ApprovalQueue();
    const promise = queue.requestApproval(sampleRequest);

    const resolved = queue.resolve('appr-1', 'denied', 'user rejected edit');
    expect(resolved).toBe(true);

    const decision = await promise;
    expect(decision).toEqual({
      requestId: 'appr-1',
      status: 'denied',
      reason: 'user rejected edit',
    });
  });

  it('rejects duplicate in-flight approval request IDs', async () => {
    const queue = new ApprovalQueue();
    queue.requestApproval(sampleRequest);

    await expect(queue.requestApproval(sampleRequest)).rejects.toThrow(/duplicate/i);
  });

  it('returns false when resolving unknown or stale approval requestId', () => {
    const queue = new ApprovalQueue();
    expect(queue.resolve('unknown-id', 'approved')).toBe(false);

    queue.requestApproval(sampleRequest);
    queue.resolve('appr-1', 'approved');
    // Resolving again should be false (stale)
    expect(queue.resolve('appr-1', 'approved')).toBe(false);
  });

  it('resolves pending approval as aborted when AbortSignal triggers', async () => {
    const queue = new ApprovalQueue();
    const ac = new AbortController();

    const promise = queue.requestApproval(sampleRequest, ac.signal);
    ac.abort();

    const decision = await promise;
    expect(decision).toEqual({
      requestId: 'appr-1',
      status: 'aborted',
    });
    // Queue should no longer have this pending
    expect(queue.resolve('appr-1', 'approved')).toBe(false);
  });

  it('resolves pending approval as aborted when queue is closed', async () => {
    const queue = new ApprovalQueue();
    const promise = queue.requestApproval(sampleRequest);

    queue.close();

    const decision = await promise;
    expect(decision).toEqual({
      requestId: 'appr-1',
      status: 'aborted',
    });
  });

  it('immediately returns aborted if requestApproval called after queue is closed', async () => {
    const queue = new ApprovalQueue();
    queue.close();

    const decision = await queue.requestApproval(sampleRequest);
    expect(decision).toEqual({
      requestId: 'appr-1',
      status: 'aborted',
    });
  });
});
