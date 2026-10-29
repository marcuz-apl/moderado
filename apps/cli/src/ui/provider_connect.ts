import { freeModelPolicyFor, isAutomaticModeradoBaseUrl, resolveAutoModeradoBaseUrl, resolveModeradoBaseUrl, MODERADO_DEVELOPMENT_BASE_URL, MODERADO_PRODUCTION_BASE_URL, moderadoGatewayEnvironmentForUrl, moderadoGatewayUrlForEnvironment, type AutoModeradoGatewayOptions, type ConnectProvidersConfig, type ModeradoConfig, type ModeradoGatewayEnvironment, type ProviderConnection, type ConnectProviderPresetId } from '../config.js';
import { isFreeModelOption } from '../model_pricing.js';
import { askQuestion, askSecret, askSelect } from './prompt.js';
import { renderBoxLines, selectListPopup } from './popup.js';
import { selectCompatibleModelOverlay } from './model_selector.js';
import { fetchOpenRouterFreeModels, fetchProviderModels } from '@moderado/providers';
import type { ModelInventoryEntry } from '@moderado/contracts';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { emitKeypressEvents } from 'node:readline';
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
  activeConnection?: ProviderConnection;
  savedConnections?: Record<string, ProviderConnection>;
  resolveSavedConnection?: (connection: ProviderConnection) => Promise<ProviderConnection>;
  connectProviders?: ConnectProvidersConfig;
  gatewayUrl?: string;
  /** The stored credential was rejected, so it must not be offered again. */
  forceReauthenticate?: boolean;
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
  { label: 'Moderado', value: 'moderado', tag: 'Free Models', description: 'Use free models without an account, or sign in with a Moderado key.' },
  { label: 'NVIDIA NIM', value: 'nvidia-nim', tag: 'BYOK', displayName: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', description: 'Use NVIDIA NIM with automatic free-model routing.' },
  { label: 'OpenRouter', value: 'openrouter', tag: 'BYOK', displayName: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', description: 'Connect your OpenRouter key to access models.' },
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

/** Accepts a thrown error or the `{ code, message }` error event the agent loop emits. */
export function isAuthenticationFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: string; message?: unknown };
  return code === 'ERR_GATEWAY_UNAUTHORIZED'
    || (typeof message === 'string' && /authentication failed \((401|403)\)/i.test(message));
}

export function isModeradoOAuthConnection(connection: ProviderConnection): boolean {
  return (connection.id === 'moderado' || connection.id === 'moderado-cloud') && connection.credentialExpiresAt !== undefined;
}

/** @deprecated Use isModeradoOAuthConnection. */
export const isModeradoCloudOAuthConnection = isModeradoOAuthConnection;

export function renderConnectionPrompt(label: string, value: string, secret = false): string[] {
  const shown = secret ? '*'.repeat(value.length) : value;
  return renderBoxLines('Connect Provider', [
    `\x1b[1;38;5;75m${label}\x1b[0m`,
    '',
    `  \x1b[1;38;5;75m❯\x1b[0m ${shown}\x1b[7m \x1b[0m`,
    '',
    '\x1b[38;5;244mEnter continue · Ctrl+A clear to edit · Esc cancel\x1b[0m',
  ], 64);
}

async function askPopupText(label: string, options: PopupConnectionOptions, secret = false, initialValue = ''): Promise<string | undefined> {
  if (!options.drawFrame) {
    const shownInitialValue = secret ? '*'.repeat(initialValue.length) : initialValue;
    const answer = secret
      ? await askSecret(`${label}${shownInitialValue ? ` [${shownInitialValue}]` : ''}: `, { signal: options.signal })
      : await askQuestion(`${label}${shownInitialValue ? ` [${shownInitialValue}]` : ''}: `, { signal: options.signal });
    return answer || initialValue;
  }

  const stdin = process.stdin;
  let value = initialValue;
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
      if (key?.ctrl && key.name === 'a') { value = ''; redraw(); return; }
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
    const baseUrl = validateProviderBaseUrl(input.baseUrl ?? 'https://integrate.api.nvidia.com/v1');
    return {
      id: 'nvidia-nim',
      displayName: 'NVIDIA NIM',
      kind: 'nvidia-nim',
      baseUrl,
      apiKey: input.apiKey.trim(),
    };
  }

  const displayName = input.displayName?.trim() || 'OpenAI-compatible provider';
  const defaultModel = input.defaultModel?.trim();
  if (!defaultModel) throw new Error('A default model is required for an OpenAI-compatible provider.');
  if (!input.apiKey?.trim() && !['ollama', 'lm-studio', 'moderado'].includes(connectionId(displayName))) throw new Error('An API key is required.');
  if (!input.baseUrl?.trim()) throw new Error('A base URL is required.');

  return {
    id: connectionId(displayName),
    displayName,
    kind: 'openai-compatible',
    baseUrl: validateProviderBaseUrl(input.baseUrl),
    apiKey: input.apiKey?.trim() || undefined,
    defaultModel,
  };
}

function validateProviderBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a valid provider base URL ending in /v1.'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname))) {
    throw new Error('Provider base URLs must use HTTPS (HTTP is allowed only for localhost).');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/v1')) throw new Error('Provider base URLs must end in /v1.');
  return url.toString().replace(/\/+$/, '');
}

/** Build a public paid-route profile or a keyed Gateway profile. */
export function buildModeradoConnection(
  apiKey?: string,
  credentialExpiresAt?: number,
  gatewayUrl?: string,
  gatewayEnvironment?: ModeradoGatewayEnvironment,
): ProviderConnection {
  const key = apiKey?.trim();
  if (key && !/^mrd_.+/.test(key)) throw new Error('Enter a Moderado key starting with mrd_.');
  const connection: ProviderConnection = {
    ...buildConnection({
      kind: 'openai-compatible',
      displayName: 'Moderado',
      baseUrl: gatewayUrl ?? resolveModeradoBaseUrl(
        process.env.MODERADO_ENV ?? process.env.MODERADO_CLOUD_ENV,
        process.env.MODERADO_BASE_URL ?? process.env.MODERADO_CLOUD_BASE_URL,
      ),
      apiKey: key,
      defaultModel: 'auto',
    }),
    ...(gatewayEnvironment ? { gatewayEnvironment } : {}),
  };
  return credentialExpiresAt === undefined ? connection : { ...connection, credentialExpiresAt };
}

/** @deprecated Use buildModeradoConnection. */
export const buildModeradoCloudConnection = buildModeradoConnection;

/**
 * The account-free default for a session with no provider configured. It is
 * never written to config: the development Gateway may come and go, so the
 * probe runs again on the next start.
 */
export async function resolveAutoModeradoConnection(
  config: ModeradoConfig,
  options: AutoModeradoGatewayOptions = {},
): Promise<ProviderConnection> {
  return buildModeradoConnection(undefined, undefined, await resolveAutoModeradoBaseUrl(config, options));
}

function openAuthorizationPage(url: string): void {
  const [program, args] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(program, args, { shell: false, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => process.stderr.write(`Could not open a browser automatically. Visit ${url} to continue Moderado login.\n`));
  child.unref();
}

/** Tunable seams for the browser wait; production uses the real defaults. */
export interface BrowserLoginOptions {
  /** Stream that receives Esc / Ctrl+C while waiting for the browser. */
  stdin?: NodeJS.ReadStream;
  /** Opens the authorization URL; injectable so tests never spawn a browser. */
  openBrowser?: (url: string) => void;
  /** Max time to wait for the loopback callback. Defaults to five minutes. */
  timeoutMs?: number;
  /** Draws the "waiting for browser" frame while the callback is pending. */
  drawFrame?: (popupLines: string[]) => void;
  /** Token-exchange fetch; injectable so the success path runs offline. */
  tokenFetch?: typeof fetch;
}

const DEFAULT_BROWSER_LOGIN_TIMEOUT_MS = 5 * 60_000;

function waitingForBrowserFrame(): string[] {
  return renderBoxLines('Moderado', [
    'Sign-in page opened in your browser.',
    '',
    'Complete the sign-in, then return here.',
    'The CLI resumes automatically once the browser finishes.',
    '',
    '\x1b[38;5;244mPress Esc or Ctrl+C to cancel and go back.\x1b[0m',
  ], 64);
}

/**
 * Run the loopback OAuth wait. Closing the browser without finishing sends no
 * callback, so we give the user a visible frame plus an Esc/Ctrl+C cancel and
 * settle every non-success path as `undefined` (never a rejection, which would
 * surface as an unhandled rejection inside the async keypress handler).
 */
export async function authorizeModeradoInBrowser(
  signal?: AbortSignal,
  options: BrowserLoginOptions = {},
): Promise<{ accessToken: string; expiresAt: number } | undefined> {
  const stdin = options.stdin ?? process.stdin;
  const openBrowser = options.openBrowser ?? openAuthorizationPage;
  const timeoutMs = options.timeoutMs ?? DEFAULT_BROWSER_LOGIN_TIMEOUT_MS;

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
        stdin.removeListener('keypress', onKeypress);
        signal?.removeEventListener('abort', onAbort);
        error ? reject(error) : resolve(value);
      };
      const onAbort = () => finish(undefined);
      // Raw mode delivers Esc / Ctrl+C as keypresses, not SIGINT, so the only
      // way out is an explicit listener here. Cancel resolves `undefined`.
      const onKeypress = (_str: string | undefined, key: { name?: string; ctrl?: boolean } | undefined): void => {
        if (key?.name === 'escape' || (key?.ctrl && key?.name === 'c')) finish(undefined);
      };
      const timeout = setTimeout(() => {
        options.drawFrame?.(renderBoxLines('Moderado', [
          'Browser sign-in timed out.',
          '',
          'Run /connect again when you are ready to sign in.',
        ], 64));
        finish(undefined);
      }, timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      options.drawFrame?.(waitingForBrowserFrame());
      if (stdin && typeof stdin.on === 'function') {
        emitKeypressEvents(stdin as NodeJS.ReadStream);
        stdin.on('keypress', onKeypress);
      }
      server.on('request', (incoming, response) => {
        if (incoming.method !== 'GET') { response.writeHead(405).end(); return; }
        let authCode: string;
        try {
          authCode = validateModeradoOAuthCallback(incoming.url ?? '/', request);
        } catch {
          response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Login could not be verified. Return to Moderado CLI and try /connect again.');
          finish(undefined, new Error('Moderado browser login callback could not be verified.'));
          return;
        }
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Moderado login complete. You can close this tab.');
        finish(authCode);
      });
      openBrowser(request.authorizationUrl);
    });
    return code ? await exchangeModeradoOAuthCode(code, request, options.tokenFetch) : undefined;
  } finally {
    server.close();
  }
}

/** @deprecated Use authorizeModeradoInBrowser. */
export const authorizeModeradoCloudInBrowser = authorizeModeradoInBrowser;

async function chooseModeradoModel(connection: ProviderConnection, options: PopupConnectionOptions): Promise<ProviderConnection> {
  if (!options.drawFrame) return connection;
  const modelId = await selectCompatibleModelOverlay({
    apiKey: connection.apiKey,
    baseUrl: connection.baseUrl,
    providerId: connection.id,
    providerName: connection.displayName,
    currentModel: connection.defaultModel,
    gatewayFreeOnly: !connection.apiKey,
    signal: options.signal,
    drawFrame: options.drawFrame,
  });
  return modelId ? { ...connection, defaultModel: modelId } : connection;
}

/**
 * The Gateway URL is a property of the deployment, not a question for the user:
 * reuse the environment override, the configured Gateway, the saved profile, or
 * the active connection before asking for a Prod/Dev choice at all.
 */
function knownModeradoGatewayUrl(options: PopupConnectionOptions): string | undefined {
  const envUrl = process.env.MODERADO_BASE_URL ?? process.env.MODERADO_CLOUD_BASE_URL;
  if (envUrl?.trim()) return envUrl.trim();
  const active = options.activeConnection;
  const activeUrl = active && (active.id === 'moderado' || active.id === 'moderado-cloud') ? active.baseUrl : undefined;
  // A keyless profile saved whichever built-in URL the probe picked; letting it
  // win would freeze the deployment and hide a running development Gateway.
  return [
    options.gatewayUrl,
    options.savedConnections?.moderado?.baseUrl,
    options.savedConnections?.['moderado-cloud']?.baseUrl,
    activeUrl,
  ]
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value) && !isAutomaticModeradoBaseUrl(value));
}

async function resolveModeradoGatewayUrl(options: PopupConnectionOptions): Promise<string | undefined> {
  const known = knownModeradoGatewayUrl(options);
  if (known) {
    try {
      return validateProviderBaseUrl(known);
    } catch {
      // A malformed saved URL must not trap the user: fall through to the probe.
    }
  }
  if (options.signal?.aborted) return undefined;
  return resolveAutoModeradoBaseUrl({ connections: options.savedConnections }, { signal: options.signal });
}

/**
 * A deployment the user picked with "Change server", from the same profile the
 * URL resolver reads. A marker on a custom URL is meaningless and is ignored.
 */
function knownModeradoEnvironment(options: PopupConnectionOptions): ModeradoGatewayEnvironment | undefined {
  const saved = options.savedConnections?.moderado ?? options.savedConnections?.['moderado-cloud'];
  const source = saved ?? options.activeConnection;
  if (!source?.gatewayEnvironment || !isAutomaticModeradoBaseUrl(source.baseUrl)) return undefined;
  return source.gatewayEnvironment;
}

/** A pinned URL (environment override or custom Gateway) leaves no deployment to pick. */
function moderadoDeploymentPinned(options: PopupConnectionOptions): boolean {
  return knownModeradoGatewayUrl(options) !== undefined;
}

function deploymentName(environment: ModeradoGatewayEnvironment): string {
  return environment === 'development' ? 'Development' : 'Production';
}

async function chooseModeradoGateway(
  options: PopupConnectionOptions,
  current: ModeradoGatewayEnvironment | undefined,
): Promise<ModeradoGatewayEnvironment | undefined> {
  if (!options.drawFrame) return current;
  const value = await selectListPopup('Moderado Gateway', [
    {
      label: 'Production', value: 'production', tag: current === 'production' ? 'Current' : undefined,
      description: `Cloud Gateway · ${MODERADO_PRODUCTION_BASE_URL}`,
    },
    {
      label: 'Development', value: 'development', tag: current === 'development' ? 'Current' : undefined,
      description: `Local Gateway · ${MODERADO_DEVELOPMENT_BASE_URL}`,
    },
  ], { drawFrame: options.drawFrame, signal: options.signal, initialValue: current, hint: '↑↓ choose · Enter continue · Esc back' });
  return value === 'production' || value === 'development' ? value : undefined;
}

async function resolveSavedModeradoConnection(options: PopupConnectionOptions): Promise<ProviderConnection | undefined> {
  if (options.forceReauthenticate) return undefined;
  const saved = options.savedConnections?.moderado ?? options.savedConnections?.['moderado-cloud'];
  if (!saved) return undefined;
  try {
    const resolved = options.resolveSavedConnection ? await options.resolveSavedConnection(saved) : saved;
    return resolved.apiKey?.trim() ? resolved : undefined;
  } catch {
    // Keep sign-in available when credential storage cannot be read.
    return undefined;
  }
}

async function askModeradoApiKey(
  baseUrl: string,
  options: PopupConnectionOptions,
  gatewayEnvironment?: ModeradoGatewayEnvironment,
): Promise<ProviderConnection | undefined> {
  let prompt = 'Moderado API key (mrd_…, optional for paid routes)';
  while (!options.signal?.aborted) {
    const apiKey = await askPopupText(prompt, options, true);
    if (apiKey === undefined) return undefined;
    try {
      return chooseModeradoModel(buildModeradoConnection(apiKey || undefined, undefined, baseUrl, gatewayEnvironment), options);
    } catch (error) {
      prompt = `Invalid key: ${error instanceof Error ? error.message : String(error)} Try again`;
    }
  }
  return undefined;
}

/**
 * Connect to the Moderado Gateway. The flow asks only what it cannot know:
 * the credential (reused when saved, otherwise browser sign-in with a manual
 * key as the fallback) and the model. The deployment is resolved automatically;
 * the sign-in menu offers "Change server" so an explicit Production/Development
 * choice is one keystroke away and is remembered for later sessions.
 */
export async function loginModeradoInteractive(options: PopupConnectionOptions = {}): Promise<ProviderConnection | undefined> {
  if (options.signal?.aborted) return undefined;
  let environment = knownModeradoEnvironment(options);
  // An explicit "Change server" choice outranks the dev-first probe: re-probing
  // here would silently move a saved Production connection onto Development.
  let baseUrl = environment
    ? moderadoGatewayUrlForEnvironment(environment)
    : await resolveModeradoGatewayUrl(options);
  if (!baseUrl || options.signal?.aborted) return undefined;
  const canChangeServer = !moderadoDeploymentPinned(options);
  const withEnvironment = (connection: ProviderConnection): ProviderConnection =>
    environment ? { ...connection, gatewayEnvironment: environment } : connection;

  const saved = await resolveSavedModeradoConnection(options);
  if (saved?.apiKey) {
    // A stored credential used to connect silently, which made the deployment
    // unswitchable: "Change server" lived on a menu this path never reached.
    // One keystroke reconnects; the row to move servers is on the same menu.
    if (canChangeServer && options.drawFrame) {
      let reconnect = false;
      while (!options.signal?.aborted && !reconnect) {
        // `canChangeServer` means nothing pinned the deployment, so `baseUrl` is
        // a built-in the probe or the marker chose and therefore names one.
        const current = environment ?? moderadoGatewayEnvironmentForUrl(baseUrl);
        if (!current) return undefined;
        const choice = await selectListPopup('Moderado Connection', [
          {
            label: `Connect to ${deploymentName(current)}`, value: 'connect', tag: 'Saved key',
            description: baseUrl,
          },
          { label: 'Change server', value: 'server', description: 'Pick the Production or Development Gateway' },
          { label: 'Sign in again', value: 'signin', description: 'Replace the saved credential' },
        ], { drawFrame: options.drawFrame, signal: options.signal, initialValue: 'connect', hint: '↑↓ choose · Enter continue · Esc cancel' });
        if (!choice) return undefined;
        if (choice === 'signin') break;
        if (choice === 'server') {
          const chosen = await chooseModeradoGateway(options, current);
          if (!chosen) {
            if (options.signal?.aborted) return undefined;
            continue;
          }
          environment = chosen;
          baseUrl = moderadoGatewayUrlForEnvironment(chosen);
          continue;
        }
        reconnect = true;
      }
    }
    return chooseModeradoModel(withEnvironment(buildModeradoConnection(saved.apiKey, saved.credentialExpiresAt, baseUrl)), options);
  }

  while (!options.signal?.aborted) {
    const current = environment ?? moderadoGatewayEnvironmentForUrl(baseUrl);
    // No reusable credential: free defaults need no sign-in, so offer them first.
    const method = options.drawFrame
      ? await selectListPopup('Moderado Sign-in', [
          { label: 'Use free models without an account', value: 'free', description: 'No key or sign-in; the Gateway routes to its free defaults' },
          { label: 'Sign in with browser', value: 'browser', description: 'Opens mod.alfazen.org and returns here automatically' },
          { label: 'Paste an API key', value: 'key', description: 'Use an mrd_… key from your Moderado account' },
          ...(canChangeServer
            ? [{
                label: 'Change server',
                value: 'server',
                tag: current ? deploymentName(current) : undefined,
                description: 'Pick the Production or Development Gateway',
              }]
            : []),
        ], { drawFrame: options.drawFrame, signal: options.signal, hint: '↑↓ choose · Enter continue · Esc cancel' })
      : 'key';
    if (!method) return undefined;

    if (method === 'server') {
      const chosen = await chooseModeradoGateway(options, current);
      if (!chosen) {
        if (options.signal?.aborted) return undefined;
        continue;
      }
      environment = chosen;
      baseUrl = moderadoGatewayUrlForEnvironment(chosen);
      continue;
    }

    // Account-free defaults are selected explicitly, so the session starts on a
    // named Gateway model instead of the ambiguous `auto` route.
    if (method === 'free') return chooseModeradoModel(withEnvironment(buildModeradoConnection(undefined, undefined, baseUrl)), options);

    if (method === 'browser') {
      const auth = await authorizeModeradoInBrowser(options.signal, { drawFrame: options.drawFrame });
      if (auth) return chooseModeradoModel(withEnvironment(buildModeradoConnection(auth.accessToken, auth.expiresAt, baseUrl)), options);
      if (options.signal?.aborted) return undefined;
      // Cancelled or unavailable browser flow: keep the manual key as a fallback.
    }
    return askModeradoApiKey(baseUrl, options, environment);
  }
  return undefined;
}

/** @deprecated Use loginModeradoInteractive. */
export const loginModeradoCloudInteractive = loginModeradoInteractive;

async function askProviderBaseUrl(label: string, initialValue: string, options: PopupConnectionOptions): Promise<string | undefined> {
  while (!options.signal?.aborted) {
    const value = await askPopupText(label, options, false, initialValue);
    if (!value) return undefined;
    try { return validateProviderBaseUrl(value); }
    catch (error) {
      options.drawFrame?.(renderBoxLines('Invalid Base URL', [error instanceof Error ? error.message : String(error), '', '\x1b[38;5;244mPress Esc to cancel or Enter to edit the URL.\x1b[0m'], 64));
      initialValue = value;
    }
  }
  return undefined;
}

/** Interactive provider picker for the Gateway, BYOK, and local endpoints. */
export async function connectProviderInteractive(options: PopupConnectionOptions = {}): Promise<ProviderConnection | undefined> {
  const choices = buildProviderPresets(options.connectProviders);
  const selectedValue = options.drawFrame
    ? await selectListPopup('Connect Provider', choices, { drawFrame: options.drawFrame, signal: options.signal, hint: '↑↓ choose · Enter continue · Esc cancel' })
    : (await askSelect('Connect a provider', choices, 0, { signal: options.signal })).value;
  if (!selectedValue) return undefined;

  if (options.signal?.aborted) return undefined;
  const selectedPreset = choices.find((item) => item.value === selectedValue);
  if (!selectedPreset) return undefined;
  if (selectedPreset.value === 'moderado') return loginModeradoInteractive(options);
  const saved = findReusableConnection(selectedPreset.value, options.savedConnections);
  if (saved && options.resolveSavedConnection) {
    try {
      const resolved = await options.resolveSavedConnection(saved);
      if (resolved.apiKey?.trim() || (saved.id === 'ollama' || saved.id === 'lm-studio')) {
        const baseUrl = await askProviderBaseUrl(`${resolved.displayName} Base URL`, resolved.baseUrl, options);
        return baseUrl ? { ...resolved, baseUrl } : undefined;
      }
    } catch {
      // Continue to key entry when the credential service is unavailable.
    }
  }
  if (selectedPreset.value === 'nvidia-nim') {
    const baseUrl = await askProviderBaseUrl('NVIDIA NIM Base URL', saved?.baseUrl ?? selectedPreset.baseUrl!, options);
    if (!baseUrl) return undefined;
    const apiKey = await askPopupText('NVIDIA API key', options, true);
    if (!apiKey) return undefined;
    return buildConnection({ kind: 'nvidia-nim', baseUrl, apiKey });
  }

  const customId = selectedPreset.value.startsWith('custom:') ? selectedPreset.value.slice('custom:'.length) : undefined;
  const displayName = selectedPreset.displayName ?? await askPopupText('Provider name (for example, OpenRouter)', options);
  if (!displayName) return undefined;
  const baseUrl = await askProviderBaseUrl(`${displayName} Base URL`, saved?.baseUrl ?? selectedPreset.baseUrl ?? 'https://example.com/v1', options);
  if (!baseUrl) return undefined;
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
