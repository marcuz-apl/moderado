import * as vscode from 'vscode';
import { createDefaultToolRegistry } from '@moderado/tools';
import type { IProviderAdapter } from '@moderado/contracts';
import { findProviderPreset, NvidiaAdapter, OpenAICompatibleAdapter } from '@moderado/providers';
import { createAgentHost, type AgentHost } from './agent_host.js';
import { DEFAULT_APPROVAL_SETTINGS, type ApprovalSettings } from './approval_handler.js';

const APPROVALS_KEY = 'moderado.approvals';
const SECRET_PREFIX = 'moderado.apiKey.';

/**
 * Only the five known categories may be persisted, and each falls back to the
 * stated default, so a new workspace starts at Read/Edit/Web on, Execute/MCP off.
 */
function readApprovals(state: vscode.Memento): ApprovalSettings {
  const stored = state.get<Partial<ApprovalSettings>>(APPROVALS_KEY) ?? {};
  return {
    read: stored.read ?? DEFAULT_APPROVAL_SETTINGS.read,
    edit: stored.edit ?? DEFAULT_APPROVAL_SETTINGS.edit,
    web_fetch: stored.web_fetch ?? DEFAULT_APPROVAL_SETTINGS.web_fetch,
    execute: stored.execute ?? DEFAULT_APPROVAL_SETTINGS.execute,
    mcp: stored.mcp ?? DEFAULT_APPROVAL_SETTINGS.mcp,
  };
}

/** Build a provider adapter; secrets stay in SecretStorage and never post out. */
async function createProvider(context: vscode.ExtensionContext, connectionId: string): Promise<IProviderAdapter> {
  const preset = findProviderPreset(connectionId);
  if (!preset) throw new Error(`Unsupported provider: ${connectionId}`);
  const apiKey = await context.secrets.get(`${SECRET_PREFIX}${connectionId}`);
  return preset.kind === 'nvidia-nim'
    ? new NvidiaAdapter({ apiKey, baseUrl: preset.baseUrl })
    : new OpenAICompatibleAdapter({ apiKey, baseUrl: preset.baseUrl, providerId: preset.id, providerName: preset.label });
}

class ChatViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private host: AgentHost | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const folder = vscode.workspace.workspaceFolders?.[0];
    this.host = createAgentHost({
      workspaceRoot: folder?.uri.fsPath ?? process.cwd(),
      createTools: () => createDefaultToolRegistry(),
      createProvider: (connectionId) => createProvider(this.context, connectionId),
      onEvent: (envelope) => this.post({ type: 'event', event: envelope.event }),
      onApproval: (request) => this.post({ type: 'approval', request }),
    });
    for (const [category, enabled] of Object.entries(readApprovals(this.context.workspaceState))) {
      void this.host.handle({ protocolVersion: 1, requestId: `restore-${category}`, type: 'update_settings', category, enabled });
    }

    view.webview.onDidReceiveMessage((message: { type?: string }) => {
      void this.onMessage(message);
    });
    // Losing the view must abort the turn and deny anything still pending.
    view.onDidDispose(() => {
      this.host?.dispose();
      this.host = undefined;
      this.view = undefined;
    });
  }

  private async onMessage(message: { type?: string; category?: string; enabled?: boolean }): Promise<void> {
    const host = this.host;
    if (!host) return;
    if (message?.type === 'ready') {
      this.post({ type: 'state', state: { approvals: host.getApprovalSettings() } });
      return;
    }
    const response = await host.handle(message);
    this.post(response);
    // Each workspace keeps its own choices; the host already applied them.
    if (response.ok && message?.type === 'update_settings') {
      await this.context.workspaceState.update(APPROVALS_KEY, host.getApprovalSettings());
    }
  }

  post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ChatViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('moderado.chat', provider),
    vscode.commands.registerCommand('moderado.newSession', () => provider.post({ type: 'state', state: { newSession: true } })),
    vscode.commands.registerCommand('moderado.openSettings', () => provider.post({ type: 'state', state: { view: 'settings' } })),
  );
}

export function deactivate(): void {
  // The registered provider disposes its host when the view closes.
}

