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

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly getSidecar: () => Promise<SidecarClient>,
  ) {
    this.state = initialTranscriptState();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
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

  public getState(): TranscriptState {
    return this.state;
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
          const result = await sidecar.request<{ sessionId: string }>('session.new', {});
          this.state = initialTranscriptState(result.sessionId);
          this.postMessageToWebview({ type: 'state', state: this.state });
          break;
        }

        case 'resumeSession': {
          const result = await sidecar.request<{ sessionId: string }>('session.resume', {
            sessionId: msg.sessionId,
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
      }
    } catch (err: any) {
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

  <footer class="composer-section" id="composer-section">
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
