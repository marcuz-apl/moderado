declare module 'vscode' {
  export interface Disposable {
    dispose(): any;
  }

  export class Uri {
    static file(path: string): Uri;
    static joinPath(base: Uri, ...pathSegments: string[]): Uri;
    static parse(value: string, strict?: boolean): Uri;
    readonly scheme: string;
    readonly authority: string;
    readonly path: string;
    readonly query: string;
    readonly fragment: string;
    readonly fsPath: string;
    with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri;
    toString(skipEncoding?: boolean): string;
    toJSON(): any;
  }

  export interface CancellationToken {
    readonly isCancellationRequested: boolean;
    readonly onCancellationRequested: Event<any>;
  }

  export interface Event<T> {
    (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]): Disposable;
  }

  export interface WebviewOptions {
    readonly enableScripts?: boolean;
    readonly enableForms?: boolean;
    readonly enableCommandUris?: boolean | readonly string[];
    readonly localResourceRoots?: readonly Uri[];
    readonly portMapping?: readonly any[];
  }

  export interface Webview {
    options: WebviewOptions;
    html: string;
    readonly onDidReceiveMessage: Event<any>;
    postMessage(message: any): Thenable<boolean>;
    asWebviewUri(localResource: Uri): Uri;
    readonly cspSource: string;
  }

  export interface WebviewViewResolveContext<T = unknown> {
    readonly state?: T;
  }

  export interface WebviewView {
    readonly viewType: string;
    readonly webview: Webview;
    readonly onDidChangeVisibility: Event<void>;
    readonly visible: boolean;
    readonly onDidDispose: Event<void>;
    title?: string;
    description?: string;
    badge?: { readonly tooltip: string; readonly value: number };
    show?(preserveFocus?: boolean): void;
  }

  export interface WebviewViewProvider {
    resolveWebviewView(
      webviewView: WebviewView,
      context: WebviewViewResolveContext,
      token: CancellationToken,
    ): Thenable<void> | void;
  }

  export interface WorkspaceFolder {
    readonly uri: Uri;
    readonly name: string;
    readonly index: number;
  }

  export interface WorkspaceConfiguration {
    get<T>(section: string): T | undefined;
    get<T>(section: string, defaultValue: T): T;
    has(section: string): boolean;
    inspect<T>(section: string): { key: string; defaultValue?: T; globalValue?: T; workspaceValue?: T } | undefined;
    update(section: string, value: any, configurationTarget?: boolean | number): Thenable<void>;
  }

  export interface Position {
    readonly line: number;
    readonly character: number;
  }

  export interface Range {
    readonly start: Position;
    readonly end: Position;
    readonly isEmpty: boolean;
    readonly isSingleLine: boolean;
  }

  export interface Selection extends Range {
    readonly anchor: Position;
    readonly active: Position;
    readonly isReversed: boolean;
  }

  export interface TextDocument {
    readonly uri: Uri;
    readonly fileName: string;
    readonly isUntitled: boolean;
    readonly languageId: string;
    readonly version: number;
    readonly isDirty: boolean;
    getText(range?: Range): string;
  }

  export interface TextEditor {
    readonly document: TextDocument;
    readonly selection: Selection;
    readonly selections: readonly Selection[];
  }

  export interface ExtensionContext {
    readonly subscriptions: { dispose(): any }[];
    readonly extensionUri: Uri;
    readonly extensionPath: string;
    readonly storageUri?: Uri;
    readonly globalStorageUri: Uri;
    readonly logUri: Uri;
  }

  export namespace commands {
    export function registerCommand(command: string, callback: (...args: any[]) => any, thisArgs?: any): Disposable;
    export function executeCommand<T = unknown>(command: string, ...rest: any[]): Thenable<T>;
  }

  export namespace window {
    export function registerWebviewViewProvider(
      viewId: string,
      provider: WebviewViewProvider,
      options?: { readonly webviewOptions?: { readonly retainContextWhenHidden?: boolean } },
    ): Disposable;
    export function showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    export function showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    export function showErrorMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    export let activeTextEditor: TextEditor | undefined;
  }

  export namespace workspace {
    export let workspaceFolders: readonly WorkspaceFolder[] | undefined;
    export function getConfiguration(section?: string, scope?: any): WorkspaceConfiguration;
    export function asRelativePath(pathOrUri: string | Uri, includeWorkspaceFolder?: boolean): string;
  }
}
