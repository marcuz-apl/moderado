import { NvidiaAdapter, fetchOpenRouterFreeModels } from '@moderado/providers';
import { Router } from '@moderado/core';
import { CliParsedArgs } from '../args.js';

export interface HandleModelsOptions {
  fetchImpl?: typeof fetch;
  nvidiaAdapter?: NvidiaAdapter;
}

export async function handleModelsCommand(
  args: CliParsedArgs,
  options: HandleModelsOptions = {}
): Promise<number> {
  const provider = options.nvidiaAdapter ?? new NvidiaAdapter();
  const router = new Router();
  const requestedProvider = args.provider?.toLowerCase();

  const results: Record<string, { id: string; provider: string; accessTier: string; toolSupport: string; notes?: string }[]> = {};

  // 1. NVIDIA NIM Free Models
  if (!requestedProvider || requestedProvider === 'nvidia-nim' || requestedProvider === 'nvidia') {
    try {
      const inventory = await provider.discoverModels();
      const freeModels = inventory
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
        .filter((entry) => (entry.accessTier === 'free_trial' || entry.accessTier === 'local') && entry.toolSupport === 'supported');
      results['NVIDIA NIM'] = freeModels;
    } catch {
      results['NVIDIA NIM'] = [];
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
    } catch {
      results['OpenRouter'] = [];
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
    return 0;
  }

  const totalCount = Object.values(results).reduce((acc, list) => acc + list.length, 0);
  process.stdout.write(`\n\x1b[1;36mModerado Free Models Catalog\x1b[0m \x1b[90m(${totalCount} verified free models across NVIDIA NIM, OpenRouter, OpenCode, and Agnes)\x1b[0m\n\n`);

  for (const [providerName, list] of Object.entries(results)) {
    if (list.length === 0) continue;
    process.stdout.write(`\x1b[1;38;5;75m=== ${providerName} (${list.length} Free Models) ===\x1b[0m\n`);
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

  if (!args.json && !args.nonInteractive) {
    const { askQuestion } = await import('../ui/prompt.js');
    const { selectModelInteractive } = await import('../ui/model_selector.js');
    const wantSelect = await askQuestion('Would you like to select and configure a default model? [y/N]: ');
    if (wantSelect.toLowerCase() === 'y' || wantSelect.toLowerCase() === 'yes') {
      await selectModelInteractive({ saveSelectionByDefault: true });
    }
  }

  return 0;
}
