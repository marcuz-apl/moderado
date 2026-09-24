import * as vscode from 'vscode';
import { SidecarClient, SidecarError } from './sidecar.js';
import { ModeradoWebviewPanel } from './webview/panel.js';

let activeSidecar: SidecarClient | null = null;
let activeSessionId: string | null = null;

export async function getOrStartSidecar(
  panel?: ModeradoWebviewPanel,
  workspaceRoot?: string,
  executablePathOverride?: string,
): Promise<SidecarClient> {
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
    onEvent: (envelope) => {
      panel?.handleHostEvent(envelope);
    },
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
  let panel: ModeradoWebviewPanel | undefined;
  panel = new ModeradoWebviewPanel(context.extensionUri, () => getOrStartSidecar(panel));

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ModeradoWebviewPanel.viewType, panel, {
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
        const sidecar = await getOrStartSidecar(panel);
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
        const sidecar = await getOrStartSidecar(panel);
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
