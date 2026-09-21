import { NvidiaAdapter } from '@moderado/providers';
import { Router } from '@moderado/core';
import { askQuestion, askSelect, askModalChoice, SelectOption } from './prompt.js';
import {
  renderBoxLines,
  layerPromptBox,
  selectListPopup,
  selectConfirmPopup,
  type PopupListItem,
} from './popup.js';
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
  /**
   * When provided, the selection flow runs as a Cline/OpenCode-style popup
   * window: `drawFrame(popupLines)` composites the popup content as a floating
   * layer centered on top of the main app window (which stays as-is in the
   * background). Every step redraws the frame, so the popup never scrolls the
   * background. When omitted (standalone setup flows), rendering is inline.
   */
  drawFrame?: (popupLines: string[]) => void;
}

export interface CompatibleModelSelectorOptions {
  apiKey?: string;
  baseUrl: string;
  providerId: string;
  providerName: string;
  currentModel?: string;
  allModelsFree?: boolean;
  signal?: AbortSignal;
  drawFrame: (popupLines: string[]) => void;
}

export interface CompatibleModelEntry {
  id: string;
  pricing?: Record<string, string>;
}

let cachedInventory: { id: string }[] | null = null;

export function buildModelConnectionRequiredItems(): PopupListItem[] {
  return [
    {
      label: 'Connect NVIDIA NIM first',
      value: 'connect',
      description: 'Use /connect to add an NVIDIA NIM API key, then choose a model here.',
    },
    {
      label: 'Close Window',
      value: 'close',
      description: 'Return to the welcome window without changing anything.',
    },
  ];
}

export async function showModelConnectionRequired(
  drawFrame: (popupLines: string[]) => void,
  signal?: AbortSignal
): Promise<void> {
  await selectListPopup('Model Selection Window', buildModelConnectionRequiredItems(), {
    drawFrame,
    signal,
    hint: 'Enter or Esc close',
  });
}

export function buildCompatibleModelMenuItems(
  providerName: string,
  models: CompatibleModelEntry[],
  currentModel?: string,
  allModelsFree = false
): PopupListItem[] {
  const items: PopupListItem[] = [];
  if (allModelsFree && models.length > 0) {
    items.push({
      label: 'Browse available models',
      value: 'browse',
      tag: `${models.length} Free`,
      description: `Filter the live ${providerName} free model catalog.`,
    });
  } else {
    const freeCount = models.filter(isFreeCompatibleModel).length;
    if (freeCount > 0) {
      items.push({ label: 'Browse Free Models', value: 'free', tag: `${freeCount} Free`, description: `No-cost ${providerName} endpoints.` });
    }
  }
  items.push({
    label: 'Enter a model ID',
    value: 'custom',
    tag: 'Free',
    description: `Use any ${providerName} model ID, including one not returned by discovery.`,
  });
  if (currentModel) {
    items.push({
      label: 'Keep Current Model',
      value: 'keep',
      tag: currentModel,
      description: 'Close the window without switching models.',
    });
  }
  items.push({
    label: 'Cancel & Close Window',
    value: 'cancel',
    description: 'No changes will be made.',
  });
  return items;
}

function isFreeCompatibleModel(model: CompatibleModelEntry): boolean {
  const prices = Object.values(model.pricing ?? {});
  return prices.length > 0 && prices.every((price) => Number.isFinite(Number(price)) && Number(price) === 0);
}

function compatibleModelPopupItem(model: CompatibleModelEntry, allModelsFree: boolean, providerName: string): PopupListItem {
  const isFree = allModelsFree || isFreeCompatibleModel(model);
  const price = model.pricing?.prompt;
  return {
    label: model.id,
    value: model.id,
    tag: 'Free',
    description: isFree
      ? `${providerName} free model`
      : price
        ? `${providerName} model · input $${Number(price) * 1_000_000}/M tokens`
        : `${providerName} free model`,
  };
}

export async function selectCompatibleModelOverlay(
  options: CompatibleModelSelectorOptions
): Promise<string | undefined> {
  const { apiKey, baseUrl, providerId, providerName, currentModel, allModelsFree, signal, drawFrame } = options;
  let models: CompatibleModelEntry[] = [];
  try {
    layerPromptBox(drawFrame, `\x1b[36mQuerying ${providerName} model catalog...\x1b[0m`);
    const provider = new NvidiaAdapter({ apiKey, baseUrl, providerId, providerName });
    models = (await provider.discoverModels(signal))
      .map((model) => ({ id: model.id, pricing: model.pricing }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    // Explicit model entry remains available when a provider does not expose /models.
  }

  const picked = await selectListPopup(
    `${providerName} Free Models`,
    buildCompatibleModelMenuItems(providerName, models, currentModel, allModelsFree),
    { drawFrame, signal, pageSize: 8, hint: '↑↓ navigate · Enter select · Esc close' }
  );
  if (picked === null || picked === 'keep' || picked === 'cancel') return currentModel;
  if (picked === 'browse' || picked === 'free') {
    const visibleModels = allModelsFree ? models : models.filter(isFreeCompatibleModel);
    return (await selectListPopup(
      `${providerName} Free Models`,
      visibleModels.map((model) => compatibleModelPopupItem(model, allModelsFree ?? false, providerName)),
      { drawFrame, signal, filterable: true, pageSize: 10, hint: 'type to filter · ↑↓ navigate · Enter select · Esc close' }
    )) ?? currentModel;
  }
  return askCompatibleModelId(providerName, currentModel, drawFrame, signal);
}

async function askCompatibleModelId(
  providerName: string,
  currentModel: string | undefined,
  drawFrame: (popupLines: string[]) => void,
  signal?: AbortSignal
): Promise<string | undefined> {
  const stdin = process.stdin;
  let value = currentModel ?? '';
  const redraw = (): void => drawFrame(renderBoxLines(`${providerName} Models`, [
    '\x1b[1;38;5;75mModel ID\x1b[0m',
    '',
    `  \x1b[1;38;5;75m❯\x1b[0m ${value}\x1b[7m \x1b[0m`,
    '',
    '\x1b[38;5;244mEnter save · Esc cancel\x1b[0m',
  ], 64));

  return new Promise((resolve) => {
    const finish = (modelId: string | undefined): void => {
      stdin.removeListener('keypress', onKeypress);
      signal?.removeEventListener('abort', onAbort);
      resolve(modelId);
    };
    const onAbort = (): void => finish(undefined);
    const onKeypress = (str: string, key: { name?: string; ctrl?: boolean; meta?: boolean } | undefined): void => {
      if (key?.name === 'escape' || (key?.ctrl && key.name === 'c')) return finish(undefined);
      if (key?.name === 'return' || key?.name === 'enter') return finish(value.trim() || undefined);
      if (key?.name === 'backspace') { value = value.slice(0, -1); redraw(); return; }
      if (str && str.length === 1 && str.charCodeAt(0) >= 32 && !key?.ctrl && !key?.meta) { value += str; redraw(); }
    };
    if (signal?.aborted) return finish(undefined);
    signal?.addEventListener('abort', onAbort, { once: true });
    stdin.on('keypress', onKeypress);
    redraw();
  });
}

export function buildOverlayMenuItems(
  freeModelIds: string[], freeCount: number, paidCount: number, activeModel?: string
): PopupListItem[] {
  const popular = [
    { label: 'Nemotron 3 Ultra Free', match: (id: string) => /nemotron.*3.*ultra/i.test(id) },
    { label: 'Nemotron 3.5 Lightning Free', match: (id: string) => /nemotron.*3.*5.*lightning|nemotron.*lightning/i.test(id) },
    { label: 'z-ai/glm-5.3-flash', match: (id: string) => id.toLowerCase() === 'z-ai/glm-5.3-flash' },
  ];
  const items: PopupListItem[] = popular.flatMap(({ label, match }) => {
    const id = freeModelIds.find(match);
    return id ? [{ label, value: `model:${id}`, tag: 'Free', description: id }] : [];
  });
  items.push(
    { label: 'Browse Free Models', value: 'free', tag: `${freeCount} Free`, description: 'Scan the live NVIDIA NIM free catalog' },
    { label: 'Browse Paid Models', value: 'paid', tag: `${paidCount} Paid`, description: 'Scan paid and frontier NVIDIA NIM models' },
    { label: 'Search Full Catalog', value: 'search', description: 'Type to filter every discovered NIM model' },
    { label: 'Auto Routing', value: 'auto', tag: 'Recommended', description: 'Use free-first automatic routing' },
  );
  if (activeModel) items.push({ label: 'Keep Current Model', value: 'keep', tag: activeModel, description: 'Close without changing models' });
  items.push({ label: 'Cancel & Close Window', value: 'cancel', description: 'No changes · Esc also closes this window' });
  return items;
}

export async function selectModelInteractive(
  options: ModelSelectorOptions = {}
): Promise<ModelSelectionResult> {
  const isTty = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  if (isTty) {
    process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[H\x1b[2J');
  }
  try {
    return await executeModelSelection(options);
  } finally {
    if (isTty) {
      process.stdout.write('\x1b[?25h\x1b[?1049l');
    }
  }
}

/**
 * Same model selection flow as selectModelInteractive, but rendered as a
 * floating popup window layered on top of the main app window (background
 * stays as-is). Used by the TUI /model popup via the drawFrame callback.
 */
export async function selectModelOverlay(
  options: ModelSelectorOptions = {}
): Promise<ModelSelectionResult> {
  // No alternate screen — the caller is responsible for repainting the background.
  return executeModelSelection(options);
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
    if (options.drawFrame) {
      // Layer mode: show the query status inside the popup window itself.
      layerPromptBox(options.drawFrame, '\x1b[36mQuerying NVIDIA NIM model catalog...\x1b[0m');
    } else {
      process.stdout.write('\n\x1b[36mQuerying NVIDIA NIM model catalog...\x1b[0m\n');
    }
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

  const cols = process.stdout.columns || 80;
  const boxWidth = Math.min(Math.max(62, Math.min(cols - 4, 72)), cols);
  const popupLines = renderBoxLines('Model Selection Window', menuLines, boxWidth);
  const layer = options.drawFrame;

  if (options.drawFrame) {
    // Popup window mode: Cline/OpenCode-style interactive list window layered
    // on top of the main app window (background stays as-is underneath).
    const menuItems: PopupListItem[] = [
      {
        label: 'Search by keyword',
        value: 'search',
        description: 'Type-to-filter across the full NVIDIA NIM catalog',
      },
      {
        label: 'Free Trial Models',
        value: 'free',
        tag: `${freeModels.length}`,
        description: 'Free trial endpoints — ready to use, no cost',
      },
      {
        label: 'Paid & Frontier Models',
        value: 'paid',
        tag: `${paidModels.length}`,
        description: 'Flagship and paid-tier models',
      },
      {
        label: 'Complete Catalog',
        value: 'all',
        tag: `${discoveredEntries.length}`,
        description: 'Every discovered NVIDIA NIM endpoint',
      },
      {
        label: 'Auto Routing',
        value: 'auto',
        description: 'Free-first recommended routing',
      },
    ];
    if (activeModel) {
      menuItems.push({
        label: 'Keep Current',
        value: 'keep',
        tag: activeModel,
        description: 'Close the window without switching models',
      });
    }
    menuItems.push({
      label: 'Cancel & Close Window',
      value: 'cancel',
      description: 'No changes will be made',
    });
    menuItems.splice(
      0,
      menuItems.length,
      ...buildOverlayMenuItems(
        freeModels.map((model) => model.id), freeModels.length, paidModels.length, activeModel
      )
    );

    const picked = await selectListPopup('Model Selection Window', menuItems, {
      signal,
      drawFrame: options.drawFrame,
      pageSize: 9,
      hint: '↑↓ navigate · Enter select · Esc close',
    });
    if (picked === null || picked === 'keep' || picked === 'cancel') {
      return {
        modelId: activeModel,
        allowPaid: config.allowPaid ?? false,
        allowUnknown: config.allowUnknown ?? false,
        savedAsDefault: false,
      };
    }

    let chosenModelId: string | undefined = undefined;
    let isPaid = false;

    if (picked.startsWith('model:')) {
      chosenModelId = picked.slice('model:'.length);
      isPaid = false;
    } else if (picked === 'auto') {
      chosenModelId = 'auto';
      isPaid = false;
    } else if (picked === 'free') {
      chosenModelId = await pickFromList('Choose Free Model:', freeModels.map((m) => m.id), router, signal, layer);
      isPaid = false;
    } else if (picked === 'paid') {
      chosenModelId = await browseOrSearchList('Paid & Frontier Models:', paidModels.map((m) => m.id), router, signal, layer);
      isPaid = true;
    } else if (picked === 'all') {
      chosenModelId = await browseOrSearchList('All NVIDIA NIM Models:', discoveredEntries.map((m) => m.id), router, signal, layer);
      if (chosenModelId) {
        const meta = router.classifyModel(chosenModelId);
        isPaid = meta.accessTier === 'paid' || meta.accessTier === 'unknown';
      }
    } else {
      // Search by keyword: interactive type-to-filter popup over the catalog.
      chosenModelId = await searchAndSelect('', discoveredEntries.map((m) => m.id), router, signal, layer);
      if (chosenModelId) {
        const meta = router.classifyModel(chosenModelId);
        isPaid = meta.accessTier === 'paid' || meta.accessTier === 'unknown';
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
      const shouldSave = await selectConfirmPopup(
        'Save Default Model',
        [
          `\x1b[32m✔ Selected model:\x1b[0m \x1b[1m${chosenModelId}\x1b[0m`,
          'Save as persistent default in ~/.moderado/config.json?',
        ],
        { signal, drawFrame: options.drawFrame }
      );
      if (shouldSave === true) {
        saveConfig({
          defaultModel: chosenModelId,
          allowPaid: isPaid ? true : config.allowPaid,
          allowUnknown: isPaid ? true : config.allowUnknown,
        });
        layerPromptBox(options.drawFrame, `\x1b[32m✔ Saved ${chosenModelId} as default model.\x1b[0m`);
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

  // ── Standalone setup mode: inline number-menu flow (unchanged) ────────────
  const leftPad = Math.max(0, Math.floor((cols - boxWidth) / 2));
  const pad = ' '.repeat(leftPad);
  process.stdout.write('\n' + popupLines.map((l) => pad + l).join('\n') + '\n');

  const maxOption = activeModel ? 6 : 5;
  const promptMsg =
    (options.drawFrame ? '\n' : '') +
    `\x1b[38;5;244mSelect [1-${maxOption}], [Esc]/[Enter] to close, or type keyword:\x1b[0m `;
  const input = await askModalChoice(promptMsg, { signal });

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
    chosenModelId = await pickFromList('Choose Free Model:', freeModels.map((m) => m.id), router, signal, layer);
    isPaid = false;
  } else if (normalized === '3' || normalized === 'paid') {
    // Browse paid models with search or list
    chosenModelId = await browseOrSearchList('Paid & Frontier Models:', paidModels.map((m) => m.id), router, signal, layer);
    isPaid = true;
  } else if (normalized === '4' || normalized === 'all') {
    // Browse all models with search or list
    chosenModelId = await browseOrSearchList('All NVIDIA NIM Models:', discoveredEntries.map((m) => m.id), router, signal, layer);
    if (chosenModelId) {
      const meta = router.classifyModel(chosenModelId);
      isPaid = meta.accessTier === 'paid' || meta.accessTier === 'unknown';
    }
  } else {
    // Keyword search or direct selection (e.g. "1", "glm", "flash", "z-ai/glm-5.3-flash")
    let searchTerm = input.trim();
    if (searchTerm === '1' || !searchTerm) {
      if (layer) {
        layerPromptBox(layer, 'Enter search term or model ID (e.g. "glm", "flash", "llama"):');
        searchTerm = await askModalChoice('\n> ', { signal });
      } else {
        searchTerm = await askQuestion('Enter search term or model ID (e.g. "glm", "flash", "llama"): ', { signal });
      }
    }

    if (!searchTerm) {
      return {
        modelId: activeModel,
        allowPaid: config.allowPaid ?? false,
        allowUnknown: config.allowUnknown ?? false,
        savedAsDefault: false,
      };
    } else {
      chosenModelId = await searchAndSelect(searchTerm, discoveredEntries.map((m) => m.id), router, signal, layer);
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
    if (layer) {
      layerPromptBox(layer, [
        `\x1b[32m✔ Selected model:\x1b[0m \x1b[1m${chosenModelId}\x1b[0m`,
        `Save as persistent default model in ~/.moderado/config.json? [Y/n]`,
      ]);
    } else {
      process.stdout.write(`\n\x1b[32m✔ Selected model:\x1b[0m \x1b[1m${chosenModelId}\x1b[0m\n`);
    }
    const shouldSave = layer
      ? await askModalChoice('\n> ', { signal })
      : await askQuestion(
          `Save ${chosenModelId} as persistent default model in ~/.moderado/config.json? [Y/n]: `,
          { signal }
        );
    if (shouldSave.toLowerCase() !== 'n' && shouldSave.toLowerCase() !== 'no') {
      saveConfig({
        defaultModel: chosenModelId,
        allowPaid: isPaid ? true : config.allowPaid,
        allowUnknown: isPaid ? true : config.allowUnknown,
      });
      if (layer) {
        layerPromptBox(layer, `\x1b[32m✔ Saved ${chosenModelId} as default model.\x1b[0m`);
      } else {
        process.stdout.write(`\x1b[32m✔ Saved ${chosenModelId} as default model.\x1b[0m\n\n`);
      }
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
  signal?: AbortSignal,
  layer?: (popupLines: string[]) => void
): Promise<string> {
  // Layer mode: Cline-style interactive type-to-filter popup. The filter is
  // built into the list window itself; Esc opens a retry/custom-ID/cancel
  // menu so the "custom Model ID" escape hatch is preserved.
  if (layer) {
    const tier = (id: string): string => {
      const meta = router.classifyModel(id);
      return meta.accessTier === 'free_trial' ? 'Free' : meta.accessTier === 'paid' ? 'Paid' : 'NIM';
    };
    while (!signal?.aborted) {
      const items: PopupListItem[] = allModelIds.map((id) => ({
        label: id,
        value: id,
        tag: tier(id),
        description: tier(id) === 'Free' ? 'Free trial endpoint' : tier(id) === 'Paid' ? 'Paid model' : 'Unclassified NIM endpoint',
      }));
      const picked = await selectListPopup('Search Models', items, {
        signal,
        drawFrame: layer,
        filterable: true,
        initialFilter: initialQuery,
        pageSize: 10,
        hint: 'type to filter · ↑↓ navigate · Enter select · Esc menu',
      });
      if (picked !== null) return picked;

      // Esc: retry with a new keyword, use a custom ID, or cancel.
      const action = await selectListPopup('Search Models', [
        { label: 'Try another search keyword', value: 'retry', description: 'Reopen the filter popup' },
        { label: 'Cancel search', value: 'cancel', description: 'Go back without switching' },
      ], { signal, drawFrame: layer, pageSize: 5 });
      if (action === 'retry') continue;
      return '';
    }
    return '';
  }

  let currentQuery = initialQuery;
  const rows = process.stdout.rows || 24;
  const maxList = Math.max(5, Math.min(15, rows - 12));

  while (!signal?.aborted) {
    const q = currentQuery.trim().toLowerCase();

    // Check exact match first
    const exact = allModelIds.find((id) => id.toLowerCase() === q);
    if (exact) {
      const meta = router.classifyModel(exact);
      if (layer) {
        layerPromptBox(layer, [
          `Selected: \x1b[1m${exact}\x1b[0m [${meta.accessTier}]`,
          'Confirm? [Y/n, or type new keyword]',
        ]);
      } else {
        process.stdout.write(`\nSelected: ${exact} [${meta.accessTier}]. Confirm? [Y/n, or type new keyword]: `);
      }
      const conf = layer ? await askModalChoice('\n> ', { signal }) : await askQuestion('', { signal });
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
      if (layer) {
        layerPromptBox(layer, [
          `\x1b[33mNo catalog model found matching "${currentQuery}".\x1b[0m`,
          '---',
          '  [1] Try another search keyword',
          `  [2] Use "${currentQuery}" as custom Model ID`,
          '  [3] Cancel search',
        ]);
      } else {
        process.stdout.write(`\n\x1b[33mNo catalog model found matching "${currentQuery}".\x1b[0m\n`);
        process.stdout.write('  \x1b[1m[1]\x1b[0m Try another search keyword\n');
        process.stdout.write(`  \x1b[1m[2]\x1b[0m Use "${currentQuery}" as custom Model ID\n`);
        process.stdout.write('  \x1b[1m[3]\x1b[0m Cancel search\n');
      }
      const action = layer
        ? await askModalChoice('\n> ', { signal })
        : await askQuestion('Select [1-3] or type a new search keyword: ', { signal });
      const actNorm = action.trim().toLowerCase();
      if (actNorm === '2') {
        return currentQuery.trim();
      } else if (actNorm === '3' || actNorm === 'cancel' || actNorm === 'exit' || actNorm === 'q') {
        return '';
      } else if (actNorm === '1') {
        const next = await askFlowText(layer, 'Enter new search keyword: ', { signal });
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
      if (layer) {
        layerPromptBox(layer, [
          `\x1b[32mFound 1 matching model:\x1b[0m \x1b[1m${matches[0]}\x1b[0m [${meta.accessTier}]`,
          'Select this model? [Y/n, or type a new keyword]',
        ]);
      } else {
        process.stdout.write(`\n\x1b[32mFound 1 matching model:\x1b[0m \x1b[1m${matches[0]}\x1b[0m [${meta.accessTier}]\n`);
      }
      const conf = layer ? await askModalChoice('\n> ', { signal }) : await askQuestion('', { signal });
      const confNorm = conf.trim().toLowerCase();
      if (!confNorm || confNorm === 'y' || confNorm === 'yes') {
        return matches[0];
      }
      if (confNorm !== 'n' && confNorm !== 'no') {
        currentQuery = conf.trim();
        continue;
      }
      const next = await askFlowText(layer, 'Enter new search keyword (or press Enter to cancel): ', { signal });
      if (!next) return '';
      currentQuery = next;
      continue;
    }

    // Multiple matches
    if (layer) {
      const lines = [`\x1b[1mFound ${matches.length} models matching "${currentQuery}":\x1b[0m`, '---'];
      for (let i = 0; i < Math.min(matches.length, maxList); i++) {
        const meta = router.classifyModel(matches[i]);
        const tag = meta.accessTier === 'free_trial' ? 'Free Trial' : 'Paid';
        lines.push(`  \x1b[1m[${i + 1}]\x1b[0m ${matches[i]} \x1b[36m[${tag}]\x1b[0m`);
      }
      if (matches.length > maxList) {
        lines.push(`  \x1b[90m... and ${matches.length - maxList} more — refine the keyword\x1b[0m`);
      }
      lines.push('  [s] Search again with a different keyword');
      lines.push('  [b] Back to main menu');
      layerPromptBox(layer, lines);
    } else {
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
    }

    const choice = layer
      ? await askModalChoice('\n> ', { signal })
      : await askQuestion(`Select [1-${matches.length}], "s" to search again, or type a new keyword: `, { signal });
    const choiceNorm = choice.trim().toLowerCase();

    if (choiceNorm === 'b' || choiceNorm === 'back' || choiceNorm === 'q') {
      return '';
    }

    if (choiceNorm === 's' || choiceNorm === 'search') {
      const next = await askFlowText(layer, 'Enter new search keyword: ', { signal });
      if (!next) return '';
      currentQuery = next;
      continue;
    }

    const num = parseInt(choice, 10);
    if (!isNaN(num) && num >= 1 && num <= (layer ? Math.min(matches.length, maxList) : matches.length)) {
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
  signal?: AbortSignal,
  layer?: (popupLines: string[]) => void
): Promise<string> {
  if (layer) {
    // Layer mode: Cline-style interactive filter popup — type-to-filter is
    // built into the list window itself.
    const items: PopupListItem[] = modelIds.map((id) => {
      const meta = router.classifyModel(id);
      const tier = meta.accessTier;
      return {
        label: id,
        value: id,
        tag: tier === 'free_trial' ? 'Free' : tier === 'paid' ? 'Paid' : 'NIM',
        description:
          tier === 'free_trial'
            ? 'Free trial endpoint'
            : tier === 'paid'
              ? 'Paid model'
              : 'Unclassified NIM endpoint',
      };
    });
    return (await selectListPopup(title, items, {
      signal,
      drawFrame: layer,
      filterable: true,
      pageSize: 10,
    })) ?? '';
  }

  process.stdout.write(`\n\x1b[1m${title}\x1b[0m (${modelIds.length} models)\n`);
  const filter = await askModalChoice('Filter by keyword (e.g. "glm", "flash", "coder"), [Esc] to cancel, or press Enter to list all: ', { signal });

  if (filter === 'q') return '';

  if (filter.trim()) {
    return searchAndSelect(filter.trim(), modelIds, router, signal);
  }

  return pickFromList(title, modelIds, router, signal);
}

/**
 * Text input that works in both modes: inside the popup layer (raw keys, the
 * prompt box above is redrawn by the layer) or inline (line-based readline).
 */
async function askFlowText(
  layer: ((popupLines: string[]) => void) | undefined,
  promptMsg: string,
  options: { signal?: AbortSignal }
): Promise<string> {
  if (layer) {
    layerPromptBox(layer, promptMsg.replace(/:\s*$/, ':'));
    return askModalChoice('\n> ', options);
  }
  return askQuestion(promptMsg, options);
}

async function pickFromList(
  title: string,
  modelIds: string[],
  router: Router,
  signal?: AbortSignal,
  layer?: (popupLines: string[]) => void
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

  if (layer) {
    // Layer mode: Cline-style interactive list popup with type-to-filter.
    const items: PopupListItem[] = choices.map((c) => ({
      label: c.label,
      value: c.value,
      tag: c.tag,
      description:
        c.tag === 'Free'
          ? 'Free trial endpoint'
          : c.tag === 'Paid'
            ? 'Paid model'
            : 'Unclassified NIM endpoint',
    }));
    return (await selectListPopup(title, items, {
      signal,
      drawFrame: layer,
      filterable: true,
      pageSize: 10,
    })) ?? '';
  }

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
        ? `Select [1-${pageChoices.length}], [Esc] to cancel, or press Enter for next page: `
        : `Select [1-${pageChoices.length}] or [Esc] to cancel: `;

      const answer = await askModalChoice(promptMsg, { signal });
      if (answer === 'q') return '';
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
