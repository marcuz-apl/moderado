import type { ModelClassification, ModelInventoryEntry } from '@moderado/contracts';
import type { ProviderFreePolicy } from './config.js';
import { isFreeModelEntry } from '@moderado/providers';

/** Use only exact, provider-advertised prompt and completion prices. */
export function findModelPricing(
  models: ModelInventoryEntry[],
  modelId: string
): Record<string, string> | undefined {
  const pricing = models.find((model) => model.id === modelId)?.pricing;
  const prompt = Number(pricing?.prompt);
  const completion = Number(pricing?.completion);
  return Number.isFinite(prompt) && prompt >= 0 && Number.isFinite(completion) && completion >= 0
    ? pricing
    : undefined;
}

/**
 * Whether a model id ends with a provider-declared free marker, as its own
 * trailing segment.
 *
 * The two guards are the whole point. Anchoring at the end means `free` in the
 * middle of an id (`orcarouter/free-router-4`) never matches, and the segment
 * boundary means a metered id that merely ends in the same letters
 * (`orcarouter/notfree`) never matches either. An unanchored substring test is
 * what marked a whole aggregator catalog free.
 */
function endsWithFreeMarker(modelId: string, marker: string): boolean {
  if (!marker) return false;
  if (!modelId.toLowerCase().endsWith(marker.toLowerCase())) return false;
  // `charAt` past the start returns '', which is not alphanumeric, so an id that
  // is nothing but the marker still matches.
  return !/[a-z0-9]/i.test(modelId.charAt(modelId.length - marker.length - 1));
}

/**
 * Whether a provider preset *declares* this model id cost-free by name — either
 * as an exact alias or by a trailing free marker.
 *
 * This is the evidence a catalog cannot supply: OrcaRouter publishes no
 * `pricing` field whatsoever, yet its free routing endpoints are named for it.
 * It is scoped to the declaring provider (resolved by connection id through
 * `freeModelPolicyFor`), so no other provider inherits the rule.
 */
export function isDeclaredFreeModelId(modelId: string, policy?: ProviderFreePolicy): boolean {
  if (policy?.freeModelAliases?.includes(modelId)) return true;
  return (policy?.freeIdSuffixes ?? []).some((marker) => endsWithFreeMarker(modelId, marker));
}

/** Explicit zero prices or curated/preset declarations qualify; paid prices win. */
export function isFreeModelOption(
  entry: Pick<ModelInventoryEntry, 'id' | 'pricing'>,
  classification: ModelClassification,
  policy?: ProviderFreePolicy,
): boolean {
  // A reported nonzero price outranks any blanket preset declaration.
  if (entry.pricing && Object.values(entry.pricing).some(price => price.trim() === '' || !Number.isFinite(Number(price)) || Number(price) !== 0)) return false;
  if (isFreeModelEntry(entry)) return true;
  const curated = classification.source !== 'heuristic';
  if (curated && classification.accessTier !== 'free_trial' && classification.accessTier !== 'local') return false;
  if (policy?.freeCatalog) return true;
  if (isDeclaredFreeModelId(entry.id, policy)) return true;
  if (!curated) return false;
  return classification.accessTier === 'free_trial' || classification.accessTier === 'local';
}
