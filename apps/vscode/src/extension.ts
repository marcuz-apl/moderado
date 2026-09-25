import * as vscode from 'vscode';
import { SidecarClient, SidecarError } from './sidecar.js';
import { ModeradoWebviewPanel } from './webview/panel.js';

let activeSidecar: SidecarClient | null = null;
let activeSessionId: string | null = null;

export async function getOrStartSidecar(
  panel?: ModeradoWebviewPanel,
  workspaceRoot?: string,
  executablePathOverride?: string,
  extensionPath?: string,
): Promise<SidecarClient> {
  if (activeSidecar && !activeSidecar.isClosed()) {
    return activeSidecar;
  }

  const root = workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    throw new SidecarError('Please open a workspace folder to use Moderado.', 'WORKSPACE_DENIED');
  }

  const config = vscode.workspace.getConfiguration('moderado');
  const executablePath =
    executablePathOverride ?? config.get<string>('executablePath')?.trim();
  const provider = config.get<string>('provider')?.trim();
  const model = config.get<string>('model')?.trim();

  const client = new SidecarClient({
    workspaceRoot: root,
    extensionPath,
    executablePath: executablePath || undefined,
    provider: provider || undefined,
    model: model || undefined,
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
  panel?.setSessionId(initResult.sessionId);
  return client;
}

export function activate(context: vscode.ExtensionContext): void {
  let panel: ModeradoWebviewPanel | undefined;
  panel = new ModeradoWebviewPanel(context.extensionUri, () =>
    getOrStartSidecar(panel, undefined, undefined, context.extensionPath),
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ModeradoWebviewPanel.viewType, panel),

  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (
        event.affectsConfiguration('moderado.provider') ||
        event.affectsConfiguration('moderado.model') ||
        event.affectsConfiguration('moderado.executablePath')
      ) {
        if (activeSidecar && !activeSidecar.isClosed()) {
          const old = activeSidecar;
          activeSidecar = null;
          await old.close();
          vscode.window.showInformationMessage('Moderado settings changed; sidecar reloaded.');
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('moderado.selectProvider', async () => {
      const config = vscode.workspace.getConfiguration('moderado');
      const current = config.get<string>('provider') || '(Default / CLI active)';
      const options = [
        { label: 'nvidia-nim', description: 'NVIDIA NIM (Nemotron, LLaMA, DeepSeek, Kimi)' },
        { label: 'openrouter', description: 'OpenRouter (Qwen, DeepSeek, Mistral, LLaMA)' },
        { label: 'agnes-ai', description: 'Agnes AI (Agnes Flash, Code)' },
        { label: 'orcarouter', description: 'OrcaRouter' },
        { label: '(Default / CLI active)', description: 'Use active connection from ~/.moderado/config.json' },
        { label: 'Custom...', description: 'Enter a custom provider connection ID' },
      ];

      const picked = await vscode.window.showQuickPick(options, {
        placeHolder: `Current provider: ${current}. Select provider to use:`,
      });

      if (!picked) return;

      let value = picked.label;
      if (value === '(Default / CLI active)') {
        value = '';
      } else if (value === 'Custom...') {
        const input = await vscode.window.showInputBox({
          prompt: 'Enter provider connection ID',
          placeHolder: 'e.g. nvidia-nim, openrouter, custom-id',
        });
        if (input === undefined) return;
        value = input.trim();
      }

      await config.update('provider', value, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Moderado provider set to: ${value || 'Default (CLI active)'}`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('moderado.selectModel', async () => {
      const config = vscode.workspace.getConfiguration('moderado');
      const current = config.get<string>('model') || '(Auto: Free-First)';
      const options = [
        { label: '(Auto: Free-First)', description: 'Free-first automatic model routing' },
        { label: 'z-ai/glm-5.3-flash', description: 'NVIDIA NIM free trial fast coding model' },
        { label: 'qwen/qwen3.8-27b:free', description: 'OpenRouter free high-capability coding model' },
        { label: 'meta/llama-3.1-8b-instruct', description: 'NVIDIA NIM free trial lightweight model' },
        { label: 'nvidia/llama-3.1-nemotron-70b-instruct', description: 'NVIDIA NIM high-intelligence model' },
        { label: 'Custom...', description: 'Enter a custom model ID' },
      ];

      const picked = await vscode.window.showQuickPick(options, {
        placeHolder: `Current model: ${current}. Select model to use:`,
      });

      if (!picked) return;

      let value = picked.label;
      if (value === '(Auto: Free-First)') {
        value = '';
      } else if (value === 'Custom...') {
        const input = await vscode.window.showInputBox({
          prompt: 'Enter model identifier',
          placeHolder: 'e.g. z-ai/glm-5.3-flash, qwen/qwen3.8-27b:free',
        });
        if (input === undefined) return;
        value = input.trim();
      }

      await config.update('model', value, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Moderado model set to: ${value || 'Auto (Free-First)'}`);
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
        const sidecar = await getOrStartSidecar(panel, undefined, undefined, context.extensionPath);
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
        const sidecar = await getOrStartSidecar(panel, undefined, undefined, context.extensionPath);
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
