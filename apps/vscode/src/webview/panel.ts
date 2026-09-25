import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { SidecarClient } from '../sidecar.js';
import {
  WebviewToHostMessageSchema,
  type WebviewToHostMessage,
} from './messages.js';
import {
  initialTranscriptState,
  applyHostEvent,
  type TranscriptState,
} from './transcript.js';
import type { HostEventEnvelope, HostChatSelectionContext } from '../protocol.js';

export class ModeradoWebviewPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'moderado.chatView';
  private view?: vscode.WebviewView;
  private state: TranscriptState;
  private sidecarUnavailable = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly getSidecar: () => Promise<SidecarClient>,
  ) {
    this.state = initialTranscriptState();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken,
  ): void {
    if (token.isCancellationRequested) {
      return;
    }
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (raw: unknown) => {
      await this.handleWebviewMessage(raw);
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });

    // Send current state
    this.postMessageToWebview({ type: 'state', state: this.state });
  }

  public handleHostEvent(envelope: HostEventEnvelope): void {
    this.state = applyHostEvent(this.state, envelope);
    this.postMessageToWebview({ type: 'state', state: this.state });
  }

  public setSessionId(sessionId: string): void {
    this.state = {
      ...this.state,
      sessionId,
    };
    this.postMessageToWebview({ type: 'state', state: this.state });
  }

  public getState(): TranscriptState {
    return this.state;
  }

  /**
   * Show the persistent "CLI missing" state. Used instead of a transient toast so
   * a user with no sidecar sees a way forward rather than a dead composer.
   */
  public setSidecarUnavailable(message: string, attemptedExecutable?: string): void {
    this.sidecarUnavailable = true;
    this.postMessageToWebview({
      type: 'sidecarUnavailable',
      message,
      attemptedExecutable,
      canRetry: true,
    });
  }

  public setSidecarReady(): void {
    if (!this.sidecarUnavailable) return;
    this.sidecarUnavailable = false;
    this.postMessageToWebview({ type: 'sidecarReady' });
  }

  /** True while the panel is showing the "Moderado unavailable" state. */
  public isUnavailable(): boolean {
    return this.sidecarUnavailable;
  }

  /** Update the composer's provider/model status line. Ids and labels only. */
  public postModelStatus(status: {
    providerId?: string;
    providerLabel?: string;
    modelId?: string;
    needsApiKey?: boolean;
  }): void {
    this.postMessageToWebview({ type: 'modelStatus', ...status });
  }

  private async handleWebviewMessage(raw: unknown): Promise<void> {
    const validated = WebviewToHostMessageSchema.safeParse(raw);
    if (!validated.success) {
      this.postMessageToWebview({
        type: 'error',
        message: `Invalid message from webview: ${validated.error.message}`,
      });
      return;
    }

    const msg: WebviewToHostMessage = validated.data;

    // Retry must not await the sidecar first: acquiring it is exactly what failed.
    if (msg.type === 'retrySidecar') {
      try {
        const retried = await this.getSidecar();
        await retried.initialize().catch(() => undefined);
        this.setSidecarReady();
        this.postMessageToWebview({ type: 'state', state: this.state });
      } catch (err: any) {
        this.setSidecarUnavailable(err?.message || String(err));
      }
      return;
    }

    try {
      const sidecar = await this.getSidecar();

      switch (msg.type) {
        case 'send': {
          const sessionId = this.state.sessionId;
          if (!sessionId) {
            throw new Error('No active session available');
          }

          // Register turn in local state for immediate responsiveness
          if (!this.state.currentTurn) {
            this.state = {
              ...this.state,
              currentTurn: {
                id: `turn-${Date.now()}`,
                userPrompt: msg.text,
                assistantText: '',
                tools: [],
                approvals: [],
                status: 'running',
                timestamp: Date.now(),
              },
              status: 'busy',
            };
            this.postMessageToWebview({ type: 'state', state: this.state });
          }

          await sidecar.request('chat.send', {
            sessionId,
            text: msg.text,
            context: msg.context,
          });
          break;
        }

        case 'cancel': {
          const sessionId = this.state.sessionId;
          if (sessionId) {
            await sidecar.request('chat.cancel', { sessionId });
          }
          break;
        }

        case 'newSession': {
          const currentId = this.state.sessionId || randomBytes(16).toString('hex');
          const result = await sidecar.request<{ sessionId: string }>('session.new', {
            sessionId: currentId,
          });
          this.state = initialTranscriptState(result.sessionId);
          this.postMessageToWebview({ type: 'state', state: this.state });
          break;
        }

        case 'resumeSession': {
          const currentId = this.state.sessionId || msg.sessionId;
          const result = await sidecar.request<{ sessionId: string }>('session.resume', {
            sessionId: currentId,
            targetSessionId: msg.sessionId,
          });
          this.state = initialTranscriptState(result.sessionId);
          this.postMessageToWebview({ type: 'state', state: this.state });
          break;
        }

        case 'approve': {
          const sessionId = this.state.sessionId;
          if (sessionId) {
            await sidecar.request('approval.respond', {
              sessionId,
              requestId: msg.requestId,
              status: 'approved',
            });
          }
          break;
        }

        case 'reject': {
          const sessionId = this.state.sessionId;
          if (sessionId) {
            await sidecar.request('approval.respond', {
              sessionId,
              requestId: msg.requestId,
              status: 'denied',
              reason: msg.reason,
            });
          }
          break;
        }

        case 'attachSelection': {
          const ctx = this.getActiveEditorContext();
          this.postMessageToWebview({
            type: 'activeEditorContext',
            context: ctx,
          });
          break;
        }

        case 'attachFile': {
          // A file picked here is passed as an @mention so the host expands it
          // through the same jail-checked path as typed mentions.
          const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Attach to Moderado',
          });
          const uri = picked?.[0];
          if (!uri) break;
          const relPath = vscode.workspace.asRelativePath(uri, false);
          if (!relPath || relPath.startsWith('/') || relPath.startsWith('\\') || relPath.includes('..')) {
            this.postMessageToWebview({
              type: 'error',
              message: 'Only files inside the workspace can be attached.',
            });
            break;
          }
          this.postMessageToWebview({ type: 'appendComposerText', text: `@${relPath.replace(/\\/g, '/')} ` });
          break;
        }

        case 'selectModel': {
          await vscode.commands.executeCommand('moderado.selectModel');
          break;
        }

        case 'selectProvider': {
          await vscode.commands.executeCommand('moderado.selectProvider');
          break;
        }
      }
    } catch (err: any) {
      // A missing sidecar is a persistent condition, not a transient message.
      if (err?.code === 'NOT_FOUND' || err?.code === 'ENOENT') {
        this.setSidecarUnavailable(err?.message || String(err));
        return;
      }
      this.postMessageToWebview({
        type: 'error',
        message: err?.message || String(err),
      });
    }
  }

  private getActiveEditorContext(): HostChatSelectionContext | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;

    const doc = editor.document;
    const relPath = vscode.workspace.asRelativePath(doc.uri, false);
    if (!relPath || relPath.startsWith('/') || relPath.startsWith('\\') || relPath.includes('..')) {
      return undefined;
    }

    const selection = editor.selection;
    const startLine = selection.start.line + 1; // 1-indexed
    const endLine = selection.end.line + 1;
    const text = selection.isEmpty ? undefined : doc.getText(selection).slice(0, 20_000);

    return {
      relativePath: relPath.replace(/\\/g, '/'),
      startLine,
      endLine: Math.max(startLine, endLine),
      text,
    };
  }

  private postMessageToWebview(message: any): void {
    if (this.view) {
      this.view.webview.postMessage(message);
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Moderado</title>
  <link rel="stylesheet" href="${stylesUri}">
</head>
<body>
  <header class="task-header" id="task-header">
    <div class="header-title">
      <span>Moderado</span>
      <span class="status-badge" id="status-badge">Idle</span>
    </div>
    <div class="header-actions">
      <button class="icon-btn" id="select-model-btn" title="Model &amp; Provider Settings" aria-label="Model &amp; Provider Settings">⚙️</button>
      <button class="icon-btn" id="new-task-btn" title="New Session" aria-label="New Session">+</button>
    </div>
  </header>

  <main class="transcript-container" id="transcript-container" role="log" aria-live="polite">
    <div class="turn-block" id="empty-state">
      <div class="assistant-bubble">
        <p><strong>Welcome to Moderado.</strong></p>
        <p>Ask a question, describe a change, or attach editor context to begin.</p>
      </div>
    </div>
  </main>

  <div class="sidecar-banner" id="sidecar-banner" style="display: none;" role="alert">
    <div class="sidecar-banner-body">
      <p class="sidecar-banner-title">Moderado is unavailable</p>
      <p class="sidecar-banner-message" id="sidecar-banner-message"></p>
      <p class="sidecar-banner-hint">
        Install the CLI, or set <code>moderado.executablePath</code> in Settings.
      </p>
    </div>
    <div class="sidecar-banner-actions">
      <button class="btn btn-secondary" id="sidecar-retry-btn">Retry</button>
    </div>
  </div>

  <footer class="composer-section" id="composer-section">
    <div class="composer-status" id="composer-status">
      <button class="composer-status-item" id="status-provider-btn" title="Change provider">No provider connected</button>
      <button class="composer-status-item" id="status-model-btn" title="Change model">Auto (Free-First)</button>
    </div>

    <div id="context-chip-container" style="display: none;">
      <span class="context-chip" id="context-chip">
        <span id="context-chip-label">src/index.ts:1-10</span>
        <span class="chip-remove" id="context-chip-remove" title="Remove attachment" role="button" tabindex="0">×</span>
      </span>
    </div>

    <div class="composer-input-box">
      <textarea
        class="composer-textarea"
        id="composer-input"
        placeholder="Type a task or instruction... (Enter to send, Shift+Enter for newline)"
        rows="2"
        aria-label="Task prompt"
      ></textarea>
      <div class="composer-footer">
        <div class="composer-tools">
          <button class="icon-btn" id="attach-file-btn" title="Attach Workspace File" aria-label="Attach File">📄</button>
          <button class="icon-btn" id="attach-selection-btn" title="Attach Active Editor Selection" aria-label="Attach Selection">📎</button>
        </div>
        <div class="composer-actions">
          <button class="btn btn-secondary" id="cancel-btn" style="display: none;">Cancel</button>
          <button class="btn btn-primary" id="send-btn">Send</button>
        </div>
      </div>
    </div>
  </footer>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
