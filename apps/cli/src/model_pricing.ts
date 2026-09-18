import type { ModelInventoryEntry } from '@moderado/contracts';

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
