import { ModelInventoryEntrySchema, type ModelInventoryEntry } from '@moderado/contracts';
import {
  CONNECT_PROVIDER_PRESET_META,
  freeModelPolicyFor,
  isFreeModelOption,
  type ConnectProvidersConfig,
} from '@moderado/providers';

export interface ProviderChoice {
  id: string;
  label: string;
  baseUrl: string;
  requiresApiKey: boolean;
  description?: string;
  defaultModel?: string;
}

/** Present the CLI's shared built-ins plus configured custom connections. */
export function listProviderPresets(config?: ConnectProvidersConfig): ProviderChoice[] {
  const builtIns = CONNECT_PROVIDER_PRESET_META
    .filter((preset) => config?.enabled === undefined || config.enabled.includes(preset.id))
    .map(({ id, label, baseUrl, requiresApiKey, description, defaultModel }) => ({
      id, label, baseUrl, requiresApiKey, description, defaultModel,
    }));
  const custom = (config?.custom ?? []).map(({ id, name, baseUrl, defaultModel }) => ({
    id: `custom:${id}`,
    label: name,
    baseUrl,
    requiresApiKey: true,
    description: 'Custom OpenAI-compatible endpoint',
    defaultModel,
  }));
  return [...builtIns, ...custom];
}

/**
 * Keep only the models whose free status the provider's own declaration can
 * substantiate. The connection id selects the policy, so a webview can never
 * hand the host a policy that widens the free list.
 *
 * An empty result means no model has enough free evidence, not a discovery
 * failure; a malformed catalog throws instead of rendering a partial list.
 */
export function filterProvenFreeModels(connectionId: string, entries: unknown): ModelInventoryEntry[] {
  if (!Array.isArray(entries)) throw new TypeError('Model catalog must be an array');
  const policy = freeModelPolicyFor(connectionId);
  const parsed = entries.map((entry) => ModelInventoryEntrySchema.parse(entry));
  return parsed.filter((entry) => isFreeModelOption(entry, {
    modelId: entry.id,
    accessTier: 'unknown',
    toolSupport: 'unknown',
    source: 'heuristic',
  }, policy));
}
