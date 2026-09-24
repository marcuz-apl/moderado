import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalStatus,
  IApprovalHandler,
} from '@moderado/contracts';

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class ApprovalQueue implements IApprovalHandler {
  private readonly pending = new Map<string, PendingApproval>();
  private closed = false;

  async requestApproval(
    request: ApprovalRequest,
    signal?: AbortSignal,
  ): Promise<ApprovalDecision> {
    if (this.closed || signal?.aborted) {
      return {
        requestId: request.requestId,
        status: 'aborted',
      };
    }

    if (this.pending.has(request.requestId)) {
      throw new Error(`Duplicate approval request ID: ${request.requestId}`);
    }

    return new Promise<ApprovalDecision>((resolve) => {
      const entry: PendingApproval = {
        request,
        resolve,
        signal,
      };

      if (signal) {
        entry.onAbort = () => {
          this.pending.delete(request.requestId);
          resolve({
            requestId: request.requestId,
            status: 'aborted',
          });
        };
        signal.addEventListener('abort', entry.onAbort, { once: true });
      }

      this.pending.set(request.requestId, entry);
    });
  }

  resolve(requestId: string, status: ApprovalStatus, reason?: string): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) {
      return false;
    }

    this.pending.delete(requestId);
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener('abort', entry.onAbort);
    }

    entry.resolve({
      requestId,
      status,
      reason,
    });
    return true;
  }

  close(): void {
    this.closed = true;
    for (const [requestId, entry] of this.pending.entries()) {
      if (entry.signal && entry.onAbort) {
        entry.signal.removeEventListener('abort', entry.onAbort);
      }
      entry.resolve({
        requestId,
        status: 'aborted',
      });
    }
    this.pending.clear();
  }
}
