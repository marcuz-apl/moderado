import { freeModelPolicyFor, resolveModeradoCloudBaseUrl, type ConnectProvidersConfig, type ProviderConnection, type ConnectProviderPresetId } from '../config.js';
import { isFreeModelOption } from '../model_pricing.js';
import { askQuestion, askSecret, askSelect } from './prompt.js';
import { renderBoxLines, selectListPopup } from './popup.js';
import { fetchOpenRouterFreeModels, fetchProviderModels } from '@moderado/providers';
import type { ModelInventoryEntry } from '@moderado/contracts';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createModeradoOAuthRequest, exchangeModeradoOAuthCode, validateModeradoOAuthCallback } from '../moderado_oauth.js';

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
  connectProviders?: ConnectProvidersConfig;
  gatewayUrl?: string;
}

export type ProviderPresetValue = ConnectProviderPresetId | `custom:${string}`;

export interface ProviderPreset {
  label: string;
  value: ProviderPresetValue;
  description: string;
  tag?: string;
  displayName?: string;
  baseUrl?: string;
  defaultModel?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { label: 'NVIDIA NIM', value: 'nvidia-nim', tag: 'Default · Free-first', description: 'Use NVIDIA NIM with automatic free-model routing.' },
  { label: 'OpenRouter', value: 'openrouter', tag: 'Free Models', displayName: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', description: 'Connect your OpenRouter key to access free tier models.' },
  { label: 'Agnes AI', value: 'agnes-ai', tag: 'Free Models', displayName: 'Agnes AI', baseUrl: 'https://apihub.agnes-ai.com/v1', description: 'Connect your Agnes AI key to access free endpoints.' },
  { label: 'OrcaRouter', value: 'orcarouter', tag: 'Free Models', displayName: 'OrcaRouter', baseUrl: 'https://api.orcarouter.ai/v1', defaultModel: 'orcarouter/free', description: 'Connect OrcaRouter for adaptive model routing.' },
  { label: 'Ollama', value: 'ollama', tag: 'Local', displayName: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', description: 'Use models served locally by Ollama.' },
  { label: 'LM Studio', value: 'lm-studio', tag: 'Local', displayName: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', description: 'Use models served by LM Studio local server.' },
  { label: 'Other OpenAI-compatible provider', value: 'openai-compatible', description: 'Connect any compatible endpoint with its base URL, key, and model ID.' },
];

export function buildProviderPresets(config?: ConnectProvidersConfig): ProviderPreset[] {
  const enabled = config?.enabled;
  const builtIns = enabled === undefined
    ? PROVIDER_PRESETS
    : PROVIDER_PRESETS.filter((preset) => enabled.includes(preset.value as ConnectProviderPresetId));
  const custom = (config?.custom ?? []).map((provider): ProviderPreset => ({
    label: provider.name,
    value: `custom:${provider.id}`,
    tag: 'Custom',
    displayName: provider.name,
    baseUrl: provider.baseUrl,
    defaultModel: provider.defaultModel,
    description: 'Connect this custom OpenAI-compatible endpoint.',
  }));
  return [...builtIns, ...custom];
}

export function findReusableConnection(preset: ProviderPresetValue, connections?: Record<string, ProviderConnection>): ProviderConnection | undefined {
  if (preset === 'openai-compatible') return undefined;
  const id = preset.startsWith('custom:') ? preset.slice('custom:'.length) : preset;
  return connections?.[id];
}

export function isAuthenticationFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (error as Error & { code?: string }).code === 'ERR_GATEWAY_UNAUTHORIZED'
    || /authentication failed \((401|403)\)/i.test(error.message);
}

export function isModeradoCloudOAuthConnection(connection: ProviderConnection): boolean {
  return connection.id === 'moderado-cloud' && connection.credentialExpiresAt !== undefined;
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
  if (!input.apiKey?.trim() && !['ollama', 'lm-studio', 'moderado-cloud'].includes(connectionId(displayName))) throw new Error('An API key is required.');
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
    apiKey: input.apiKey?.trim() || undefined,
    defaultModel,
  };
}

/** Build a public Gateway profile or a keyed account profile. */
export function buildModeradoCloudConnection(apiKey?: string, credentialExpiresAt?: number, gatewayUrl?: string): ProviderConnection {
  const key = apiKey?.trim();
  if (key && !/^mrd_.+/.test(key)) throw new Error('Enter a Moderado Cloud key starting with mrd_.');
  const connection = buildConnection({
    kind: 'openai-compatible',
    displayName: 'Moderado Cloud',
    baseUrl: resolveModeradoCloudBaseUrl(
      process.env.MODERADO_CLOUD_ENV,
      process.env.MODERADO_CLOUD_BASE_URL ?? gatewayUrl,
    ),
    apiKey: key,
    defaultModel: 'auto',
  });
  return credentialExpiresAt === undefined ? connection : { ...connection, credentialExpiresAt };
}

function openAuthorizationPage(url: string): void {
  const [program, args] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(program, args, { shell: false, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => process.stderr.write(`Could not open a browser automatically. Visit ${url} to continue Moderado login.\n`));
  child.unref();
}

async function authorizeModeradoCloudInBrowser(signal?: AbortSignal): Promise<{ accessToken: string; expiresAt: number } | undefined> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('Could not start the Moderado login callback.'); }
  const request = createModeradoOAuthRequest(`http://127.0.0.1:${address.port}/callback`);
  try {
    const code = await new Promise<string | undefined>((resolve, reject) => {
      let settled = false;
      const finish = (value?: string, error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        error ? reject(error) : resolve(value);
      };
      const onAbort = () => finish(undefined);
      const timeout = setTimeout(() => finish(undefined, new Error('Moderado browser login timed out. Run /login to try again.')), 5 * 60_000);
      signal?.addEventListener('abort', onAbort, { once: true });
      server.on('request', (incoming, response) => {
        if (incoming.method !== 'GET') { response.writeHead(405).end(); return; }
        let authCode: string;
        try {
          authCode = validateModeradoOAuthCallback(incoming.url ?? '/', request);
        } catch {
          response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Login could not be verified. Return to Moderado CLI and try /login again.');
          finish(undefined, new Error('Moderado browser login callback could not be verified.'));
          return;
        }
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Moderado login complete. You can close this tab.');
        finish(authCode);
      });
      openAuthorizationPage(request.authorizationUrl);
    });
    return code ? await exchangeModeradoOAuthCode(code, request) : undefined;
  } finally {
    server.close();
  }
}

export async function loginModeradoCloudInteractive(options: PopupConnectionOptions = {}): Promise<ProviderConnection | undefined> {
  const baseUrl = resolveModeradoCloudBaseUrl(
    process.env.MODERADO_CLOUD_ENV,
    process.env.MODERADO_CLOUD_BASE_URL ?? options.gatewayUrl,
  );
  const loginChoices = [
    { label: 'Use public Gateway', value: 'public', description: `Connect without an account or API key. Base URL: ${baseUrl}` },
    { label: 'Sign in with browser', value: 'browser', description: `Authorize Moderado Cloud in your browser. Base URL: ${baseUrl}` },
    { label: 'Enter an API key', value: 'manual', description: `Paste a Moderado Cloud key starting with mrd_. Base URL: ${baseUrl}` },
  ];
  const method = options.drawFrame
    ? await selectListPopup('Connect Moderado Cloud', loginChoices, { drawFrame: options.drawFrame, signal: options.signal })
    : (await askSelect('Connect Moderado Cloud', loginChoices, 0, { signal: options.signal })).value;
  if (!method || options.signal?.aborted) return undefined;
  if (method === 'public') return buildModeradoCloudConnection(undefined, undefined, options.gatewayUrl);
  if (method === 'browser') {
    const credential = await authorizeModeradoCloudInBrowser(options.signal);
    return credential ? buildModeradoCloudConnection(credential.accessToken, credential.expiresAt, options.gatewayUrl) : undefined;
  }
  let prompt = 'Moderado Cloud API key (mrd_…)';
  while (!options.signal?.aborted) {
    const apiKey = await askPopupText(prompt, options, true);
    if (!apiKey) return undefined;
    try {
      return buildModeradoCloudConnection(apiKey, undefined, options.gatewayUrl);
    } catch (error) {
      prompt = `Invalid key: ${error instanceof Error ? error.message : String(error)} Try again`;
    }
  }
  return undefined;
}

/** Interactive provider picker for direct BYOK and local compatible endpoints. */
export async function connectProviderInteractive(options: PopupConnectionOptions = {}): Promise<ProviderConnection | undefined> {
  const choices = buildProviderPresets(options.connectProviders);
  const selectedValue = options.drawFrame
    ? await selectListPopup('Connect Provider', choices, { drawFrame: options.drawFrame, signal: options.signal, hint: '↑↓ choose · Enter continue · Esc cancel' })
    : (await askSelect('Connect a provider', choices, 0, { signal: options.signal })).value;
  if (!selectedValue) return undefined;

  if (options.signal?.aborted) return undefined;
  const selectedPreset = choices.find((item) => item.value === selectedValue);
  if (!selectedPreset) return undefined;
  const saved = findReusableConnection(selectedPreset.value, options.savedConnections);
  if (saved && options.resolveSavedConnection) {
    try {
      const resolved = await options.resolveSavedConnection(saved);
      if (resolved.apiKey?.trim() || (saved.id === 'ollama' || saved.id === 'lm-studio')) return resolved;
    } catch {
      // Continue to key entry when the credential service is unavailable.
    }
  }
  if (selectedPreset.value === 'nvidia-nim') {
    const apiKey = await askPopupText('NVIDIA API key', options, true);
    if (!apiKey) return undefined;
    return buildConnection({ kind: 'nvidia-nim', apiKey });
  }

  const customId = selectedPreset.value.startsWith('custom:') ? selectedPreset.value.slice('custom:'.length) : undefined;
  const displayName = selectedPreset.displayName ?? await askPopupText('Provider name (for example, OpenRouter)', options);
  if (!displayName) return undefined;
  const baseUrl = selectedPreset.baseUrl ?? await askPopupText('OpenAI-compatible base URL', options);
  const apiKey = selectedValue === 'ollama' || selectedValue === 'lm-studio'
    ? undefined
    : await askPopupText('API key', options, true);
  let defaultModel: string | undefined = selectedPreset.defaultModel;
  if (!defaultModel && (selectedValue === 'ollama' || selectedValue === 'lm-studio' || selectedValue === 'orcarouter')) {
    try {
      // OrcaRouter's free routing endpoints carry no `pricing`, so filtering the
      // catalog on advertised zero price returns nothing and the flow falls
      // through to manual entry. Offer the ids its preset declares free instead.
      const freePolicy = selectedValue === 'orcarouter' ? freeModelPolicyFor(selectedValue) : undefined;
      const fetched = await fetchProviderModels(baseUrl!, apiKey, { signal: options.signal });
      const models: ModelInventoryEntry[] = freePolicy
        ? fetched.filter((entry) => isFreeModelOption(entry, { modelId: entry.id, accessTier: 'unknown', toolSupport: 'unknown', source: 'heuristic' }, freePolicy))
        : fetched;
      if (models.length) {
        const choices = models.map((entry) => ({ label: entry.id, value: entry.id, description: selectedValue === 'orcarouter' ? 'Free model' : 'Provider model' }));
        const picked = options.drawFrame
          ? await selectListPopup('Choose a model', choices, { drawFrame: options.drawFrame, signal: options.signal, hint: '↑↓ choose · Enter continue · Esc cancel' })
          : (await askSelect('Choose a model', choices, 0, { signal: options.signal })).value;
        if (!picked) return undefined;
        defaultModel = picked;
      }
    } catch { /* allow manual model entry */ }
  }
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
  if (!baseUrl || (!apiKey && selectedValue !== 'ollama' && selectedValue !== 'lm-studio') || !defaultModel) return undefined;
  const connection = buildConnection({ kind: 'openai-compatible', displayName, baseUrl, apiKey, defaultModel });
  return customId ? { ...connection, id: customId } : connection;
}

/** Ask for a replacement key after a provider rejects its saved credential. */
export async function replaceProviderKeyInteractive(connection: ProviderConnection, options: PopupConnectionOptions = {}): Promise<ProviderConnection | undefined> {
  const apiKey = await askPopupText(`${connection.displayName} API key`, options, true);
  return apiKey ? { ...connection, apiKey } : undefined;
}
