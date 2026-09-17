import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, saveConfig, resolveApiKey, getConfigPath } from '../src/config.js';

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
});
