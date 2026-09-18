import { ProviderConnection } from '../config.js';
import { askQuestion, askSecret, askSelect } from './prompt.js';

export interface ConnectionInput {
  kind: ProviderConnection['kind'];
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
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
export async function connectProviderInteractive(signal?: AbortSignal): Promise<ProviderConnection | undefined> {
  const selected = await askSelect('Connect a provider', [
    { label: 'NVIDIA NIM', value: 'nvidia-nim', tag: 'Free-first', description: 'Use NVIDIA NIM with automatic free-model routing.' },
    { label: 'OpenAI-compatible endpoint', value: 'openai-compatible', description: 'OpenRouter, Z.AI, DeepSeek, Moonshot, Mistral, or another compatible API.' },
  ], 0, { signal });

  if (signal?.aborted) return undefined;
  if (selected.value === 'nvidia-nim') {
    process.stdout.write('\nGet an NVIDIA API key at https://build.nvidia.com\n');
    const apiKey = await askSecret('NVIDIA_API_KEY (Enter to cancel): ', { signal });
    if (!apiKey) return undefined;
    return buildConnection({ kind: 'nvidia-nim', apiKey });
  }

  const displayName = await askQuestion('Provider name (for example, OpenRouter): ', { signal });
  if (!displayName) return undefined;
  const baseUrl = await askQuestion('OpenAI-compatible base URL: ', { signal });
  const apiKey = await askSecret('API key (Enter to cancel): ', { signal });
  const defaultModel = await askQuestion('Default model ID: ', { signal });
  if (!baseUrl || !apiKey || !defaultModel) return undefined;
  return buildConnection({ kind: 'openai-compatible', displayName, baseUrl, apiKey, defaultModel });
}
