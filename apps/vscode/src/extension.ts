import * as vscode from 'vscode';
import { SidecarClient, SidecarError } from './sidecar.js';
import type { HostEventEnvelope } from './protocol.js';

export interface ExtensionState {
  sidecar: SidecarClient | null;
  activeSessionId: string | null;
}

export class ModeradoChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'moderado.chatView';
  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    public readonly getSidecar: () => Promise<SidecarClient>,
    public readonly onEvent?: (envelope: HostEventEnvelope) => void,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  public getView(): vscode.WebviewView | undefined {
    return this.view;
  }

  private getHtmlForWebview(_webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Moderado</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 12px;
      margin: 0;
    }
    .placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      gap: 8px;
      padding: 24px 0;
    }
  </style>
</head>
<body>
  <div class="placeholder">
    <h3>Moderado Coding Assistant</h3>
    <p>Ready to start a task.</p>
  </div>
</body>
</html>`;
  }
}

let activeSidecar: SidecarClient | null = null;
let activeSessionId: string | null = null;

export async function getOrStartSidecar(workspaceRoot?: string, executablePathOverride?: string): Promise<SidecarClient> {
  if (activeSidecar && !activeSidecar.isClosed()) {
    return activeSidecar;
  }

  const root = workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    throw new SidecarError('Please open a workspace folder to use Moderado.', 'WORKSPACE_DENIED');
  }

  const executablePath =
    executablePathOverride ??
    vscode.workspace.getConfiguration('moderado').get<string>('executablePath')?.trim();

  const client = new SidecarClient({
    workspaceRoot: root,
    executablePath: executablePath || undefined,
    onError: (err) => {
      vscode.window.showErrorMessage(err.message);
    },
    onExit: (code) => {
      if (code !== 0 && code !== null) {
        vscode.window.showWarningMessage(`Moderado sidecar exited with code ${code}`);
      }
    },
  });

  client.start();
  const initResult = await client.initialize();
  activeSessionId = initResult.sessionId;
  activeSidecar = client;
  return client;
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ModeradoChatViewProvider(context.extensionUri, () => getOrStartSidecar());

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ModeradoChatViewProvider.viewType, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('moderado.focusChat', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.moderado-sidebar');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('moderado.newSession', async () => {
      try {
        const sidecar = await getOrStartSidecar();
        const result = await sidecar.request<{ sessionId: string }>('session.new', {});
        activeSessionId = result.sessionId;
        vscode.window.showInformationMessage(`Started new Moderado session: ${result.sessionId.slice(0, 8)}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to create new session: ${err.message}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('moderado.resumeSession', async (targetSessionId?: string) => {
      try {
        const sidecar = await getOrStartSidecar();
        if (!targetSessionId) {
          vscode.window.showInformationMessage('No session ID specified to resume.');
          return;
        }
        const result = await sidecar.request<{ sessionId: string }>('session.resume', {
          sessionId: targetSessionId,
        });
        activeSessionId = result.sessionId;
        vscode.window.showInformationMessage(`Resumed Moderado session: ${result.sessionId.slice(0, 8)}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to resume session: ${err.message}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('moderado.cancelTurn', async () => {
      try {
        if (!activeSidecar || activeSidecar.isClosed() || !activeSessionId) {
          return;
        }
        await activeSidecar.request('chat.cancel', { sessionId: activeSessionId });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to cancel turn: ${err.message}`);
      }
    }),
  );
}

export async function deactivate(): Promise<void> {
  if (activeSidecar) {
    const client = activeSidecar;
    activeSidecar = null;
    activeSessionId = null;
    await client.close();
  }
}
