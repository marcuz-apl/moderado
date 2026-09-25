import * as vscode from 'vscode';
import { SidecarClient, SidecarError } from './sidecar.js';
import { ModeradoWebviewPanel } from './webview/panel.js';
import type { ModelListResult, ProviderListResult } from './protocol.js';

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
  let initResult;
  try {
    initResult = await client.initialize();
  } catch (err) {
    // Leave the panel in a recoverable state instead of a dead composer.
    const anyErr = err as { message?: string; code?: string };
    if (anyErr?.code === 'NOT_FOUND' || anyErr?.code === 'PROTOCOL_MISMATCH') {
      panel?.setSidecarUnavailable(anyErr.message ?? 'Moderado could not start.');
    }
    await client.close().catch(() => {});
    throw err;
  }
  activeSessionId = initResult.sessionId;
  activeSidecar = client;
  panel?.setSidecarReady();
  panel?.setSessionId(initResult.sessionId);
  void publishModelStatus(panel, client);
  return client;
}

/**
 * Push the current provider/model to the composer's status line. Reports only
 * ids and labels, so no credential can reach the webview through this path.
 */
async function publishModelStatus(
  panel: ModeradoWebviewPanel | undefined,
  client: SidecarClient,
): Promise<void> {
  if (!panel) return;
  const config = vscode.workspace.getConfiguration('moderado');
  const modelId = config.get<string>('model')?.trim() || undefined;
  try {
    const listing = await client.request<ProviderListResult>('provider.list', {});
    const active = listing.providers.find((p) => p.isActive);
    panel.postModelStatus({
      providerId: listing.activeProviderId,
      providerLabel: active?.label,
      modelId,
      needsApiKey: !!active?.requiresApiKey && !active.hasApiKey,
    });
  } catch {
    // A status line is cosmetic; never fail a turn over it.
  }
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
        // Always drop the running sidecar so the next turn spawns with the new
        // --provider/--model, whether or not one is currently running.
        if (activeSidecar && !activeSidecar.isClosed()) {
          const old = activeSidecar;
          activeSidecar = null;
          await old.close().catch(() => {});
        }
        // The host owns provider activation, so ask it to re-activate the newly
        // configured provider (no key needed when one is already stored).
        if (panel && !panel.isUnavailable()) {
          try {
            const restarted = await getOrStartSidecar(
              panel,
              undefined,
              undefined,
              context.extensionPath,
            );
            void publishModelStatus(panel, restarted);
          } catch {
            // getOrStartSidecar already put the panel into its unavailable state.
          }
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('moderado.selectProvider', async () => {
      let client: SidecarClient;
      try {
        client = await getOrStartSidecar(panel, undefined, undefined, context.extensionPath);
      } catch (err: any) {
        vscode.window.showErrorMessage(err?.message ?? 'Could not start Moderado.');
        return;
      }

      let listing: ProviderListResult;
      try {
        listing = await client.request<ProviderListResult>('provider.list', {});
      } catch (err: any) {
        vscode.window.showErrorMessage(`Could not list providers: ${err?.message ?? err}`);
        return;
      }

      const options = listing.providers.map((provider) => {
        const bits: string[] = [];
        if (provider.isActive) bits.push('active');
        if (provider.requiresApiKey && !provider.hasApiKey) bits.push('API key required');
        else if (provider.requiresApiKey) bits.push('key saved');
        return {
          label: provider.id,
          description: provider.description,
          detail: bits.join(' · '),
          providerId: provider.id,
        };
      });
      options.push({
        label: 'Custom...',
        description: 'Enter a provider connection ID',
        detail: '',
        providerId: '',
      });

      const picked = await vscode.window.showQuickPick(options, {
        placeHolder: listing.activeProviderId
          ? `Current provider: ${listing.activeProviderId}. Select provider to use:`
          : 'No provider connected yet. Select one to continue:',
        matchOnDescription: true,
      });

      if (!picked) return;

      let providerId = picked.providerId;
      if (!providerId) {
        const input = await vscode.window.showInputBox({
          prompt: 'Enter provider connection ID',
          placeHolder: 'e.g. nvidia-nim, openrouter, custom-id',
        });
        if (input === undefined) return;
        providerId = input.trim();
      }
      if (!providerId) return;

      // Only prompt for a key the sidecar does not already hold. The key is sent
      // straight to the host and never stored in webview state or logs.
      const target = listing.providers.find((p) => p.id === providerId);
      let apiKey: string | undefined;
      if (target?.requiresApiKey && !target.hasApiKey) {
        const entered = await vscode.window.showInputBox({
          prompt: `API key for ${target.label}`,
          placeHolder: 'Paste your API key',
          password: true,
          ignoreFocusOut: true,
        });
        if (entered === undefined) return;
        if (!entered.trim()) {
          vscode.window.showErrorMessage('An API key is required for this provider.');
          return;
        }
        apiKey = entered.trim();
      }

      try {
        await client.request('provider.connect', { providerId, apiKey });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Could not connect to ${providerId}: ${err?.message ?? err}`);
        return;
      }

      const cfg = vscode.workspace.getConfiguration('moderado');
      await cfg.update('provider', providerId, vscode.ConfigurationTarget.Global);
      await publishModelStatus(panel, client);
      vscode.window.showInformationMessage(`Moderado provider set to: ${providerId}`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('moderado.selectModel', async () => {
      let client: SidecarClient;
      try {
        client = await getOrStartSidecar(panel, undefined, undefined, context.extensionPath);
      } catch (err: any) {
        vscode.window.showErrorMessage(err?.message ?? 'Could not start Moderado.');
        return;
      }

      let catalog: ModelListResult;
      try {
        catalog = await client.request<ModelListResult>('model.list', {});
      } catch (err: any) {
        // The most common cause is no provider yet; point at the real fix.
        vscode.window
          .showErrorMessage(`Could not list models: ${err?.message ?? err}`, 'Manage Providers')
          .then((choice: string | undefined) => {
            if (choice === 'Manage Providers') {
              vscode.commands.executeCommand('moderado.selectProvider');
            }
          });
        return;
      }

      const options: Array<{
        label: string;
        description?: string;
        detail?: string;
        modelId: string;
      }> = [
        {
          label: '(Auto: Free-First)',
          description: 'Free-first automatic model routing',
          detail: '',
          modelId: '',
        },
      ];
      // The host already sorts free-tier models first.
      for (const model of catalog.models) {
        options.push({
          label: model.id,
          description: model.ownedBy,
          detail: model.isFree ? 'free tier' : 'paid',
          modelId: model.id,
        });
      }
      // Always allow a custom model id; the catalog may be short or truncated.
      options.push({
        label: 'Custom...',
        description: catalog.truncated
          ? `Enter a model ID (list truncated at ${catalog.models.length} models)`
          : 'Enter a model ID',
        detail: '',
        modelId: '',
      });

      const picked = await vscode.window.showQuickPick(options, {
        placeHolder: `Models for ${catalog.providerId} — select to pin:`,
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (!picked) return;

      let modelId = picked.modelId;
      if (!modelId) {
        const input = await vscode.window.showInputBox({
          prompt: 'Enter model identifier',
          placeHolder: 'e.g. z-ai/glm-5.3-flash, qwen/qwen3.8-27b:free',
        });
        if (input === undefined) return;
        modelId = input.trim();
      }

      await vscode.workspace
        .getConfiguration('moderado')
        .update('model', modelId, vscode.ConfigurationTarget.Global);
      await publishModelStatus(panel, client);
      vscode.window.showInformationMessage(
        `Moderado model set to: ${modelId || 'Auto (Free-First)'}`,
      );
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
