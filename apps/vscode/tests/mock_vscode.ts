import path from 'node:path';

export class Uri {
  public readonly fsPath: string;
  public readonly path: string;
  public readonly scheme: string;

  constructor(filePath: string, scheme = 'file') {
    this.fsPath = filePath;
    this.path = filePath.replace(/\\/g, '/');
    this.scheme = scheme;
  }

  static file(filePath: string): Uri {
    return new Uri(filePath, 'file');
  }

  static joinPath(base: Uri, ...pathSegments: string[]): Uri {
    return new Uri(path.join(base.fsPath, ...pathSegments), base.scheme);
  }

  static parse(value: string): Uri {
    return new Uri(value, 'file');
  }
}

export const window = {
  registerWebviewViewProvider: () => ({ dispose: () => {} }),
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  activeTextEditor: undefined,
};

export const workspace = {
  workspaceFolders: undefined as any,
  getConfiguration: () => ({
    get: () => undefined,
    has: () => false,
    inspect: () => undefined,
    update: async () => {},
  }),
  asRelativePath: (pathOrUri: string | Uri) => {
    const raw = typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.fsPath;
    return raw.replace(/\\/g, '/');
  },
};

export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: async () => undefined,
};

export class Disposable {
  constructor(private readonly callOnDispose: () => any) {}
  dispose() {
    this.callOnDispose();
  }
}
