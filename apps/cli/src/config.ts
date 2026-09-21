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
  typescriptLanguageServer?: string;
  /** HTTPS endpoint that returns `{ results: [{ title, url, snippet? }] }`. */
  webSearchEndpoint?: string;
  /** Preferred search site: `exa` (default), `parallel`, or a `custom` endpoint. */
  webSearchProvider?: 'exa' | 'parallel' | 'custom';
  mcpServers?: Record<string, McpServerConfig>;
  /** Upper bound on model output tokens per response turn. */
  maxOutputTokens?: number;
}

export type ProviderConnectionKind = 'nvidia-nim' | 'openai-compatible';

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
  if (!connection.apiKey?.trim()) throw new Error('A provider API key is required.');
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
