import { NvidiaAdapter } from '@moderado/providers';
import { Router } from '@moderado/core';
import { askQuestion, askSelect, SelectOption } from './prompt.js';
import { renderBox } from './box.js';
import { loadConfig, saveConfig, resolveApiKey } from '../config.js';
import { renderModeradoHeader } from './welcome.js';

export interface ModelSelectionResult {
  modelId?: string;
  allowPaid: boolean;
  allowUnknown: boolean;
  savedAsDefault: boolean;
}

export interface ModelSelectorOptions {
  apiKey?: string;
  currentModel?: string;
  signal?: AbortSignal;
  saveSelectionByDefault?: boolean;
}

let cachedInventory: { id: string }[] | null = null;

export async function selectModelInteractive(
  options: ModelSelectorOptions = {}
): Promise<ModelSelectionResult> {
  const isTty = Boolean(process.stdout.isTTY);
  if (isTty) {
    // Open dedicated alternate screen popup window
    process.stdout.write('\x1b[?1049h\x1b[H\x1b[2J');
  }
  try {
    return await executeModelSelection(options);
  } finally {
    if (isTty) {
      // Restore previous chat terminal screen buffer
      process.stdout.write('\x1b[?1049l');
    }
  }
}

async function executeModelSelection(
  options: ModelSelectorOptions = {}
): Promise<ModelSelectionResult> {
  const signal = options.signal;
  const apiKey = options.apiKey ?? resolveApiKey();
  const config = loadConfig();
  const activeModel = options.currentModel ?? config.defaultModel;

  if (signal?.aborted) {
    return {
      modelId: activeModel,
      allowPaid: config.allowPaid ?? false,
      allowUnknown: config.allowUnknown ?? false,
      savedAsDefault: false,
    };
  }

  const provider = new NvidiaAdapter({ apiKey });
  const router = new Router();

  let discoveredEntries: { id: string }[] = [];
  if (cachedInventory && cachedInventory.length > 0) {
    discoveredEntries = cachedInventory;
  } else {
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H' + renderModeradoHeader() + '\n\n\x1b[36mQuerying NVIDIA NIM model catalog...\x1b[0m\n');
    try {
      discoveredEntries = await provider.discoverModels(signal);
      cachedInventory = discoveredEntries;
    } catch {
      discoveredEntries = [
        { id: 'nvidia/llama-3.1-nemotron-70b-instruct' },
        { id: 'meta/llama-3.3-70b-instruct' },
        { id: 'meta/llama-3.2-90b-vision-instruct' },
        { id: 'meta/llama-3.2-11b-vision-instruct' },
        { id: 'meta/llama-3.1-70b-instruct' },
        { id: 'mistralai/mixtral-8x7b-instruct-v0.1' },
        { id: 'mistralai/mistral-large-2-instruct' },
        { id: 'deepseek-ai/deepseek-v4-flash-0731' },
        { id: 'deepseek-ai/deepseek-coder-6.7b-instruct' },
        { id: 'google/codegemma-7b' },
        { id: 'ibm/granite-34b-code-instruct' },
        { id: 'openai/gpt-oss-20b' },
        { id: 'z-ai/glm-5.3' },
        { id: 'z-ai/glm-5.3-flash' },
      ];
    }
  }

  const freeModels: { id: string; desc: string }[] = [];
  const paidModels: { id: string; desc: string }[] = [];

  for (const entry of discoveredEntries) {
    const meta = router.classifyModel(entry.id);
    if (meta.accessTier === 'free_trial' || meta.accessTier === 'local') {
      let desc = 'Free trial endpoint';
      if (entry.id.includes('nemotron-70b')) desc = 'NVIDIA flagship 70B reasoning & code model';
      else if (entry.id.includes('llama-3.3-70b')) desc = 'Meta 70B frontier instruction model';
      else if (entry.id.includes('llama-3.2-90b')) desc = 'High-capacity multimodal reasoning';
      else if (entry.id.includes('llama-3.2-11b')) desc = 'Fast lightweight vision instruction model';
      else if (entry.id.includes('mixtral')) desc = 'MoE model with tool calling support';

      freeModels.push({ id: entry.id, desc });
    } else {
      let desc = meta.accessTier === 'paid' ? 'Paid model' : 'Unclassified NIM endpoint';
      if (entry.id.includes('glm')) desc = 'Zhipu AI GLM multilingual model';
      else if (entry.id.includes('mistral-large')) desc = 'Flagship frontier reasoning & coding model';
      else if (entry.id.includes('deepseek')) desc = 'Specialized high-efficiency coding model';
      else if (entry.id.includes('codestral')) desc = 'Mistral code generation specialist';
      else if (entry.id.includes('codegemma')) desc = 'Google code intelligence model';

      paidModels.push({ id: entry.id, desc });
    }
  }

  // Sort free models with 70B reasoning models first
  freeModels.sort((a, b) => {
    const scoreA = a.id.includes('nemotron-70b') || a.id.includes('llama-3.3-70b') ? 2 : 1;
    const scoreB = b.id.includes('nemotron-70b') || b.id.includes('llama-3.3-70b') ? 2 : 1;
    return scoreB - scoreA;
  });

  const menuLines = [
    `\x1b[1;38;5;75m[1]\x1b[0m Search by keyword       \x1b[38;5;244m(e.g. "glm", "flash", "llama")\x1b[0m`,
    `\x1b[1;38;5;114m[2]\x1b[0m Free Trial Models        \x1b[38;5;244m(${freeModels.length} models ready)\x1b[0m`,
    `\x1b[1;38;5;222m[3]\x1b[0m Paid & Frontier Models   \x1b[38;5;244m(${paidModels.length} models)\x1b[0m`,
    `\x1b[1;38;5;141m[4]\x1b[0m Complete Catalog         \x1b[38;5;244m(${discoveredEntries.length} models)\x1b[0m`,
    `\x1b[1;38;5;250m[5]\x1b[0m Auto Routing             \x1b[38;5;244m(Free-first recommended)\x1b[0m`,
  ];
  if (activeModel) {
    menuLines.push('---');
    menuLines.push(`\x1b[1;38;5;39m[6]\x1b[0m Keep Current             \x1b[38;5;141m${activeModel}\x1b[0m`);
  }
  menuLines.push(`\x1b[1;38;5;245m[q]\x1b[0m Cancel & Close Window    \x1b[38;5;244m(No changes)\x1b[0m`);

  process.stdout.write(
    '\x1b[2J\x1b[3J\x1b[H' +
      renderModeradoHeader() +
      '\n\n' +
      renderBox(menuLines, {
        title: 'Model Selection Window',
        minWidth: 58,
        borderColor: '\x1b[38;5;240m',
        titleColor: '\x1b[1;38;5;75m',
      }) +
      '\n'
  );

  const maxOption = activeModel ? 6 : 5;
  const input = await askQuestion(
    `Select [1-${maxOption}], [q] to cancel, or type keyword: `,
    { signal }
  );

  let chosenModelId: string | undefined = undefined;
  let isPaid = false;

  const normalized = input.trim().toLowerCase();

  if (normalized === 'q' || normalized === 'cancel' || normalized === 'exit' || normalized === '' || (normalized === '6' && activeModel)) {
    return {
      modelId: activeModel,
      allowPaid: config.allowPaid ?? false,
      allowUnknown: config.allowUnknown ?? false,
      savedAsDefault: false,
    };
  } else if (normalized === '5' || normalized === 'auto') {
    chosenModelId = 'auto';
    isPaid = false;
  } else if (normalized === '2' || normalized === 'free') {
    // Browse all free models
    chosenModelId = await pickFromList('Choose Free Model:', freeModels.map((m) => m.id), router, signal);
    isPaid = false;
  } else if (normalized === '3' || normalized === 'paid') {
    // Browse paid models with search or list
    chosenModelId = await browseOrSearchList('Paid & Frontier Models:', paidModels.map((m) => m.id), router, signal);
    isPaid = true;
  } else if (normalized === '4' || normalized === 'all') {
    // Browse all models with search or list
    chosenModelId = await browseOrSearchList('All NVIDIA NIM Models:', discoveredEntries.map((m) => m.id), router, signal);
    if (chosenModelId) {
      const meta = router.classifyModel(chosenModelId);
      isPaid = meta.accessTier === 'paid' || meta.accessTier === 'unknown';
    }
  } else {
    // Keyword search or direct selection (e.g. "1", "glm", "flash", "z-ai/glm-5.3-flash")
    let searchTerm = input.trim();
    if (searchTerm === '1' || !searchTerm) {
      searchTerm = await askQuestion('Enter search term or model ID (e.g. "glm", "flash", "llama"): ', { signal });
    }

    if (!searchTerm) {
      return {
        modelId: activeModel,
        allowPaid: config.allowPaid ?? false,
        allowUnknown: config.allowUnknown ?? false,
        savedAsDefault: false,
      };
    } else {
      chosenModelId = await searchAndSelect(searchTerm, discoveredEntries.map((m) => m.id), router, signal);
      if (chosenModelId) {
        const meta = router.classifyModel(chosenModelId);
        isPaid = meta.accessTier === 'paid' || meta.accessTier === 'unknown';
      }
    }
  }

  if (!chosenModelId || chosenModelId === activeModel) {
    return {
      modelId: activeModel,
      allowPaid: config.allowPaid ?? false,
      allowUnknown: config.allowUnknown ?? false,
      savedAsDefault: false,
    };
  }

  let savedAsDefault = false;
  if (options.saveSelectionByDefault !== false && chosenModelId) {
    process.stdout.write(`\n\x1b[32m✔ Selected model:\x1b[0m \x1b[1m${chosenModelId}\x1b[0m\n`);
    const shouldSave = await askQuestion(
      `Save ${chosenModelId} as persistent default model in ~/.moderado/config.json? [Y/n]: `,
      { signal }
    );
    if (shouldSave.toLowerCase() !== 'n' && shouldSave.toLowerCase() !== 'no') {
      saveConfig({
        defaultModel: chosenModelId,
        allowPaid: isPaid ? true : config.allowPaid,
        allowUnknown: isPaid ? true : config.allowUnknown,
      });
      process.stdout.write(`\x1b[32m✔ Saved ${chosenModelId} as default model.\x1b[0m\n\n`);
      savedAsDefault = true;
    }
  }

  return {
    modelId: chosenModelId,
    allowPaid: isPaid || (config.allowPaid ?? false),
    allowUnknown: isPaid || (config.allowUnknown ?? false),
    savedAsDefault,
  };
}

async function searchAndSelect(
  initialQuery: string,
  allModelIds: string[],
  router: Router,
  signal?: AbortSignal
): Promise<string> {
  let currentQuery = initialQuery;

  while (!signal?.aborted) {
    const q = currentQuery.trim().toLowerCase();

    // Check exact match first
    const exact = allModelIds.find((id) => id.toLowerCase() === q);
    if (exact) {
      const meta = router.classifyModel(exact);
      const conf = await askQuestion(`\nSelected: ${exact} [${meta.accessTier}]. Confirm? [Y/n, or type new keyword]: `, { signal });
      const confNorm = conf.trim().toLowerCase();
      if (!confNorm || confNorm === 'y' || confNorm === 'yes') {
        return exact;
      }
      if (confNorm !== 'n' && confNorm !== 'no') {
        currentQuery = conf.trim();
        continue;
      }
    }

    // Filter matching models
    const matches = allModelIds.filter((id) => id.toLowerCase().includes(q));

    if (matches.length === 0) {
      process.stdout.write(`\n\x1b[33mNo catalog model found matching "${currentQuery}".\x1b[0m\n`);
      process.stdout.write('  \x1b[1m[1]\x1b[0m Try another search keyword\n');
      process.stdout.write(`  \x1b[1m[2]\x1b[0m Use "${currentQuery}" as custom Model ID\n`);
      process.stdout.write('  \x1b[1m[3]\x1b[0m Cancel search\n');
      const action = await askQuestion('Select [1-3] or type a new search keyword: ', { signal });
      const actNorm = action.trim().toLowerCase();
      if (actNorm === '2') {
        return currentQuery.trim();
      } else if (actNorm === '3' || actNorm === 'cancel' || actNorm === 'exit') {
        return '';
      } else if (actNorm === '1') {
        const next = await askQuestion('Enter new search keyword: ', { signal });
        if (!next) return '';
        currentQuery = next;
        continue;
      } else if (action.trim()) {
        currentQuery = action.trim();
        continue;
      }
      return '';
    }

    if (matches.length === 1) {
      const meta = router.classifyModel(matches[0]);
      process.stdout.write(`\n\x1b[32mFound 1 matching model:\x1b[0m \x1b[1m${matches[0]}\x1b[0m [${meta.accessTier}]\n`);
      const conf = await askQuestion('Select this model? [Y/n, or type a new search keyword]: ', { signal });
      const confNorm = conf.trim().toLowerCase();
      if (!confNorm || confNorm === 'y' || confNorm === 'yes') {
        return matches[0];
      }
      if (confNorm !== 'n' && confNorm !== 'no') {
        currentQuery = conf.trim();
        continue;
      }
      const next = await askQuestion('Enter new search keyword (or press Enter to cancel): ', { signal });
      if (!next) return '';
      currentQuery = next;
      continue;
    }

    // Multiple matches
    process.stdout.write(`\n\x1b[1mFound ${matches.length} models matching "${currentQuery}":\x1b[0m\n`);
    process.stdout.write('\x1b[90m─────────────────────────────────────────────────────────────\x1b[0m\n');
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const meta = router.classifyModel(m);
      const tag = meta.accessTier === 'free_trial' ? 'Free Trial' : 'Paid';
      process.stdout.write(`  \x1b[1m[${i + 1}]\x1b[0m ${m} \x1b[36m[${tag}]\x1b[0m\n`);
    }
    process.stdout.write('  \x1b[1m[s]\x1b[0m Search again with a different keyword\n');
    process.stdout.write('  \x1b[1m[b]\x1b[0m Back to main menu\n');
    process.stdout.write('\x1b[90m─────────────────────────────────────────────────────────────\x1b[0m\n');

    const choice = await askQuestion(`Select [1-${matches.length}], "s" to search again, or type a new keyword: `, { signal });
    const choiceNorm = choice.trim().toLowerCase();

    if (choiceNorm === 'b' || choiceNorm === 'back') {
      return '';
    }

    if (choiceNorm === 's' || choiceNorm === 'search') {
      const next = await askQuestion('Enter new search keyword: ', { signal });
      if (!next) return '';
      currentQuery = next;
      continue;
    }

    const num = parseInt(choice, 10);
    if (!isNaN(num) && num >= 1 && num <= matches.length) {
      return matches[num - 1];
    }

    if (choice.trim()) {
      currentQuery = choice.trim();
      continue;
    }

    return '';
  }

  return '';
}

async function browseOrSearchList(
  title: string,
  modelIds: string[],
  router: Router,
  signal?: AbortSignal
): Promise<string> {
  process.stdout.write(`\n\x1b[1m${title}\x1b[0m (${modelIds.length} models)\n`);
  const filter = await askQuestion('Filter by keyword (e.g. "glm", "flash", "coder") or press Enter to list all: ', { signal });

  if (filter.trim()) {
    return searchAndSelect(filter.trim(), modelIds, router, signal);
  }

  return pickFromList(title, modelIds, router, signal);
}

async function pickFromList(
  title: string,
  modelIds: string[],
  router: Router,
  signal?: AbortSignal
): Promise<string> {
  const choices: SelectOption[] = modelIds.map((id) => {
    const meta = router.classifyModel(id);
    const tag = meta.accessTier === 'free_trial' ? 'Free' : meta.accessTier === 'paid' ? 'Paid' : 'Unclassified';
    return {
      label: id,
      value: id,
      tag,
    };
  });

  // If list is large (> 25), show in pages of 20
  if (choices.length > 25) {
    let page = 0;
    const pageSize = 20;
    const totalPages = Math.ceil(choices.length / pageSize);

    while (page < totalPages) {
      const pageChoices = choices.slice(page * pageSize, (page + 1) * pageSize);
      process.stdout.write(`\n\x1b[1m${title}\x1b[0m (Page ${page + 1} of ${totalPages})\n`);
      process.stdout.write('\x1b[90m─────────────────────────────────────────────────────────────\x1b[0m\n');
      for (let i = 0; i < pageChoices.length; i++) {
        const item = pageChoices[i];
        const num = `[${i + 1}]`;
        const tag = item.tag ? ` \x1b[36m[${item.tag}]\x1b[0m` : '';
        process.stdout.write(`  \x1b[1m${num}\x1b[0m ${item.label}${tag}\n`);
      }
      process.stdout.write('\x1b[90m─────────────────────────────────────────────────────────────\x1b[0m\n');

      const promptMsg = page + 1 < totalPages
        ? `Select [1-${pageChoices.length}], type model name, or press Enter for next page: `
        : `Select [1-${pageChoices.length}] or type model name: `;

      const answer = await askQuestion(promptMsg, { signal });
      if (!answer && page + 1 < totalPages) {
        page++;
        continue;
      }

      const num = parseInt(answer, 10);
      if (!isNaN(num) && num >= 1 && num <= pageChoices.length) {
        return pageChoices[num - 1].value;
      }

      // Check if user typed a model name/keyword directly
      if (answer.trim()) {
        const matched = modelIds.find((m) => m.toLowerCase().includes(answer.trim().toLowerCase()));
        if (matched) return matched;
      }

      break;
    }

    return '';
  }

  const pick = await askSelect(title, choices, 0, { signal });
  return pick.value;
}
