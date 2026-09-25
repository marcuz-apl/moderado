import path from 'node:path';
import type {
  HostNotification,
  HostRequest,
  InitializeRequest,
  InitializeResult,
  IProviderAdapter,
  IToolRegistry,
  ModelOption,
  ProviderInfo,
} from '@moderado/contracts';
import { AgentLoop, HostEventStream, PolicyManager, Router } from '@moderado/core';
import { canonicalizeRoot, createDefaultToolRegistry, resolveInJail } from '@moderado/tools';
import { NvidiaAdapter, isFreeModelEntry } from '@moderado/providers';
import {
  CONNECT_PROVIDER_PRESET_META,
  findProviderPreset,
  getActiveConnection,
  isLoopbackBaseUrl,
  loadConfig,
  type ProviderConnection,
  resolveApiKey,
  resolveConnectionCredential,
  saveConnection,
  storeConnectionCredential,
} from '../config.js';
import { CredentialStore, MemoryCredentialStore } from '../credentials.js';
import { WindowsCredentialStore } from '../windows_credentials.js';
import { createSession, SessionStore, type StoredSession } from '../sessions.js';
import { createWorkspaceFileSource, expandMentions } from '../ui/file_mentions.js';
import { ApprovalQueue } from './approval_queue.js';

export interface HostRuntimeDependencies {
  provider?: IProviderAdapter;
  credentialStore?: CredentialStore;
  customHome?: string;
  tools?: IToolRegistry;
  sessionStore?: SessionStore;
  agentLoop?: AgentLoop;
}

export interface CreateHostRuntimeOptions {
  workspaceRoot: string;
  emit: (notification: HostNotification) => Promise<void>;
  dependencies?: HostRuntimeDependencies;
  providerId?: string;
  modelId?: string;
}

export interface HostRuntime {
  readonly approvalQueue: ApprovalQueue;
  readonly canonicalWorkspaceRoot: string;
  initialize(request?: InitializeRequest): Promise<InitializeResult>;
  dispatch(request: HostRequest): Promise<unknown>;
  waitForActiveGeneration?(): Promise<void>;
  close(): Promise<void>;
}

async function resolveDefaultProvider(
  customHome?: string,
  credentialStore?: CredentialStore,
  providerIdOverride?: string,
): Promise<IProviderAdapter> {
  const config = loadConfig(customHome);
  const activeConn = providerIdOverride
    ? (config.connections?.[providerIdOverride] ?? getActiveConnection(config))
    : getActiveConnection(config);
  const store =
    credentialStore ??
    (process.platform === 'win32'
      ? new WindowsCredentialStore()
      : new MemoryCredentialStore());

  if (activeConn) {
    const resolved = await resolveConnectionCredential(activeConn, store);
    if (!resolved.apiKey) {
      throw new Error(`Configured provider "${resolved.displayName || resolved.id}" is missing an API key.`);
    }
    return new NvidiaAdapter({
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      providerId: resolved.id,
      providerName: resolved.displayName,
    });
  }

  const legacyKey = resolveApiKey(customHome);
  if (legacyKey) {
    return new NvidiaAdapter({
      apiKey: legacyKey,
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    });
  }

  throw new Error('No provider configured. Please configure an API key or provider connection.');
}

export async function createHostRuntime(options: CreateHostRuntimeOptions): Promise<HostRuntime> {
  const { workspaceRoot, emit, dependencies } = options;
  const canonicalRoot = canonicalizeRoot(workspaceRoot);

  const customHome = dependencies?.customHome;
  const sessionStore = dependencies?.sessionStore ?? new SessionStore(customHome);
  const credentialStore =
    dependencies?.credentialStore ??
    (process.platform === 'win32' ? new WindowsCredentialStore() : new MemoryCredentialStore());

  // Provider resolution is lazy: the sidecar must start (and the model manager
  // must be reachable) before any API key exists. DI providers win permanently;
  // resolved adapters are invalidated by provider.connect so a switch takes
  // effect without a sidecar restart.
  let providerAdapter: IProviderAdapter | undefined = dependencies?.provider;
  let providerPromise: Promise<IProviderAdapter> | undefined;
  const getProvider = async (): Promise<IProviderAdapter> => {
    if (providerAdapter) return providerAdapter;
    if (!providerPromise) {
      providerPromise = resolveDefaultProvider(customHome, credentialStore, options.providerId).then(
        (resolved) => {
          providerAdapter = resolved;
          providerPromise = undefined;
          return resolved;
        },
        (err) => {
          providerPromise = undefined;
          throw err;
        },
      );
    }
    return providerPromise;
  };
  const invalidateProvider = (): void => {
    if (dependencies?.provider) return;
    providerAdapter = undefined;
    providerPromise = undefined;
  };

  // Builds a throwaway adapter for a provider that is not the active one
  // (used when the model manager browses models for a different provider).
  const buildAdapterForProvider = async (providerId: string): Promise<IProviderAdapter> => {
    const preset = findProviderPreset(providerId);
    const saved = loadConfig(customHome).connections?.[providerId];
    if (!preset && !saved) {
      throw new Error(`Unknown provider "${providerId}".`);
    }
    const connection: ProviderConnection = saved ?? {
      id: preset!.id,
      displayName: preset!.label,
      kind: preset!.kind,
      baseUrl: preset!.baseUrl,
      defaultModel: preset!.defaultModel,
    };
    const resolved = await resolveConnectionCredential(connection, credentialStore);
    const apiKey = resolved.apiKey?.trim() || undefined;
    const requiresApiKey = preset
      ? preset.requiresApiKey
      : !isLoopbackBaseUrl(connection.baseUrl);
    if (requiresApiKey && !apiKey) {
      throw new Error(`An API key is required to use ${connection.displayName || providerId}.`);
    }
    return new NvidiaAdapter({
      apiKey,
      baseUrl: connection.baseUrl,
      providerId: connection.id,
      providerName: connection.displayName,
    });
  };

  const tools = dependencies?.tools ?? createDefaultToolRegistry();
  const loop = dependencies?.agentLoop ?? new AgentLoop();
  const router = new Router();
  const policy = new PolicyManager();
  const approvalQueue = new ApprovalQueue();

  let activeSession: StoredSession =
    sessionStore.loadLatestSession(canonicalRoot) ?? createSession(canonicalRoot);
  sessionStore.save(activeSession);

  let hostStream = new HostEventStream((envelope) => {
    emit({ type: 'event', envelope }).catch(() => {});
  }, activeSession.id as any);

  let activeGeneration: {
    requestId: string;
    abortController: AbortController;
    promise: Promise<unknown>;
  } | null = null;
  let currentPromise: Promise<unknown> | null = null;

  const initialize = async (_req?: InitializeRequest): Promise<InitializeResult> => {
    const sessions = sessionStore.listSessions(canonicalRoot);
    const resumableSessions = sessions.map((s) => ({
      sessionId: s.id,
      title: s.messages.find((m) => m.role === 'user')?.content?.slice(0, 60) || undefined,
      updatedAt: new Date(s.updatedAt).getTime(),
    }));

    return {
      protocolVersion: 1,
      sessionId: activeSession.id,
      workspaceName: path.basename(canonicalRoot),
      resumableSessions,
    };
  };

  const dispatch = async (request: HostRequest): Promise<unknown> => {
    switch (request.method) {
      case 'initialize': {
        return initialize(request);
      }

      case 'session.new': {
        if (request.params.sessionId !== activeSession.id) {
          const err = new Error(`Session mismatch: expected ${activeSession.id}, got ${request.params.sessionId}`);
          (err as any).code = 'SESSION_NOT_FOUND';
          throw err;
        }

        activeSession = createSession(canonicalRoot);
        sessionStore.save(activeSession);
        hostStream = new HostEventStream((envelope) => {
          emit({ type: 'event', envelope }).catch(() => {});
        }, activeSession.id as any);

        return { sessionId: activeSession.id };
      }

      case 'session.resume': {
        if (request.params.sessionId !== activeSession.id) {
          const err = new Error(`Session mismatch: expected ${activeSession.id}, got ${request.params.sessionId}`);
          (err as any).code = 'SESSION_NOT_FOUND';
          throw err;
        }

        const sessions = sessionStore.listSessions(canonicalRoot);
        const target = sessions.find((s) => s.id === request.params.targetSessionId);
        if (!target) {
          const err = new Error(`Session '${request.params.targetSessionId}' not found in workspace`);
          (err as any).code = 'SESSION_NOT_FOUND';
          throw err;
        }

        activeSession = target;
        hostStream = new HostEventStream((envelope) => {
          emit({ type: 'event', envelope }).catch(() => {});
        }, activeSession.id as any);

        return { sessionId: target.id };
      }

      case 'approval.respond': {
        if (request.params.sessionId !== activeSession.id) {
          const err = new Error(`Session mismatch: expected ${activeSession.id}, got ${request.params.sessionId}`);
          (err as any).code = 'SESSION_NOT_FOUND';
          throw err;
        }

        const resolved = approvalQueue.resolve(request.params.requestId, request.params.status);
        if (!resolved) {
          const err = new Error(`Approval request '${request.params.requestId}' is stale or not found`);
          (err as any).code = 'APPROVAL_STALE';
          throw err;
        }

        return { resolved: true };
      }

      case 'chat.cancel': {
        if (request.params.sessionId !== activeSession.id) {
          const err = new Error(`Session mismatch: expected ${activeSession.id}, got ${request.params.sessionId}`);
          (err as any).code = 'SESSION_NOT_FOUND';
          throw err;
        }

        if (
          activeGeneration &&
          (!request.params.targetRequestId ||
            activeGeneration.requestId === request.params.targetRequestId)
        ) {
          activeGeneration.abortController.abort();
          activeGeneration = null;
        }

        return { cancelled: true };
      }

      case 'provider.list': {
        const config = loadConfig(customHome);
        const activeId = options.providerId ?? getActiveConnection(config)?.id;
        const providers: ProviderInfo[] = [];

        for (const preset of CONNECT_PROVIDER_PRESET_META) {
          const saved = config.connections?.[preset.id];
          const virtualConnection: ProviderConnection = saved ?? {
            id: preset.id,
            displayName: preset.label,
            kind: preset.kind,
            baseUrl: preset.baseUrl,
            defaultModel: preset.defaultModel,
          };
          const resolved = await resolveConnectionCredential(virtualConnection, credentialStore);
          const legacyNvidiaKey = preset.id === 'nvidia-nim' ? config.apiKey?.trim() : undefined;
          const hasApiKey = preset.requiresApiKey
            ? !!resolved.apiKey?.trim() || !!legacyNvidiaKey
            : true;
          providers.push({
            id: preset.id,
            label: preset.label,
            description: preset.description,
            requiresApiKey: preset.requiresApiKey,
            hasApiKey,
            isActive: preset.id === activeId,
          });
        }

        // Saved custom connections that are not built-in presets.
        for (const connection of Object.values(config.connections ?? {})) {
          if (CONNECT_PROVIDER_PRESET_META.some((preset) => preset.id === connection.id)) continue;
          const resolved = await resolveConnectionCredential(connection, credentialStore);
          const loopback = isLoopbackBaseUrl(connection.baseUrl);
          providers.push({
            id: connection.id,
            label: connection.displayName,
            description: connection.baseUrl,
            requiresApiKey: !loopback,
            hasApiKey: loopback || !!resolved.apiKey?.trim(),
            isActive: connection.id === activeId,
          });
        }

        return { providers, activeProviderId: activeId };
      }

      case 'provider.connect': {
        const { providerId, apiKey } = request.params;
        const preset = findProviderPreset(providerId);
        const saved = loadConfig(customHome).connections?.[providerId];

        if (!preset && !saved) {
          const err = new Error(`Unknown provider "${providerId}".`);
          (err as any).code = 'INVALID_REQUEST';
          throw err;
        }

        const requiresApiKey = preset ? preset.requiresApiKey : !isLoopbackBaseUrl(saved!.baseUrl);
        const base: ProviderConnection = saved ?? {
          id: preset!.id,
          displayName: preset!.label,
          kind: preset!.kind,
          baseUrl: preset!.baseUrl,
          defaultModel: preset!.defaultModel,
        };

        let connection: ProviderConnection = apiKey ? { ...base, apiKey } : base;
        if (!apiKey && requiresApiKey) {
          const resolved = await resolveConnectionCredential(base, credentialStore);
          if (!resolved.apiKey?.trim()) {
            const err = new Error(`An API key is required to connect to ${base.displayName || providerId}.`);
            (err as any).code = 'INVALID_REQUEST';
            throw err;
          }
        }

        // Mirror the CLI /connect flow: Windows Credential Manager on win32,
        // plaintext config (mode 0600) elsewhere.
        const persisted =
          process.platform === 'win32' && connection.apiKey?.trim()
            ? await storeConnectionCredential(connection, credentialStore)
            : connection;
        saveConnection(persisted, customHome);

        options.providerId = providerId;
        invalidateProvider();

        return { providerId, connected: true as const };
      }

      case 'model.list': {
        const explicitId = request.params.providerId;
        const config = loadConfig(customHome);
        const activeId = options.providerId ?? getActiveConnection(config)?.id;
        const injected = dependencies?.provider;

        let providerId: string | undefined;
        let adapter: IProviderAdapter;
        if (injected && (!explicitId || explicitId === injected.id)) {
          providerId = explicitId ?? injected.id;
          adapter = injected;
        } else {
          const target = explicitId ?? activeId;
          if (!target) {
            const err = new Error('No provider configured. Connect a provider first.');
            (err as any).code = 'INVALID_REQUEST';
            throw err;
          }
          providerId = target;
          adapter =
            target === activeId ? await getProvider() : await buildAdapterForProvider(target);
        }

        const MAX_MODELS = 400;
        const entries = await adapter.discoverModels();
        const models: ModelOption[] = entries
          .filter((entry) => entry.id.length > 0 && entry.id.length <= 300)
          .map((entry) => ({
            id: entry.id,
            isFree:
              isFreeModelEntry(entry) ||
              ['free_trial', 'local'].includes(router.classifyModel(entry.id).accessTier),
            ownedBy: entry.owned_by && entry.owned_by.length <= 120 ? entry.owned_by : undefined,
          }))
          .sort((a, b) =>
            a.isFree === b.isFree ? a.id.localeCompare(b.id) : a.isFree ? -1 : 1,
          );
        const truncated = models.length > MAX_MODELS;

        return {
          providerId,
          models: truncated ? models.slice(0, MAX_MODELS) : models,
          truncated,
        };
      }

      case 'chat.send': {
        if (request.params.sessionId !== activeSession.id) {
          const err = new Error(`Session mismatch: expected ${activeSession.id}, got ${request.params.sessionId}`);
          (err as any).code = 'SESSION_NOT_FOUND';
          throw err;
        }

        if (activeGeneration !== null) {
          const err = new Error('Another generation is already in flight for this session');
          (err as any).code = 'BUSY';
          throw err;
        }

        // Validate selection context against workspace jail
        if (request.params.context?.selection) {
          try {
            resolveInJail(canonicalRoot, request.params.context.selection.relativePath);
          } catch (jailErr: any) {
            const err = new Error(jailErr?.message ?? 'Selection path is outside workspace jail');
            (err as any).code = 'WORKSPACE_DENIED';
            throw err;
          }
        }

        const workspaceSource = createWorkspaceFileSource(canonicalRoot);
        const expansion = await expandMentions(request.params.text, workspaceSource);
        let turnPrompt = expansion.text;
        if (request.params.context?.selection) {
          const sel = request.params.context.selection;
          turnPrompt = `Active selection in workspace file "${sel.relativePath}" (lines ${sel.startLine}-${sel.endLine}):\n\`\`\`\n${sel.text ?? ''}\n\`\`\`\n\n${turnPrompt}`;
        }

        const abortController = new AbortController();

        const generationPromise = (async () => {
          try {
            // Resolved lazily so a keyless first run can start and use the manager.
            const provider = await getProvider();
            const result = await loop.run(turnPrompt, {
              workspaceRoot: canonicalRoot,
              provider,
              tools,
              approvalHandler: approvalQueue,
              router,
              policy,
              routeOptions: options.modelId ? { pinnedModelId: options.modelId } : undefined,
              eventListener: (event) => hostStream.emit(event),
              signal: abortController.signal,
              conversationHistory: activeSession.messages,
            });

            activeSession.messages = result.messages;
            if (result.usage) {
              activeSession.usage = {
                promptTokens: (activeSession.usage.promptTokens ?? 0) + result.usage.promptTokens,
                completionTokens:
                  (activeSession.usage.completionTokens ?? 0) + result.usage.completionTokens,
                totalTokens: (activeSession.usage.totalTokens ?? 0) + result.usage.totalTokens,
                costKnown: false,
                available: true,
              };
            }
            sessionStore.save(activeSession);
          } catch (err: any) {
            if (abortController.signal.aborted) {
              hostStream.emit({
                type: 'cancellation',
                reason: 'Aborted by user',
                timestamp: Date.now(),
              });
            } else {
              // Surface provider/config failures so the UI can offer the model
              // manager instead of leaving the composer stuck in a busy state.
              hostStream.emit({
                type: 'error',
                code: err?.code ?? 'TURN_FAILED',
                message: err?.message ?? String(err),
                recoverable: false,
                timestamp: Date.now(),
              });
            }
          } finally {
            const thisReqId = request.id;
            if (activeGeneration && (activeGeneration as any).requestId === thisReqId) {
              activeGeneration = null;
            }
          }
        })();

        activeGeneration = {
          requestId: request.id,
          abortController,
          promise: generationPromise,
        };
        currentPromise = generationPromise;

        return { accepted: true };
      }
    }
  };

  const waitForActiveGeneration = async (): Promise<void> => {
    if (currentPromise) {
      await currentPromise;
    }
  };

  const close = async (): Promise<void> => {
    if (activeGeneration) {
      activeGeneration.abortController.abort();
      await activeGeneration.promise.catch(() => {});
      activeGeneration = null;
    }
    approvalQueue.close();
  };

  return {
    approvalQueue,
    canonicalWorkspaceRoot: canonicalRoot,
    initialize,
    dispatch,
    waitForActiveGeneration,
    close,
  };
}
