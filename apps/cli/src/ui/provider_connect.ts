import { ProviderConnection } from '../config.js';
import { askQuestion, askSecret, askSelect } from './prompt.js';
import { renderBoxLines, selectListPopup } from './popup.js';
import { fetchOpenRouterFreeModels } from '@moderado/providers';
import type { ModelInventoryEntry } from '@moderado/contracts';

export interface ConnectionInput {
  kind: ProviderConnection['kind'];
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
}

export interface PopupConnectionOptions {
  signal?: AbortSignal;
  drawFrame?: (popupLines: string[]) => void;
  savedConnections?: Record<string, ProviderConnection>;
  resolveSavedConnection?: (connection: ProviderConnection) => Promise<ProviderConnection>;
}

export interface ProviderPreset {
  label: string;
  value: 'nvidia-nim' | 'openrouter' | 'agnes-ai' | 'openai-compatible';
  description: string;
  tag?: string;
  displayName?: string;
  baseUrl?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { label: 'NVIDIA NIM', value: 'nvidia-nim', tag: 'Default · Free-first', description: 'Use NVIDIA NIM with automatic free-model routing.' },
  { label: 'OpenRouter', value: 'openrouter', tag: 'OpenAI-compatible', displayName: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', description: 'Connect your OpenRouter key and choose a model ID.' },
  { label: 'Agnes AI', value: 'agnes-ai', tag: 'OpenAI-compatible', displayName: 'Agnes AI', baseUrl: 'https://apihub.agnes-ai.com/v1', description: 'Connect your Agnes AI key and choose a model ID.' },
  { label: 'Other OpenAI-compatible provider', value: 'openai-compatible', description: 'Connect any compatible endpoint with its base URL, key, and model ID.' },
];

export function findReusableConnection(preset: ProviderPreset['value'], connections?: Record<string, ProviderConnection>): ProviderConnection | undefined {
  if (preset === 'openai-compatible') return undefined;
  const id = preset === 'nvidia-nim' ? 'nvidia-nim' : preset;
  return connections?.[id];
}

export function isAuthenticationFailure(error: unknown): boolean {
  return error instanceof Error && /authentication failed \((401|403)\)/i.test(error.message);
}

export function renderConnectionPrompt(label: string, value: string, secret = false): string[] {
  const shown = secret ? '*'.repeat(value.length) : value;
  return renderBoxLines('Connect Provider', [
    `\x1b[1;38;5;75m${label}\x1b[0m`,
    '',
    `  \x1b[1;38;5;75m❯\x1b[0m ${shown}\x1b[7m \x1b[0m`,
    '',
    '\x1b[38;5;244mEnter continue · Esc cancel\x1b[0m',
  ], 64);
}

async function askPopupText(label: string, options: PopupConnectionOptions, secret = false): Promise<string | undefined> {
  if (!options.drawFrame) {
    return secret ? askSecret(`${label}: `, { signal: options.signal }) : askQuestion(`${label}: `, { signal: options.signal });
  }

  const stdin = process.stdin;
  let value = '';
  return new Promise((resolve) => {
    const finish = (answer: string | undefined): void => {
      stdin.removeListener('keypress', onKeypress);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(answer);
    };
    const redraw = () => options.drawFrame!(renderConnectionPrompt(label, value, secret));
    const onAbort = () => finish(undefined);
    const onKeypress = (str: string, key: any): void => {
      if (key?.name === 'escape' || (key?.ctrl && key.name === 'c')) return finish(undefined);
      if (key?.name === 'return' || key?.name === 'enter') return finish(value.trim());
      if (key?.name === 'backspace') { value = value.slice(0, -1); redraw(); return; }
      if (str && str.length === 1 && str.charCodeAt(0) >= 32 && !key?.ctrl && !key?.meta) { value += str; redraw(); }
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    stdin.on('keypress', onKeypress);
    redraw();
  });
}

function connectionId(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'provider';
}

/** Validate and normalize a profile before it reaches persistent config. */
export function buildConnection(input: ConnectionInput): ProviderConnection {
  if (input.kind === 'nvidia-nim') {
    if (!input.apiKey?.trim()) throw new Error('An NVIDIA API key is required.');
    return {
      id: 'nvidia-nim',
      displayName: 'NVIDIA NIM',
      kind: 'nvidia-nim',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: input.apiKey.trim(),
    };
  }

  const displayName = input.displayName?.trim() || 'OpenAI-compatible provider';
  const defaultModel = input.defaultModel?.trim();
  if (!defaultModel) throw new Error('A default model is required for an OpenAI-compatible provider.');
  if (!input.apiKey?.trim()) throw new Error('An API key is required.');
  if (!input.baseUrl?.trim()) throw new Error('A base URL is required.');

  let url: URL;
  try { url = new URL(input.baseUrl.trim()); } catch { throw new Error('Enter a valid provider base URL.'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname))) {
    throw new Error('Provider base URLs must use HTTPS (HTTP is allowed only for localhost).');
  }

  return {
    id: connectionId(displayName),
    displayName,
    kind: 'openai-compatible',
    baseUrl: url.toString().replace(/\/+$/, ''),
    apiKey: input.apiKey.trim(),
    defaultModel,
  };
}

/** Interactive setup used by /connect and by the first attempted prompt. */
export async function connectProviderInteractive(options: PopupConnectionOptions = {}): Promise<ProviderConnection | undefined> {
  const choices = PROVIDER_PRESETS;
  const selectedValue = options.drawFrame
    ? await selectListPopup('Connect Provider', choices, { drawFrame: options.drawFrame, signal: options.signal, hint: '↑↓ choose · Enter continue · Esc cancel' })
    : (await askSelect('Connect a provider', choices, 0, { signal: options.signal })).value;
  if (!selectedValue) return undefined;

  if (options.signal?.aborted) return undefined;
  const saved = findReusableConnection(selectedValue as ProviderPreset['value'], options.savedConnections);
  if (saved && options.resolveSavedConnection) {
    try {
      const resolved = await options.resolveSavedConnection(saved);
      if (resolved.apiKey?.trim()) return resolved;
    } catch {
      // Continue to key entry when the credential service is unavailable.
    }
  }
  if (selectedValue === 'nvidia-nim') {
    const apiKey = await askPopupText('NVIDIA API key', options, true);
    if (!apiKey) return undefined;
    return buildConnection({ kind: 'nvidia-nim', apiKey });
  }

  const preset = PROVIDER_PRESETS.find((item) => item.value === selectedValue);
  const displayName = preset?.displayName ?? await askPopupText('Provider name (for example, OpenRouter)', options);
  if (!displayName) return undefined;
  const baseUrl = preset?.baseUrl ?? await askPopupText('OpenAI-compatible base URL', options);
  const apiKey = await askPopupText('API key', options, true);
  let defaultModel: string | undefined;
  if (selectedValue === 'openrouter') {
    // Free-first: offer the live free-model catalog (no key needed to list);
    // fall back to manual entry on any discovery failure.
    let freeModels: ModelInventoryEntry[] = [];
    try { freeModels = await fetchOpenRouterFreeModels({ signal: options.signal }); } catch { /* fall through to manual */ }
    if (freeModels.length > 0) {
      const choices = [
        ...freeModels.slice(0, 50).map((entry) => ({
          label: entry.id,
          value: entry.id,
          description: 'Free tier model',
        })),
        { label: 'Enter a model ID manually', value: '__manual__', description: 'Any OpenRouter model ID' },
      ];
      const picked = options.drawFrame
        ? await selectListPopup('Choose a free model', choices, { drawFrame: options.drawFrame, signal: options.signal, hint: '↑↓ choose · Enter continue · Esc cancel' })
        : (await askSelect('Choose a free model', choices, 0, { signal: options.signal })).value;
      if (!picked) return undefined;
      defaultModel = picked === '__manual__' ? undefined : picked;
    }
  }
  defaultModel = defaultModel ?? await askPopupText('Default model ID', options);
  if (!baseUrl || !apiKey || !defaultModel) return undefined;
  return buildConnection({ kind: 'openai-compatible', displayName, baseUrl, apiKey, defaultModel });
}

/** Ask for a replacement key after a provider rejects its saved credential. */
export async function replaceProviderKeyInteractive(connection: ProviderConnection, options: PopupConnectionOptions = {}): Promise<ProviderConnection | undefined> {
  const apiKey = await askPopupText(`${connection.displayName} API key`, options, true);
  return apiKey ? { ...connection, apiKey } : undefined;
}
