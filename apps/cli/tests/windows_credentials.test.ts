import { describe, expect, it } from 'vitest';
import { WindowsCredentialStore } from '../src/windows_credentials.js';

describe('WindowsCredentialStore', () => {
  it('passes a secret only through standard input to a fixed PowerShell bridge', async () => {
    const calls: { file: string; args: string[]; input: string }[] = [];
    const store = new WindowsCredentialStore(async (file, args, input) => {
      calls.push({ file, args, input });
      return { stdout: '{"ok":true}', stderr: '' };
    });

    await store.set('moderado/provider/openrouter', 'sk-secret');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe('powershell.exe');
    expect(calls[0]?.args).toContain('-EncodedCommand');
    expect(calls[0]?.args.join(' ')).not.toContain('sk-secret');
    expect(calls[0]?.input).toContain('sk-secret');
  });

  it('redacts bridge errors that echo a secret', async () => {
    const store = new WindowsCredentialStore(async () => ({ stdout: '', stderr: 'Credential failed: sk-secret' }));
    await expect(store.set('moderado/provider/openrouter', 'sk-secret')).rejects.toThrow('Windows Credential Manager operation failed');
    await expect(store.set('moderado/provider/openrouter', 'sk-secret')).rejects.not.toThrow('sk-secret');
  });
});
