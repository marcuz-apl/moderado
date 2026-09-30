import fs from 'node:fs';
import { z } from 'zod';
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
  /** User-installed skills explicitly enabled for model use. Built-ins remain available. */
  enabledSkills?: string[];
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
  /**
   * Exact model ids this preset guarantees cost nothing, for aliases the
   * provider's own catalog cannot prove. Matched by exact equality only — a
   * substring or id-shape match would free an entire aggregator catalog.
   */
  freeModelAliases?: readonly string[];
  /**
   * Trailing id markers this preset guarantees cost nothing. OrcaRouter names
   * its no-cost routing endpoints `.../free` and publishes no `pricing` at all,
   * so the endpoint name is the only signal available.
   *
   * The marker is matched at the **end** of the id and only where it starts a
   * segment, so `orcarouter/free` is free while `orcarouter/notfree` and
   * `orcarouter/free-router` are not. The declaration is resolved by connection
   * id, so granting it to another provider is an explicit act rather than an
   * accident of a shared substring.
   */
  freeIdSuffixes?: readonly string[];
  /**
   * True when the provider's entire hosted catalog costs nothing.
   *
   * NVIDIA NIM advertises no `pricing` on any of its catalog entries, yet the
   * hosted catalog runs on build.nvidia.com trial credits. That is a property
   * of the *provider*, not of any one model id, so it is declared once here
   * instead of being re-guessed from model names at every call site. It is
   * resolved strictly by connection id, so it can never free an aggregator's
   * metered catalog.
   */
  freeCatalog?: boolean;
}

/** How much of a provider's catalog is declared cost-free, for the free-model predicate. */
export interface ProviderFreePolicy {
  freeModelAliases?: readonly string[];
  freeIdSuffixes?: readonly string[];
  freeCatalog?: boolean;
}

/**
 * The free-tier declaration for a connection id, or `undefined` when the id has
 * no preset. An undeclared provider contributes no free evidence at all.
 */
export function freeModelPolicyFor(connectionId: string | undefined): ProviderFreePolicy | undefined {
  const preset = connectionId ? findProviderPreset(connectionId) : undefined;
  if (!preset) return undefined;
  return {
    freeModelAliases: preset.freeModelAliases,
    freeIdSuffixes: preset.freeIdSuffixes,
    freeCatalog: preset.freeCatalog,
  };
}

export const CONNECT_PROVIDER_PRESET_META: ProviderPresetMeta[] = [
  {
    id: 'nvidia-nim',
    label: 'NVIDIA NIM',
    description: 'Free-first routing across Nemotron, LLaMA, DeepSeek and Kimi.',
    kind: 'nvidia-nim',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    // Every hosted NIM endpoint runs on build.nvidia.com trial credits and the
    // catalog advertises no `pricing`, so without this the free list is empty
    // for the default provider.
    freeCatalog: true,
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
    // Every Agnes AI endpoint is free, and the catalog advertises no `pricing`
    // to prove it per model. Declared once as a property of the provider so the
    // whole catalog lands in the free bucket in every surface, instead of a
    // hardcoded model list in one of them.
    freeCatalog: true,
    requiresApiKey: true,
  },
  {
    id: 'orcarouter',
    label: 'OrcaRouter',
    description: 'Adaptive model routing.',
    kind: 'openai-compatible',
    baseUrl: 'https://api.orcarouter.ai/v1',
    defaultModel: 'orcarouter/free',
    // The catalog advertises no pricing, so a free endpoint is identified by its
    // name: every routing endpoint OrcaRouter serves for nothing ends in `free`.
    // Declared as a trailing marker rather than a free-for-all substring, so the
    // rest of the catalog stays metered.
    freeIdSuffixes: ['free'],
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
        enabledSkills: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)).safeParse(parsed.enabledSkills).data,
      };
    }
    return {};
  } catch {
    return {};
  }
}

function parseConnectProviders(value: unknown): ConnectProvidersConfig | undefined {
  const custom = z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/).refine(id => !CONNECT_PROVIDER_PRESET_IDS.includes(id as ConnectProviderPresetId)),
    name: z.string().trim().min(1).max(80),
    baseUrl: z.string().trim().url().refine(value => {
      const url = new URL(value);
      return !url.username && !url.password && (url.protocol === 'https:' || isLoopbackBaseUrl(value));
    }).transform(value => value.replace(/\/+$/, '')),
    defaultModel: z.string().trim().min(1).optional(),
  });
  const schema = z.object({ enabled: z.array(z.enum(CONNECT_PROVIDER_PRESET_IDS)).optional(), custom: z.array(custom).optional() });
  const parsed = schema.safeParse(value);
  if (!parsed.success) return undefined;
  if (parsed.data.custom) parsed.data.custom = parsed.data.custom.filter((item, index, items) => items.findIndex(other => other.id === item.id) === index);
  return parsed.data;
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
