import * as vscode from 'vscode';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createDefaultToolRegistry } from '@moderado/tools';
import type { HostEventEnvelope, IProviderAdapter } from '@moderado/contracts';
import { findProviderPreset, NvidiaAdapter, OpenAICompatibleAdapter } from '@moderado/providers';
import { createAgentHost, type AgentHost } from './agent_host.js';
import { buildAbout } from './about.js';
import { renderWebviewHtml } from './webview_html.js';
import { createTranscript, type Transcript } from './transcript.js';
import { DEFAULT_APPROVAL_SETTINGS, type ApprovalSettings } from './approval_handler.js';

const APPROVALS_KEY = 'moderado.approvals';
const SECRET_PREFIX = 'moderado.apiKey.';
const PROVIDER_KEY = 'moderado.provider';
const MODEL_KEY = 'moderado.model';

/**
 * Read the packaged manifest so the About page shows the installed VSIX's own
 * version. `context.extensionPath` is the extension root inside the VSIX.
 */
function readManifest(context: vscode.ExtensionContext): Record<string, unknown> {
  const manifestPath = vscode.Uri.joinPath(context.extensionUri, 'package.json');
  return JSON.parse(fs.readFileSync(manifestPath.fsPath, 'utf8')) as Record<string, unknown>;
}

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

/**
 * The webview is presentation only. A nonce plus a strict CSP keeps injected
 * markup from running: no inline script, no remote origins, no eval.
 */
function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const asset = (file: string): string =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', file)).toString();
  return renderWebviewHtml({
    cspSource: webview.cspSource,
    nonce: crypto.randomUUID().replace(/-/g, ''),
    asset,
  });
}

class ChatViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private host: AgentHost | undefined;
  private transcript: Transcript | undefined;
  /** Set by `ready` so a view that reopens lands on a session the host knows. */
  private sessionId: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
    view.webview.html = webviewHtml(view.webview, this.context.extensionUri);
    const folder = vscode.workspace.workspaceFolders?.[0];
    const transcript = createTranscript(this.sessionId ?? 'pending');
    this.transcript = transcript;
    this.host = createAgentHost({
      workspaceRoot: folder?.uri.fsPath ?? process.cwd(),
      createTools: () => createDefaultToolRegistry(),
      createProvider: (connectionId) => createProvider(this.context, connectionId),
      onEvent: (envelope) => this.onAgentEvent(transcript, envelope),
      onApproval: (request) => this.post({ type: 'approval', request }),
      // Keys go to SecretStorage and are never read back into a message.
      // VS Code returns a Thenable, so wrap it to satisfy the Promise contract.
      credentials: {
        get: async (providerId) => this.context.secrets.get(`${SECRET_PREFIX}${providerId}`),
        set: async (providerId, apiKey) => { await this.context.secrets.store(`${SECRET_PREFIX}${providerId}`, apiKey); },
        delete: async (providerId) => { await this.context.secrets.delete(`${SECRET_PREFIX}${providerId}`); },
      },
      hasCredential: async (providerId) => Boolean(await this.context.secrets.get(`${SECRET_PREFIX}${providerId}`)),
      about: () => buildAbout(readManifest(this.context)),
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

  /** Reduce an agent event into view state and push it; the host stays authoritative. */
  private onAgentEvent(transcript: Transcript, envelope: HostEventEnvelope): void {
    transcript.apply(envelope);
    this.post({ type: 'state', state: transcript.snapshot() });
  }

  private async onMessage(message: { type?: string; sessionId?: string; prompt?: string; category?: string; enabled?: boolean; providerId?: string; modelId?: string }): Promise<void> {
    const host = this.host;
    if (!host) return;
    if (message?.type === 'ready') {
      // The webview needs a session the host already knows, or start_turn fails.
      this.sessionId = host.newSession();
      this.transcript?.reset(this.sessionId);
      await this.sendInitialState(host);
      return;
    }
    if (message?.type === 'new_session') {
      // Sessions are minted by the host; the webview never invents an id.
      this.sessionId = host.newSession();
      this.transcript?.reset(this.sessionId);
      this.post({ type: 'state', state: this.transcript?.snapshot() });
      return;
    }
    if (message?.type === 'resume_session' && typeof message.sessionId === 'string') {
      const response = await host.handle(message);
      if (response.ok) {
        // The host confirms the switch; adopt its session and clear the timeline.
        this.sessionId = message.sessionId;
        this.transcript?.reset(message.sessionId);
        this.post({ type: 'state', state: this.transcript?.snapshot() });
        return;
      }
      this.post(response);
      return;
    }
    if (message?.type === 'start_turn' && typeof message.prompt === 'string' && message.sessionId === this.sessionId) {
      this.transcript?.beginTurn(message.prompt);
      this.post({ type: 'state', state: this.transcript?.snapshot() });
    }
    const response = await host.handle(message);
    this.post(response);
    // Each workspace keeps its own choices; the host already applied them.
    if (response.ok && message?.type === 'update_settings') {
      await this.context.workspaceState.update(APPROVALS_KEY, host.getApprovalSettings());
    }
    if (response.ok && message?.type === 'select_provider' && message.providerId) {
      await this.context.workspaceState.update(PROVIDER_KEY, message.providerId);
    }
    if (response.ok && message?.type === 'select_model' && message.modelId) {
      await this.context.workspaceState.update(MODEL_KEY, message.modelId);
    }
  }

  /** Everything the settings pages need on first paint, in one message. */
  private async sendInitialState(host: AgentHost): Promise<void> {
    const request = (type: string): Record<string, unknown> => ({ protocolVersion: 1, requestId: `init-${type}`, type });
    const [providers, about, sessions] = await Promise.all([
      host.handle(request('list_providers')),
      host.handle(request('get_about')),
      host.handle(request('list_sessions')),
    ]);
    const state: Record<string, unknown> = {
      ...this.transcript?.snapshot(),
      approvals: host.getApprovalSettings(),
      providerId: this.context.workspaceState.get<string>(PROVIDER_KEY) ?? '',
      modelId: this.context.workspaceState.get<string>(MODEL_KEY) ?? '',
    };
    if (providers.ok && providers.result.type === 'providers') state.providers = providers.result.providers;
    if (about.ok && about.result.type === 'about') state.about = about.result;
    if (sessions.ok && sessions.result.type === 'sessions') state.recentSessions = sessions.result.sessions;
    this.post({ type: 'state', state });
  }

  /** Mint a session on the host and tell the view to start clean. */
  newSession(): void {
    this.post({ type: 'new_session' });
  }

  post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ChatViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('moderado.chat', provider),
    vscode.commands.registerCommand('moderado.newSession', () => provider.newSession()),
    vscode.commands.registerCommand('moderado.openSettings', () => provider.post({ type: 'state', state: { view: 'settings' } })),
  );
}

export function deactivate(): void {
  // The registered provider disposes its host when the view closes.
}

