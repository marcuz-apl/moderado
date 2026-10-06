import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getActiveConnection,
  getConfigPath,
  loadConfig,
  resolveApiKey,
  saveConfig,
  saveConnection,
  saveMcpServer,
  setMcpServerEnabled,
  removeMcpServer,
  migrateLegacyCredentials,
  requiresCredentialReference,
  resolveConnectionCredential,
  storeConnectionCredential,
} from '../src/config.js';
import { MemoryCredentialStore } from '../src/credentials.js';

describe('CLI Configuration Storage', () => {
  let tempDir: string;
  const origKey = process.env.NVIDIA_API_KEY;
  const origCloudEnv = process.env.MODERADO_CLOUD_ENV;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-config-test-'));
    delete process.env.NVIDIA_API_KEY;
    delete process.env.MODERADO_CLOUD_ENV;
  });

  afterEach(() => {
    if (origKey !== undefined) {
      process.env.NVIDIA_API_KEY = origKey;
    } else {
      delete process.env.NVIDIA_API_KEY;
    }
    if (origCloudEnv !== undefined) process.env.MODERADO_CLOUD_ENV = origCloudEnv;
    else delete process.env.MODERADO_CLOUD_ENV;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves correct config path under custom home', () => {
    const configPath = getConfigPath(tempDir);
    expect(configPath).toBe(path.join(tempDir, '.moderado', 'config.json'));
  });

  it('returns empty config when file does not exist', () => {
    const config = loadConfig(tempDir);
    expect(config).toEqual({});
  });

  it('loads configured provider choices and normalizes custom endpoints', () => {
    saveConfig({ connectProviders: { enabled: ['orcarouter'], custom: [{ id: 'gateway', name: ' Gateway ', baseUrl: 'https://gateway.example/v1/' }] } }, tempDir);
    expect(loadConfig(tempDir).connectProviders).toEqual({ enabled: ['orcarouter'], custom: [{ id: 'gateway', name: 'Gateway', baseUrl: 'https://gateway.example/v1' }] });
  });

  it('rejects custom endpoints with credentials, remote HTTP, or reserved ids', () => {
    for (const provider of [
      { id: 'gateway', name: 'Gateway', baseUrl: 'https://secret@gateway.example/v1' },
      { id: 'gateway', name: 'Gateway', baseUrl: 'http://gateway.example/v1' },
      { id: 'orcarouter', name: 'Gateway', baseUrl: 'https://gateway.example/v1' },
    ]) {
      saveConfig({ connectProviders: { custom: [provider] } }, tempDir);
      expect(loadConfig(tempDir).connectProviders).toBeUndefined();
    }
  });

  it('saves and loads configuration cleanly', () => {
    saveConfig({ apiKey: 'nvapi-test123', defaultModel: 'meta/llama-3.2-11b-vision-instruct' }, tempDir);
    const loaded = loadConfig(tempDir);
    expect(loaded.apiKey).toBe('nvapi-test123');
    expect(loaded.defaultModel).toBe('meta/llama-3.2-11b-vision-instruct');
  });

  it('prioritizes environment variable over config file', () => {
    saveConfig({ apiKey: 'nvapi-from-config' }, tempDir);
    process.env.NVIDIA_API_KEY = 'nvapi-from-env';

    const resolved = resolveApiKey(tempDir);
    expect(resolved).toBe('nvapi-from-env');
  });

  it('falls back to config file when env is missing', () => {
    saveConfig({ apiKey: 'nvapi-from-config' }, tempDir);
    const resolved = resolveApiKey(tempDir);
    expect(resolved).toBe('nvapi-from-config');
  });

  it('stores an active provider connection without losing existing settings', () => {
    saveConfig({ allowPaid: true, defaultModel: 'legacy-model' }, tempDir);
    saveConnection({
      id: 'openrouter',
      displayName: 'OpenRouter',
      kind: 'openai-compatible',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test',
      defaultModel: 'openrouter/free',
    }, tempDir);

    const loaded = loadConfig(tempDir);
    expect(loaded.allowPaid).toBe(true);
    expect(loaded.connections?.openrouter?.displayName).toBe('OpenRouter');
    expect(getActiveConnection(loaded)).toMatchObject({
      id: 'openrouter',
      kind: 'openai-compatible',
      defaultModel: 'openrouter/free',
    });
  });

  it('stores a Moderado Cloud key by credential reference and omits it from config', async () => {
    const store = new MemoryCredentialStore();
    const connection = await storeConnectionCredential({
      id: 'moderado-cloud', displayName: 'Moderado Cloud', kind: 'openai-compatible',
      baseUrl: 'https://mod.alfazen.org/v1', apiKey: 'mrd_test-secret', defaultModel: 'auto',
    }, store);
    saveConnection(connection, tempDir);
    const raw = fs.readFileSync(getConfigPath(tempDir), 'utf8');
    expect(raw).not.toContain('mrd_test-secret');
    expect(loadConfig(tempDir).connections?.['moderado-cloud']).toMatchObject({
      credentialReference: 'moderado/provider/moderado-cloud',
      defaultModel: 'auto',
    });
    expect(await store.get('moderado/provider/moderado-cloud')).toBe('mrd_test-secret');
  });

  it('infers a local Gateway from a saved loopback URL', () => {
    saveConnection({
      id: 'moderado-cloud', displayName: 'Moderado Cloud', kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:4788/v1', defaultModel: 'auto',
    }, tempDir);
    expect(loadConfig(tempDir).connections?.['moderado-cloud']?.baseUrl)
      .toBe('http://127.0.0.1:4788/v1');
  });

  it('preserves a remote HTTPS Gateway URL from the saved Cloud profile', () => {
    saveConnection({
      id: 'moderado-cloud', displayName: 'Moderado Cloud', kind: 'openai-compatible',
      baseUrl: 'https://moderado.example.net/v1/', defaultModel: 'auto',
    }, tempDir);
    expect(loadConfig(tempDir).connections?.['moderado-cloud']?.baseUrl)
      .toBe('https://moderado.example.net/v1');
  });

  it('loads the local Gateway URL for saved Cloud profiles in development mode', () => {
    process.env.MODERADO_CLOUD_ENV = 'development';
    saveConnection({
      id: 'moderado-cloud', displayName: 'Moderado Cloud', kind: 'openai-compatible',
      baseUrl: 'https://mod.alfazen.org/v1', defaultModel: 'auto',
    }, tempDir);
    expect(loadConfig(tempDir).connections?.['moderado-cloud']?.baseUrl)
      .toBe('http://127.0.0.1:4788/v1');
  });

  it('persists OAuth credential expiry and refuses expired credentials', async () => {
    const store = new MemoryCredentialStore();
    const connection = await storeConnectionCredential({
      id: 'moderado-cloud', displayName: 'Moderado Cloud', kind: 'openai-compatible',
      baseUrl: 'https://mod.alfazen.org/v1', apiKey: 'mrd_expired', defaultModel: 'auto',
      credentialExpiresAt: Date.now() - 1000,
    }, store);
    saveConnection(connection, tempDir);
    expect(loadConfig(tempDir).connections?.['moderado-cloud']?.credentialExpiresAt).toBeLessThan(Date.now());
    expect((await resolveConnectionCredential(connection, store)).apiKey).toBeUndefined();
  });

  it('requires credential storage only for Cloud profiles that have a key', () => {
    const cloud = { id: 'moderado-cloud' };
    const keyedCloud = { id: 'moderado-cloud', apiKey: 'mrd_test' };
    const other = { id: 'openrouter' };
    const keyedOther = { id: 'openrouter', apiKey: 'sk_test' };
    expect(requiresCredentialReference(cloud, 'linux')).toBe(false);
    expect(requiresCredentialReference(cloud, 'darwin')).toBe(false);
    expect(requiresCredentialReference(cloud, 'win32')).toBe(false);
    expect(requiresCredentialReference(keyedCloud, 'linux')).toBe(true);
    expect(requiresCredentialReference(keyedCloud, 'win32')).toBe(true);
    expect(requiresCredentialReference(other, 'linux')).toBe(false);
    expect(requiresCredentialReference(keyedOther, 'win32')).toBe(true);
  });

  it('loads a saved public Gateway as the active connection without credentials', () => {
    saveConnection({
      id: 'moderado-cloud', displayName: 'Moderado Cloud', kind: 'openai-compatible',
      baseUrl: 'https://mod.alfazen.org/v1', defaultModel: 'auto',
    }, tempDir);
    expect(getActiveConnection(loadConfig(tempDir))).toMatchObject({
      id: 'moderado-cloud', baseUrl: 'https://mod.alfazen.org/v1', defaultModel: 'auto',
    });
    expect(getActiveConnection(loadConfig(tempDir))?.apiKey).toBeUndefined();
  });

  it('uses legacy NVIDIA credentials as an implicit NVIDIA connection', () => {
    saveConfig({ apiKey: 'nvapi-legacy', defaultModel: 'meta/llama' }, tempDir);
    expect(getActiveConnection(loadConfig(tempDir))).toMatchObject({
      id: 'nvidia-nim',
      kind: 'nvidia-nim',
      apiKey: 'nvapi-legacy',
      defaultModel: 'meta/llama',
    });
  });
  it('loads an optional TypeScript language server executable', () => {
    saveConfig({ typescriptLanguageServer: 'typescript-language-server' }, tempDir);
    expect(loadConfig(tempDir).typescriptLanguageServer).toBe('typescript-language-server');
  });

  it('loads an optional web-search endpoint', () => {
    saveConfig({ webSearchEndpoint: 'https://search.example.test/api' }, tempDir);
    expect(loadConfig(tempDir).webSearchEndpoint).toBe('https://search.example.test/api');
  });
  it('loads a preferred web-search provider', () => {
    saveConfig({ webSearchProvider: 'parallel' }, tempDir);
    expect(loadConfig(tempDir).webSearchProvider).toBe('parallel');
  });



  it('migrates legacy plaintext credentials only after every secure write succeeds', async () => {
    saveConnection({ id: 'openrouter', displayName: 'OpenRouter', kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-legacy' }, tempDir);
    const store = new MemoryCredentialStore();

    await migrateLegacyCredentials(store, tempDir);

    const raw = fs.readFileSync(getConfigPath(tempDir), 'utf8');
    expect(raw).not.toContain('sk-legacy');
    expect(loadConfig(tempDir).connections?.openrouter?.credentialReference).toBe('moderado/provider/openrouter');
    expect(await store.get('moderado/provider/openrouter')).toBe('sk-legacy');
  });

  it('treats a persisted MCP server without enabled as enabled', () => {
    fs.mkdirSync(path.dirname(getConfigPath(tempDir)), { recursive: true });
    fs.writeFileSync(getConfigPath(tempDir), JSON.stringify({
      mcpServers: { docs: { executable: 'node', args: ['server.mjs'] } },
    }));
    expect(loadConfig(tempDir).mcpServers?.docs).toMatchObject({ enabled: true });
  });

  it('adds, disables, and removes a validated MCP server', () => {
    saveMcpServer('docs', { executable: 'node', args: ['server.mjs'], enabled: true }, tempDir);
    setMcpServerEnabled('docs', false, tempDir);
    expect(loadConfig(tempDir).mcpServers?.docs.enabled).toBe(false);
    removeMcpServer('docs', tempDir);
    expect(loadConfig(tempDir).mcpServers).toBeUndefined();
  });
});
