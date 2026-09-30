import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * A minimal stand-in for the `vscode` module.
 *
 * It records what the extension registers and posts, so the packaged bundle can
 * be activated offline. It is not a real extension host: anything depending on
 * real VS Code behaviour still needs a real editor.
 */
/**
 * @param options.manifestPath where the packaged manifest lives on disk; About
 *   is built by reading it, so it must point at a real file.
 */
export function createVscodeStub(options: { manifestPath?: string } = {}) {
  const registered = { views: [] as { id: string; provider: any }[], commands: [] as string[] };
  const posted: any[] = [];
  const state = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  const webview = {
    options: undefined as { enableScripts?: boolean } | undefined,
    html: '',
    cspSource: 'vscode-resource:',
    asWebviewUri: (uri: any) => ({ toString: () => `vscode-resource:${uri.path ?? uri}` }),
    postMessage: async (message: unknown) => { posted.push(message); return true; },
    onDidReceiveMessage: (handler: (message: any) => unknown) => { webview.handler = handler; return { dispose() {} }; },
    handler: undefined as ((message: any) => unknown) | undefined,
  };
  const view = {
    webview,
    onDidDispose: (handler: () => void) => { view.disposeHandler = handler; return { dispose() {} }; },
    disposeHandler: undefined as (() => void) | undefined,
  };
  const extensionDir = options.manifestPath ? dirname(options.manifestPath) : '/ext';
  const extensionContext = {
    subscriptions: [] as { dispose(): void }[],
    extensionUri: { path: extensionDir, fsPath: extensionDir },
    extensionPath: extensionDir,
    workspaceState: {
      get: (key: string) => state.get(key),
      update: async (key: string, value: unknown) => { state.set(key, value); },
    },
    secrets: {
      get: async (key: string) => secrets.get(key),
      store: async (key: string, value: string) => { secrets.set(key, value); },
      delete: async (key: string) => { secrets.delete(key); },
    },
  };
  const vscode = {
    Uri: {
      joinPath: (base: any, ...parts: string[]) => ({ path: `${base.path}/${parts.join('/')}`, fsPath: `${base.path}/${parts.join('/')}` }),
      file: (fsPath: string) => ({ fsPath, path: fsPath }),
    },
    commands: {
      registerCommand: (id: string, _handler: unknown) => { registered.commands.push(id); return { dispose() {} }; },
    },
    window: {
      registerWebviewViewProvider: (id: string, provider: unknown) => {
        registered.views.push({ id, provider: provider as any });
        return { dispose() {} };
      },
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: process.cwd(), path: process.cwd() } }],
      onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
    },
  };
  return { vscode, extensionContext, view, webview, registered, posted, secrets, state };
}

/**
 * Evaluate the packaged bundle with `vscode` bound to the stub.
 *
 * `new Function` is used rather than `require` because the bundle's `vscode`
 * import is external and unresolvable outside a real editor.
 */
export async function loadExtensionBundle(bundlePath: string, stub: ReturnType<typeof createVscodeStub>) {
  const source = readFileSync(bundlePath, 'utf8');
  const module = { exports: {} as Record<string, unknown> };
  const factory = new Function('module', 'exports', 'require', 'vscode', source);
  factory(module, module.exports, (id: string) => {
    if (id === 'vscode') return stub.vscode;
    return createRequire(bundlePath)(id);
  }, stub.vscode);
  return module.exports;
}