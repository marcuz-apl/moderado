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
} from '../src/config.js';
import { MemoryCredentialStore } from '../src/credentials.js';

describe('CLI Configuration Storage', () => {
  let tempDir: string;
  const origKey = process.env.NVIDIA_API_KEY;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-config-test-'));
    delete process.env.NVIDIA_API_KEY;
  });

  afterEach(() => {
    if (origKey !== undefined) {
      process.env.NVIDIA_API_KEY = origKey;
    } else {
      delete process.env.NVIDIA_API_KEY;
    }
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

  it('saves and loads configuration cleanly', () => {
    saveConfig({ apiKey: 'nvapi-test123', defaultModel: 'meta/llama-3.2-11b-vision-instruct' }, tempDir);
    const loaded = loadConfig(tempDir);
    expect(loaded.apiKey).toBe('nvapi-test123');
    expect(loaded.defaultModel).toBe('meta/llama-3.2-11b-vision-instruct');
  });

  it('stores configured connect providers and rejects unsafe custom endpoints', () => {
    saveConfig({
      connectProviders: {
        enabled: ['openrouter', 'ollama'],
        custom: [{ id: 'company-gateway', name: 'Company Gateway', baseUrl: 'https://llm.example.test/v1/', defaultModel: 'coder-small' }],
      },
    }, tempDir);
    expect(loadConfig(tempDir).connectProviders).toEqual({
      enabled: ['openrouter', 'ollama'],
      custom: [{ id: 'company-gateway', name: 'Company Gateway', baseUrl: 'https://llm.example.test/v1', defaultModel: 'coder-small' }],
    });

    fs.writeFileSync(getConfigPath(tempDir), JSON.stringify({ connectProviders: {
      enabled: ['openrouter', 'unknown-provider'],
      custom: [
        { id: 'unsafe', name: 'Unsafe', baseUrl: 'http://example.test/v1' },
        { id: 'credentialed', name: 'Credentialed', baseUrl: 'https://user:pass@example.test/v1' },
        { id: 'safe-local', name: 'Local', baseUrl: 'http://localhost:1234/v1' },
      ],
    } }));
    expect(loadConfig(tempDir).connectProviders).toEqual({
      enabled: ['openrouter'],
      custom: [{ id: 'safe-local', name: 'Local', baseUrl: 'http://localhost:1234/v1', defaultModel: undefined }],
    });
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
