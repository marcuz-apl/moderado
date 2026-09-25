import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { McpServerConfig, McpServerConfigSchema } from '@moderado/contracts';
import { credentialReference, CredentialStore, resolveCredential } from './credentials.js';

export interface ModeradoConfig {
  apiKey?: string;
  defaultModel?: string;
  allowPaid?: boolean;
  allowUnknown?: boolean;
  activeConnectionId?: string;
  connections?: Record<string, ProviderConnection>;
  connectProviders?: ConnectProvidersConfig;
  typescriptLanguageServer?: string;
  /** HTTPS endpoint that returns `{ results: [{ title, url, snippet? }] }`. */
  webSearchEndpoint?: string;
  /** Preferred search site: `exa` (default), `parallel`, or a `custom` endpoint. */
  webSearchProvider?: 'exa' | 'parallel' | 'custom';
  mcpServers?: Record<string, McpServerConfig>;
  /** Upper bound on model output tokens per response turn. */
  maxOutputTokens?: number;
}

export const CONNECT_PROVIDER_PRESET_IDS = [
  'nvidia-nim', 'openrouter', 'agnes-ai', 'orcarouter', 'ollama', 'lm-studio', 'openai-compatible',
] as const;

export type ConnectProviderPresetId = typeof CONNECT_PROVIDER_PRESET_IDS[number];

export interface CustomConnectProvider {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel?: string;
}

export interface ConnectProvidersConfig {
  /** Omit to show all built-ins; an empty list hides every built-in. */
  enabled?: ConnectProviderPresetId[];
  custom?: CustomConnectProvider[];
}

export type ProviderConnectionKind = 'nvidia-nim' | 'openai-compatible';

/**
 * Pure metadata for the built-in provider presets. Lives here (not in the TUI
 * layer) so the host runtime can answer `provider.list` without importing any
 * presentation code.
 */
export interface ProviderPresetMeta {
  id: ConnectProviderPresetId;
  label: string;
  description: string;
  kind: ProviderConnectionKind;
  baseUrl: string;
  defaultModel?: string;
  /** Local-only runtimes (Ollama, LM Studio) never require a key. */
  requiresApiKey: boolean;
}

export const CONNECT_PROVIDER_PRESET_META: ProviderPresetMeta[] = [
  {
    id: 'nvidia-nim',
    label: 'NVIDIA NIM',
    description: 'Free-first routing across Nemotron, LLaMA, DeepSeek and Kimi.',
    kind: 'nvidia-nim',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    requiresApiKey: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'One key for Qwen, DeepSeek, Mistral and free-tier models.',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    requiresApiKey: true,
  },
  {
    id: 'agnes-ai',
    label: 'Agnes AI',
    description: 'Agnes Flash and Code endpoints.',
    kind: 'openai-compatible',
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    requiresApiKey: true,
  },
  {
    id: 'orcarouter',
    label: 'OrcaRouter',
    description: 'Adaptive model routing.',
    kind: 'openai-compatible',
    baseUrl: 'https://api.orcarouter.ai/v1',
    defaultModel: 'orcarouter/free',
    requiresApiKey: true,
  },
  {
    id: 'ollama',
    label: 'Ollama',
    description: 'Models served locally by Ollama.',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    requiresApiKey: false,
  },
  {
    id: 'lm-studio',
    label: 'LM Studio',
    description: 'Models served by the LM Studio local server.',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1234/v1',
    requiresApiKey: false,
  },
];

/** True for loopback endpoints, which authenticate without an API key. */
export function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return (
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function findProviderPreset(id: string): ProviderPresetMeta | undefined {
  return CONNECT_PROVIDER_PRESET_META.find((preset) => preset.id === id);
}

export interface ProviderConnection {
  id: string;
  displayName: string;
  kind: ProviderConnectionKind;
  baseUrl: string;
  credentialReference?: string;
  apiKey?: string;
  defaultModel?: string;
}

const CONFIG_DIR_NAME = '.moderado';
const CONFIG_FILE_NAME = 'config.json';

export function getConfigPath(customHome?: string): string {
  const home = customHome || os.homedir();
  return path.join(home, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

export function loadConfig(customHome?: string): ModeradoConfig {
  const configPath = getConfigPath(customHome);
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const connections = parseConnections(parsed.connections);
      return {
        apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : undefined,
        defaultModel: typeof parsed.defaultModel === 'string' ? parsed.defaultModel : undefined,
        allowPaid: typeof parsed.allowPaid === 'boolean' ? parsed.allowPaid : undefined,
        allowUnknown: typeof parsed.allowUnknown === 'boolean' ? parsed.allowUnknown : undefined,
        activeConnectionId:
          typeof parsed.activeConnectionId === 'string' && connections[parsed.activeConnectionId]
            ? parsed.activeConnectionId
            : undefined,
        connections: Object.keys(connections).length > 0 ? connections : undefined,
        connectProviders: parseConnectProviders(parsed.connectProviders),
        mcpServers: parseMcpServers(parsed.mcpServers),
        typescriptLanguageServer: typeof parsed.typescriptLanguageServer === 'string' ? parsed.typescriptLanguageServer : undefined,
        webSearchEndpoint: typeof parsed.webSearchEndpoint === 'string' ? parsed.webSearchEndpoint : undefined,
        webSearchProvider: parsed.webSearchProvider === 'exa' || parsed.webSearchProvider === 'parallel' || parsed.webSearchProvider === 'custom' ? parsed.webSearchProvider : undefined,
        maxOutputTokens: typeof parsed.maxOutputTokens === 'number' && parsed.maxOutputTokens > 0 ? parsed.maxOutputTokens : undefined,
      };
    }
    return {};
  } catch {
    return {};
  }
}

function parseConnectProviders(value: unknown): ConnectProvidersConfig | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const result: ConnectProvidersConfig = {};
  let recognized = false;

  if (Array.isArray(item.enabled)) {
    const enabled = new Set(item.enabled.filter(
      (id): id is ConnectProviderPresetId => typeof id === 'string' && CONNECT_PROVIDER_PRESET_IDS.includes(id as ConnectProviderPresetId),
    ));
    result.enabled = [...enabled];
    recognized = true;
  }

  if (Array.isArray(item.custom)) {
    const custom: CustomConnectProvider[] = [];
    const seen = new Set<string>();
    for (const entry of item.custom) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(candidate.id)) continue;
      if (CONNECT_PROVIDER_PRESET_IDS.includes(candidate.id as ConnectProviderPresetId) || seen.has(candidate.id)) continue;
      if (typeof candidate.name !== 'string' || !candidate.name.trim() || candidate.name.trim().length > 80) continue;
      if (typeof candidate.baseUrl !== 'string' || !candidate.baseUrl.trim()) continue;
      if (candidate.defaultModel !== undefined && (typeof candidate.defaultModel !== 'string' || !candidate.defaultModel.trim())) continue;

      let url: URL;
      try { url = new URL(candidate.baseUrl.trim()); } catch { continue; }
      const localHttpHosts = ['localhost', '127.0.0.1', '[::1]', '::1'];
      if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && localHttpHosts.includes(url.hostname))) || url.username || url.password) continue;

      custom.push({
        id: candidate.id,
        name: candidate.name.trim(),
        baseUrl: url.toString().replace(/\/+$/, ''),
        defaultModel: typeof candidate.defaultModel === 'string' ? candidate.defaultModel.trim() : undefined,
      });
      seen.add(candidate.id);
    }
    result.custom = custom;
    recognized = true;
  }

  return recognized ? result : undefined;
}

function parseMcpServers(value: unknown): Record<string, McpServerConfig> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const servers = Object.entries(value as Record<string, unknown>).flatMap(([name, config]) => McpServerConfigSchema.safeParse(config).success && /^[a-z0-9_-]+$/i.test(name) ? [[name, McpServerConfigSchema.parse(config)]] : []);
  return servers.length ? Object.fromEntries(servers) : undefined;
}

function parseConnections(value: unknown): Record<string, ProviderConnection> {
  if (typeof value !== 'object' || value === null) return {};

  const result: Record<string, ProviderConnection> = {};
  for (const candidate of Object.values(value as Record<string, unknown>)) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const item = candidate as Record<string, unknown>;
    const kind = item.kind;
    if (
      typeof item.id !== 'string' ||
      typeof item.displayName !== 'string' ||
      typeof item.baseUrl !== 'string' ||
      (kind !== 'nvidia-nim' && kind !== 'openai-compatible')
    ) continue;

    result[item.id] = {
      id: item.id,
      displayName: item.displayName,
      kind,
      baseUrl: item.baseUrl,
      credentialReference: typeof item.credentialReference === 'string' ? item.credentialReference : undefined,
      apiKey: typeof item.apiKey === 'string' ? item.apiKey : undefined,
      defaultModel: typeof item.defaultModel === 'string' ? item.defaultModel : undefined,
    };
  }
  return result;
}

export function saveConfig(config: ModeradoConfig, customHome?: string): void {
  const configPath = getConfigPath(customHome);
  const dir = path.dirname(configPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const existing = loadConfig(customHome);
  const merged: ModeradoConfig = {
    ...existing,
    ...config,
  };

  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export function resolveApiKey(customHome?: string): string | undefined {
  if (process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.trim()) {
    return process.env.NVIDIA_API_KEY.trim();
  }

  const config = loadConfig(customHome);
  if (config.apiKey && config.apiKey.trim()) {
    return config.apiKey.trim();
  }

  return undefined;
}

/** Return the selected provider, retaining compatibility with pre-profile configs. */
export function getActiveConnection(config: ModeradoConfig): ProviderConnection | undefined {
  if (config.activeConnectionId && config.connections?.[config.activeConnectionId]) {
    return config.connections[config.activeConnectionId];
  }

  if (config.apiKey?.trim()) {
    return {
      id: 'nvidia-nim',
      displayName: 'NVIDIA NIM',
      kind: 'nvidia-nim',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: config.apiKey.trim(),
      defaultModel: config.defaultModel,
    };
  }
  return undefined;
}

/** Save a provider profile and select it for future chat sessions. */
export function saveConnection(connection: ProviderConnection, customHome?: string): void {
  const existing = loadConfig(customHome);
  const persisted = connection.credentialReference ? { ...connection, apiKey: undefined } : connection;
  saveConfig(
    {
      connections: { ...existing.connections, [persisted.id]: persisted },
      activeConnectionId: persisted.id,
    },
    customHome
  );
}

function validateMcpServerName(name: string): void {
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`Invalid MCP server name '${name}'.`);
}

export function saveMcpServer(name: string, server: McpServerConfig, customHome?: string): void {
  validateMcpServerName(name);
  const validated = McpServerConfigSchema.parse(server);
  const config = loadConfig(customHome);
  saveConfig({ mcpServers: { ...config.mcpServers, [name]: validated } }, customHome);
}

export function setMcpServerEnabled(name: string, enabled: boolean, customHome?: string): void {
  validateMcpServerName(name);
  const config = loadConfig(customHome);
  const server = config.mcpServers?.[name];
  if (!server) throw new Error(`MCP server '${name}' is not configured.`);
  saveConfig({ mcpServers: { ...config.mcpServers, [name]: { ...server, enabled } } }, customHome);
}

export function removeMcpServer(name: string, customHome?: string): void {
  validateMcpServerName(name);
  const config = loadConfig(customHome);
  if (!config.mcpServers?.[name]) throw new Error(`MCP server '${name}' is not configured.`);
  const { [name]: _removed, ...remaining } = config.mcpServers;
  saveConfig({ mcpServers: Object.keys(remaining).length ? remaining : undefined }, customHome);
}

export async function storeConnectionCredential(connection: ProviderConnection, store: CredentialStore): Promise<ProviderConnection> {
  if (!connection.apiKey?.trim()) return connection;
  const reference = credentialReference(connection.id);
  await store.set(reference, connection.apiKey.trim());
  return { ...connection, credentialReference: reference };
}

export async function resolveConnectionCredential(connection: ProviderConnection, store: CredentialStore): Promise<ProviderConnection> {
  const environmentName = connection.id === 'nvidia-nim' ? 'NVIDIA_API_KEY' : `${connection.id.replace(/[^a-z0-9]/gi, '_').toUpperCase()}_API_KEY`;
  const apiKey = await resolveCredential(process.env[environmentName], connection.credentialReference, connection.apiKey, store);
  return { ...connection, apiKey };
}

/** Move legacy plaintext provider keys into a credential store only when every write succeeds. */
export async function migrateLegacyCredentials(store: CredentialStore, customHome?: string): Promise<number> {
  const config = loadConfig(customHome);
  const next: ModeradoConfig = { ...config, connections: { ...config.connections } };
  const pending: Array<{ id: string; secret: string }> = [];
  if (config.apiKey?.trim()) pending.push({ id: 'nvidia-nim', secret: config.apiKey.trim() });
  for (const connection of Object.values(config.connections ?? {})) {
    if (connection.apiKey?.trim()) pending.push({ id: connection.id, secret: connection.apiKey.trim() });
  }
  if (!pending.length) return 0;
  for (const entry of pending) await store.set(credentialReference(entry.id), entry.secret);
  delete next.apiKey;
  for (const entry of pending) {
    const existing = next.connections?.[entry.id];
    const connection = existing ?? { id: 'nvidia-nim', displayName: 'NVIDIA NIM', kind: 'nvidia-nim' as const, baseUrl: 'https://integrate.api.nvidia.com/v1', defaultModel: config.defaultModel };
    next.connections![entry.id] = { ...connection, credentialReference: credentialReference(entry.id), apiKey: undefined };
  }
  next.activeConnectionId ??= pending[0]?.id;
  const configPath = getConfigPath(customHome);
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const temporary = `${configPath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, configPath);
  return pending.length;
}
