import {
  ModelInventoryEntry,
  ModelInventoryEntrySchema,
  GATEWAY_ERROR_CODES,
  GatewayError,
  ProviderError,
} from '@moderado/contracts';

export const SPIKE_PROVIDER_ENDPOINTS = {} as const;

function isModeradoGatewayUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    return parsed.hostname === 'mod.alfazen.org'
      || (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && parsed.port === '4788';
  } catch {
    return false;
  }
}

function gatewayErrorCode(status: number): string {
  return status === 401 ? 'unauthorized' : status === 403 ? 'scope_denied' : status === 400 ? 'invalid_request'
    : status === 404 ? 'model_unavailable' : status === 429 ? 'quota_exceeded'
      : status === 503 ? 'service_unavailable' : 'provider_error';
}

/**
 * Fetch the OpenAI-compatible `/models` listing from any provider endpoint.
 * Mirrors `NvidiaAdapter.discoverModels` but without per-instance caching —
 * `/model` calls it when browsing a compatible provider's catalog.
 */
export async function fetchProviderModels(
  baseUrl: string,
  apiKey: string | undefined,
  optionsOrSignal?: AbortSignal | { signal?: AbortSignal; fetchImpl?: typeof fetch }
): Promise<ModelInventoryEntry[]> {
  const signal = optionsOrSignal instanceof AbortSignal ? optionsOrSignal : optionsOrSignal?.signal;
  const doFetch = (!(optionsOrSignal instanceof AbortSignal) && optionsOrSignal?.fetchImpl) ? optionsOrSignal.fetchImpl : fetch;
  const url = `${baseUrl.replace(/\/+$/, '')}/models`;
  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw new Error('Discovery request was aborted');
    throw new ProviderError(
      `Network error while contacting ${url}: ${err instanceof Error ? err.message : String(err)}`,
      'ERR_NETWORK_ERROR'
    );
  }
  if (!response.ok) {
    if (isModeradoGatewayUrl(baseUrl)) {
      let code = gatewayErrorCode(response.status);
      let retryAfterSeconds: number | undefined;
      try {
        const body: unknown = await response.json();
        if (body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object'
          && 'code' in body.error && typeof body.error.code === 'string') code = body.error.code;
      } catch {
        // Use the status mapping if the error body is not JSON.
      }
      if (!GATEWAY_ERROR_CODES.includes(code)) code = 'provider_error';
      const retryHeader = response.headers.get('Retry-After');
      if (retryHeader) {
        if (/^\d+$/.test(retryHeader)) retryAfterSeconds = Number(retryHeader);
        else {
          const retryAt = Date.parse(retryHeader);
          if (!Number.isNaN(retryAt)) retryAfterSeconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
        }
      }
      throw new GatewayError(code, response.status, retryAfterSeconds);
    }
    throw new ProviderError(
      `Model discovery failed with status ${response.status} at ${url}`,
      'ERR_HTTP_ERROR',
      response.status
    );
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    throw new ProviderError(
      `Failed to parse models response: ${err instanceof Error ? err.message : String(err)}`,
      'ERR_MALFORMED_RESPONSE'
    );
  }
  const dataArray = Array.isArray(json) ? json : (json as { data?: unknown[] })?.data;
  if (!Array.isArray(dataArray)) {
    throw new ProviderError("Expected array in models response ('data' field)", 'ERR_MALFORMED_RESPONSE');
  }
  const results: ModelInventoryEntry[] = [];
  for (const item of dataArray) {
    const parsed = ModelInventoryEntrySchema.safeParse(item);
    if (parsed.success) results.push(parsed.data);
  }
  return results;
}

/** Require explicit zero input and output prices, with no other metered fees. */
export function isFreeModelEntry(entry: Pick<ModelInventoryEntry, 'pricing'>): boolean {
  const pricing = entry.pricing;
  return pricing?.prompt !== undefined && pricing.completion !== undefined
    && Object.values(pricing).every((price) => price.trim() !== '' && Number.isFinite(Number(price)) && Number(price) === 0);
}

export async function fetchProviderFreeModels(
  baseUrl: string,
  apiKey: string | undefined,
  optionsOrSignal?: AbortSignal | { signal?: AbortSignal; fetchImpl?: typeof fetch }
): Promise<ModelInventoryEntry[]> {
  const models = await fetchProviderModels(baseUrl, apiKey, optionsOrSignal);
  return models.filter(isFreeModelEntry);
}


const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/**
 * OpenRouter publishes its full model catalog without authentication; free
 * variants (e.g. `deepseek/deepseek-r1:free`) advertise `pricing.prompt: "0"`.
 * `fetchImpl` is injectable so tests stay fully offline.
 */
export async function fetchOpenRouterFreeModels(
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}
): Promise<ModelInventoryEntry[]> {
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(OPENROUTER_MODELS_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    });
  } catch (err) {
    if (options.signal?.aborted) throw new Error('Discovery request was aborted');
    throw new ProviderError(
      `Network error while contacting ${OPENROUTER_MODELS_URL}: ${err instanceof Error ? err.message : String(err)}`,
      'ERR_NETWORK_ERROR'
    );
  }
  if (!response.ok) {
    throw new ProviderError(
      `OpenRouter model discovery failed with status ${response.status}`,
      'ERR_HTTP_ERROR',
      response.status
    );
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    throw new ProviderError(
      `Failed to parse OpenRouter models response: ${err instanceof Error ? err.message : String(err)}`,
      'ERR_MALFORMED_RESPONSE'
    );
  }
  const dataArray = Array.isArray(json) ? json : (json as { data?: unknown[] })?.data;
  if (!Array.isArray(dataArray)) {
    throw new ProviderError("Expected array in OpenRouter models response ('data' field)", 'ERR_MALFORMED_RESPONSE');
  }
  const free: ModelInventoryEntry[] = [];
  for (const item of dataArray) {
    const parsed = ModelInventoryEntrySchema.safeParse(item);
    if (parsed.success && isFreeModelEntry(parsed.data)) free.push(parsed.data);
  }
  return free;
}

/** Split a provider listing into free-first and paid buckets. */
export function partitionFreeModels(entries: ModelInventoryEntry[]): {
  free: ModelInventoryEntry[];
  paid: ModelInventoryEntry[];
} {
  const free: ModelInventoryEntry[] = [];
  const paid: ModelInventoryEntry[] = [];
  for (const entry of entries) {
    (isFreeModelEntry(entry) ? free : paid).push(entry);
  }
  return { free, paid };
}
