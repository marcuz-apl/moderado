import { NvidiaAdapter, fetchOpenRouterFreeModels, fetchProviderModels, isFreeModelEntry } from '@moderado/providers';
import { Router } from '@moderado/core';
import { CliParsedArgs } from '../args.js';
import { findProviderPreset, freeModelPolicyFor } from '../config.js';
import { isFreeModelOption } from '../model_pricing.js';
import { askQuestion } from '../ui/prompt.js';
import { selectModelInteractive } from '../ui/model_selector.js';

export interface HandleModelsOptions {
  fetchImpl?: typeof fetch;
  nvidiaAdapter?: NvidiaAdapter;
}

/** One catalog row, or the reason a provider's list could not be built. */
type CatalogEntry = { id: string; provider: string; accessTier: string; toolSupport: string; notes?: string };
type CatalogResult = CatalogEntry[] | { error: string };

export async function handleModelsCommand(
  args: CliParsedArgs,
  options: HandleModelsOptions = {}
): Promise<number> {
  const provider = options.nvidiaAdapter ?? new NvidiaAdapter();
  const router = new Router();
  const requestedProvider = args.provider?.toLowerCase();

  const results: Record<string, CatalogResult> = {};
  // A provider that cannot be reached is a failure, not an empty list. Silently
  // reporting "0 free models" for a broken or unconfigured provider is what made
  // this command useless as a diagnostic.
  const failures: string[] = [];

  // 1. NVIDIA NIM Free Models
  if (!requestedProvider || requestedProvider === 'nvidia-nim' || requestedProvider === 'nvidia') {
    try {
      const policy = freeModelPolicyFor('nvidia-nim');
      const inventory = await provider.discoverModels();
      results['NVIDIA NIM'] = inventory
        .filter((entry) => isFreeModelOption(entry, router.classifyModel(entry.id), policy))
        .map((entry) => {
          const meta = router.classifyModel(entry.id, args.profile.includes('local'));
          return {
            id: entry.id,
            provider: 'NVIDIA NIM',
            accessTier: meta.accessTier,
            toolSupport: meta.toolSupport,
            notes: meta.source,
          };
        })
        // Free evidence answers cost, not capability. This catalog is the agent's
        // tool-calling pool, so a model that cannot emit tool calls is still not
        // offered here, exactly as before the free-catalog declaration.
        .filter((entry) => entry.toolSupport === 'supported');
    } catch (err) {
      results['NVIDIA NIM'] = { error: err instanceof Error ? err.message : String(err) };
      failures.push('NVIDIA NIM');
    }
  }

  // 2. OpenRouter Free Models
  if (!requestedProvider || requestedProvider === 'openrouter') {
    try {
      const openRouterModels = await fetchOpenRouterFreeModels({ fetchImpl: options.fetchImpl });
      results['OpenRouter'] = openRouterModels.map((entry) => ({
        id: entry.id,
        provider: 'OpenRouter',
        accessTier: 'free',
        toolSupport: 'supported',
        notes: 'free tier',
      }));
    } catch (err) {
      results['OpenRouter'] = { error: err instanceof Error ? err.message : String(err) };
      failures.push('OpenRouter');
    }
  }

  // 3. OrcaRouter Free Models
  // The catalog prices metered models but advertises no `pricing` on its free
  // routing endpoints, so advertised-zero-price filtering returns nothing. Those
  // endpoints are recognised by the trailing `free` marker the preset declares,
  // so the whole catalog is scanned through the one shared predicate.
  if (!requestedProvider || requestedProvider === 'orcarouter') {
    const preset = findProviderPreset('orcarouter')!;
    const policy = freeModelPolicyFor('orcarouter');
    try {
      const catalog = await fetchProviderModels(preset.baseUrl, undefined, { fetchImpl: options.fetchImpl });
      results['OrcaRouter'] = catalog
        .filter((entry) => isFreeModelOption(entry, router.classifyModel(entry.id), policy))
        .map((entry) => ({
          id: entry.id,
          provider: 'OrcaRouter',
          accessTier: 'free',
          // A routing alias forwards to whatever backend it picks, so tool
          // support is reported as unverified rather than claimed.
          toolSupport: 'unknown',
          notes: isFreeModelEntry(entry) ? 'advertised zero price' : 'declared free endpoint',
        }));
    } catch (err) {
      results['OrcaRouter'] = { error: err instanceof Error ? err.message : String(err) };
      failures.push('OrcaRouter');
    }
  }

  // 4. Agnes AI
  if (!requestedProvider || requestedProvider === 'agnes-ai' || requestedProvider === 'agnes') {
    results['Agnes AI'] = [
      { id: 'agnes/chat', provider: 'Agnes AI', accessTier: 'free', toolSupport: 'supported', notes: 'all models free' },
      { id: 'agnes/code', provider: 'Agnes AI', accessTier: 'free', toolSupport: 'supported', notes: 'all models free' },
    ];
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return failures.length > 0 ? 1 : 0;
  }

  const listed = Object.entries(results).filter(
    (entry): entry is [string, CatalogEntry[]] => Array.isArray(entry[1])
  );
  const totalCount = listed.reduce((acc, [, list]) => acc + list.length, 0);
  process.stdout.write(`\n\x1b[1;36mModerado Free / Trial Models Catalog\x1b[0m \x1b[90m(${totalCount} free/trial models across ${listed.map(([name]) => name).join(', ')})\x1b[0m\n\n`);

  for (const [providerName, list] of listed) {
    if (list.length === 0) continue;
    process.stdout.write(`\x1b[1;38;5;75m=== ${providerName} (${list.length} Free / Trial Models) ===\x1b[0m\n`);
    process.stdout.write(
      `${'MODEL ID'.padEnd(52)} ${'ACCESS TIER'.padEnd(14)} ${'TOOL SUPPORT'.padEnd(14)} NOTES\n`
    );
    process.stdout.write(`${'─'.repeat(52)} ${'─'.repeat(14)} ${'─'.repeat(14)} ${'─'.repeat(16)}\n`);

    for (const model of list) {
      const formattedId = model.id.length > 50 ? model.id.slice(0, 47) + '...' : model.id;
      process.stdout.write(
        `${formattedId.padEnd(52)} \x1b[32m${model.accessTier.padEnd(14)}\x1b[0m \x1b[32m${model.toolSupport.padEnd(14)}\x1b[0m \x1b[90m${model.notes ?? ''}\x1b[0m\n`
      );
    }
    process.stdout.write('\n');
  }

  // Unreachable providers are reported explicitly so they never read as a
  // provider that genuinely has zero free models.
  for (const [providerName, result] of Object.entries(results)) {
    if (!Array.isArray(result)) {
      process.stdout.write(`\x1b[31m=== ${providerName}: ${result.error}\x1b[0m\n`);
    }
  }

  if (!args.json && !args.nonInteractive) {
    const wantSelect = await askQuestion('Would you like to select and configure a default model? [y/N]: ');
    if (wantSelect.toLowerCase() === 'y' || wantSelect.toLowerCase() === 'yes') {
      await selectModelInteractive({ saveSelectionByDefault: true });
    }
  }

  return failures.length > 0 ? 1 : 0;
}
