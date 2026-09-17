import { NvidiaAdapter } from '@moderado/providers';
import { Router } from '@moderado/core';
import { askQuestion, askSelect, SelectOption } from './prompt.js';
import { loadConfig, saveConfig, resolveApiKey } from '../config.js';

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

export async function selectModelInteractive(
  options: ModelSelectorOptions = {}
): Promise<ModelSelectionResult> {
  const signal = options.signal;
  const apiKey = options.apiKey ?? resolveApiKey();
  const config = loadConfig();
  const activeModel = options.currentModel ?? config.defaultModel;

  const provider = new NvidiaAdapter({ apiKey });
  const router = new Router();

  let discoveredEntries: { id: string }[] = [];
  try {
    discoveredEntries = await provider.discoverModels(signal);
  } catch {
    // If offline or provider fails, use standard builtins
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
    ];
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
      if (entry.id.includes('mistral-large')) desc = 'Flagship frontier reasoning & coding model';
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

  const topLevelChoices: SelectOption[] = [
    {
      label: activeModel ? `Current Model: ${activeModel}` : 'Auto (Recommended Free-First)',
      value: activeModel ? 'current' : 'auto',
      tag: activeModel ? 'Configured' : 'Auto',
      description: activeModel
        ? 'Continue using your currently configured default model'
        : 'Automatically route to the best available free model with tool support',
    },
    {
      label: 'Free Models',
      value: 'browse_free',
      tag: 'Free Trial',
      description: `Browse ${freeModels.length} free-tier models (zero credit cost)`,
    },
    {
      label: 'Paid Models',
      value: 'browse_paid',
      tag: 'Paid',
      description: `Browse ${paidModels.length} paid & frontier models from NVIDIA NIM`,
    },
    {
      label: 'Auto (Recommended Free-First)',
      value: 'auto',
      tag: 'Auto',
      description: 'Automatically select the highest rated free model (Nemotron-70B / Llama-3.3-70B)',
    },
    {
      label: 'Custom Model ID',
      value: 'custom',
      tag: 'Custom',
      description: 'Enter any custom NVIDIA NIM model identifier manually',
    },
  ];

  const pick = await askSelect('Select Model (Free or Paid):', topLevelChoices, 0, { signal });

  let chosenModelId: string | undefined = undefined;
  let isPaid = false;

  if (pick.value === 'current') {
    chosenModelId = activeModel;
    const meta = router.classifyModel(activeModel ?? '');
    isPaid = meta.accessTier === 'paid' || meta.accessTier === 'unknown';
  } else if (pick.value === 'auto') {
    chosenModelId = undefined;
    isPaid = false;
  } else if (pick.value === 'browse_free') {
    const choices: SelectOption[] = freeModels.slice(0, 15).map((m) => ({
      label: m.id,
      value: m.id,
      tag: 'Free Trial',
      description: m.desc,
    }));

    const modelPick = await askSelect('Choose Free Model:', choices, 0, { signal });
    chosenModelId = modelPick.value;
    isPaid = false;
  } else if (pick.value === 'browse_paid') {
    const choices: SelectOption[] = paidModels.slice(0, 15).map((m) => ({
      label: m.id,
      value: m.id,
      tag: 'Paid',
      description: m.desc,
    }));

    const modelPick = await askSelect('Choose Paid Model:', choices, 0, { signal });
    chosenModelId = modelPick.value;
    isPaid = true;
  } else if (pick.value === 'custom') {
    const customId = await askQuestion('Enter Model ID (e.g. meta/llama-3.3-70b-instruct): ', { signal });
    if (customId) {
      chosenModelId = customId;
      const meta = router.classifyModel(customId);
      isPaid = meta.accessTier === 'paid' || meta.accessTier === 'unknown';
    }
  }

  let savedAsDefault = false;
  if (options.saveSelectionByDefault !== false && chosenModelId) {
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
