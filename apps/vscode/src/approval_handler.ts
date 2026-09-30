import type { ApprovalDecision, ApprovalRequest, HostApprovalCategory, IApprovalHandler, IToolRegistry } from '@moderado/contracts';
import { ToolRegistry } from '@moderado/tools';

export type ApprovalSettings = Record<HostApprovalCategory, boolean>;

export const DEFAULT_APPROVAL_SETTINGS: ApprovalSettings = {
  read: true,
  edit: true,
  web_fetch: true,
  execute: false,
  mcp: false,
};

function categoryFor(toolName: string): HostApprovalCategory | undefined {
  if (toolName.startsWith('mcp.')) return 'mcp';
  if (['write_file', 'edit_file', 'apply_patch'].includes(toolName)) return 'edit';
  if (['run_command', 'run_diagnostics'].includes(toolName)) return 'execute';
  if (toolName === 'web_search') return 'web_fetch';
  if (['read_file', 'list_files', 'search_files', 'git_diff', 'get_definition', 'find_references'].includes(toolName)) return 'read';
  return undefined;
}

/** Core consults requiresApproval before calling its approval handler. */
export function withApprovalSettings(registry: IToolRegistry, settings: ApprovalSettings): IToolRegistry {
  const wrapped = new ToolRegistry();
  for (const tool of registry.list()) {
    const category = categoryFor(tool.name);
    wrapped.register({
      ...tool,
      get requiresApproval() { return tool.requiresApproval || !category || !settings[category]; },
    });
  }
  return wrapped;
}

export interface ApprovalGate extends IApprovalHandler {
  resolve(requestId: string, status: 'approved' | 'denied'): boolean;
  dispose(): void;
}

/** Pending decisions live in the extension host, never in the webview. */
export function createApprovalGate(settings: ApprovalSettings, onPending: (request: ApprovalRequest) => void): ApprovalGate {
  const pending = new Map<string, (status: ApprovalDecision['status']) => void>();
  let disposed = false;
  return {
    async requestApproval(request, signal) {
      if (disposed || signal?.aborted) return { requestId: request.requestId, status: 'aborted', reason: 'Approval view closed.' };
      const category = categoryFor(request.toolName);
      if (category && settings[category]) return { requestId: request.requestId, status: 'approved' };
      if (pending.has(request.requestId)) return { requestId: request.requestId, status: 'denied', reason: 'Duplicate approval request.' };
      return new Promise<ApprovalDecision>((resolve) => {
        const finish = (status: ApprovalDecision['status']): void => {
          pending.delete(request.requestId);
          signal?.removeEventListener('abort', onAbort);
          resolve({ requestId: request.requestId, status });
        };
        const onAbort = (): void => finish('aborted');
        pending.set(request.requestId, finish);
        signal?.addEventListener('abort', onAbort, { once: true });
        try { onPending(request); } catch { finish('aborted'); }
      });
    },
    resolve(requestId, status) {
      const finish = pending.get(requestId);
      if (!finish) return false;
      finish(status);
      return true;
    },
    dispose() {
      disposed = true;
      for (const finish of [...pending.values()]) finish('aborted');
    },
  };
}
