import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { McpServerConfig, McpServerConfigSchema } from '@moderado/contracts';

export interface ModeradoConfig {
  apiKey?: string;
  defaultModel?: string;
  allowPaid?: boolean;
  allowUnknown?: boolean;
  activeConnectionId?: string;
  connections?: Record<string, ProviderConnection>;
  typescriptLanguageServer?: string;
  mcpServers?: Record<string, McpServerConfig>;
}

export type ProviderConnectionKind = 'nvidia-nim' | 'openai-compatible';

export interface ProviderConnection {
  id: string;
  displayName: string;
  kind: ProviderConnectionKind;
  baseUrl: string;
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
  saveConfig(
    {
      connections: { ...existing.connections, [connection.id]: connection },
      activeConnectionId: connection.id,
    },
    customHome
  );
}
