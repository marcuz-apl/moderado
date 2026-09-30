import crypto from 'node:crypto';
import {
  HostIntentSchema,
  HostResponseSchema,
  type ApprovalRequest,
  type HostEventEnvelope,
  type HostIntent,
  type HostResponse,
  type HostResult,
  type IProviderAdapter,
  type IToolRegistry,
  type ModelInventoryEntry,
} from '@moderado/contracts';
import { AgentLoop, Router } from '@moderado/core';
import { DEFAULT_APPROVAL_SETTINGS, createApprovalGate, withApprovalSettings, type ApprovalGate, type ApprovalSettings } from './approval_handler.js';
import { findProviderPreset } from '@moderado/providers';
import { filterProvenFreeModels, listProviderPresets } from './provider_service.js';

/** Failure with a stable code so the webview can branch without parsing prose. */
class HostError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export interface HostServices {
  workspaceRoot: string;
  createTools: () => IToolRegistry;
  createProvider: (connectionId: string) => Promise<IProviderAdapter>;
  onEvent?: (envelope: HostEventEnvelope) => void;
  onApproval?: (request: ApprovalRequest) => void;
  /** Replaces the built-in preset list, e.g. with the workspace's own config. */
  providers?: () => { id: string; label: string }[];
  /** Secret storage. Absent means this host cannot hold credentials. */
  credentials?: {
    get: (providerId: string) => Promise<string | undefined>;
    set: (providerId: string, apiKey: string) => Promise<void>;
    delete: (providerId: string) => Promise<void>;
  };
  /** About metadata from the packaged manifest. */
  about?: () => HostResult;
  /** Whether a provider currently holds a usable credential. */
  hasCredential?: (providerId: string) => Promise<boolean>;
}

interface Session {
  id: string;
  title?: string;
  updatedAt: string;
  history: unknown[];
}

export interface AgentHost {
  handle(raw: unknown): Promise<HostResponse>;
  newSession(): string;
  selectProvider(connectionId: string): Promise<void>;
  selectModel(connectionId: string, modelId: string): Promise<void>;
  getSelectedModel(): { providerId: string; modelId: string } | undefined;
  getApprovalSettings(): ApprovalSettings;
  waitForIdle(): Promise<void>;
  dispose(): void;
}

/**
 * Extension-host side of the webview protocol. It owns the agent loop, the
 * workspace jail, and every approval decision; the webview only sends intents
 * and renders results.
 */
export function createAgentHost(services: HostServices): AgentHost {
  const router = new Router();
  const sessions = new Map<string, Session>();
  const settings: ApprovalSettings = { ...DEFAULT_APPROVAL_SETTINGS };
  const gate = createApprovalGate(settings, (request) => services.onApproval?.(request));
  /** The gate owning the in-flight turn; replaced per turn so its policy applies. */
  let activeGate: ApprovalGate = gate;
  const loop = new AgentLoop();

  let connectionId: string | undefined;
  let provider: IProviderAdapter | undefined;
  let selectedModel: { providerId: string; modelId: string } | undefined;
  let activeSession: string | undefined;
  let controller: AbortController | undefined;
  let running: Promise<unknown> | undefined;
  let disposed = false;

  /** Catalog proven free for the connection, resolved through the shared policy. */
  async function provenFree(connection: string, adapter: IProviderAdapter): Promise<ModelInventoryEntry[]> {
    return filterProvenFreeModels(connection, await adapter.discoverModels());
  }

  async function connect(connection: string): Promise<void> {
    if (services.providers && !services.providers().some((item) => item.id === connection)) {
      throw new HostError('UNKNOWN_PROVIDER', `No such provider: ${connection}`);
    }
    connectionId = connection;
    provider = await services.createProvider(connection);
    // A model proven for the old provider proves nothing about the new one.
    selectedModel = undefined;
  }

  /** Plan mode changes nothing, so edit and fetch always need a human decision. */
  function approvalSettingsFor(mode: string): ApprovalSettings {
    return mode === 'Plan' ? { ...settings, edit: false, web_fetch: false } : { ...settings };
  }

  async function runTurn(intent: Extract<HostIntent, { type: 'start_turn' }>): Promise<HostResult> {
    if (running) throw new HostError('TURN_ACTIVE', 'A task is already running.');
    const session = sessions.get(intent.sessionId);
    if (!session) throw new HostError('UNKNOWN_SESSION', `No such session: ${intent.sessionId}`);
    if (!connectionId || !provider) throw new HostError('NO_PROVIDER', 'Choose and connect a provider first.');
    if (!selectedModel) throw new HostError('NO_MODEL', 'Choose a model first.');

    const turnApproval = approvalSettingsFor(intent.mode);
    activeGate = createApprovalGate(turnApproval, (request) => services.onApproval?.(request));
    controller = new AbortController();
    activeSession = session.id;
    running = loop.run(intent.prompt, {
      workspaceRoot: services.workspaceRoot,
      provider,
      tools: withApprovalSettings(services.createTools(), turnApproval),
      approvalHandler: activeGate,
      router,
      routeOptions: { pinnedModelId: selectedModel.modelId },
      hostEventListener: (envelope) => services.onEvent?.(envelope),
      signal: controller.signal,
    }).finally(() => {
      controller = undefined;
      activeSession = undefined;
      running = undefined;
    });
    // The turn outlives this response; its results arrive as host events.
    void running.catch(() => undefined);
    session.title ??= intent.prompt.slice(0, 60);
    session.updatedAt = new Date().toISOString();
    return { type: 'turn_started', sessionId: session.id };
  }

  async function dispatch(intent: HostIntent): Promise<HostResult> {
    switch (intent.type) {
      case 'list_providers': {
        const list = services.providers ? services.providers() : listProviderPresets().map((item) => ({ id: item.id, label: item.label }));
        return { type: 'providers', providers: list.map((item) => ({ id: item.id, name: item.label })) };
      }
      case 'select_provider':
        await connect(intent.providerId);
        return { type: 'provider_selected', providerId: intent.providerId };
      case 'list_models': {
        if (!provider || connectionId !== intent.providerId) await connect(intent.providerId);
        const entries = await provenFree(intent.providerId, provider!);
        return {
          type: 'models',
          providerId: intent.providerId,
          models: entries.map((entry) => ({
            id: entry.id,
            created: entry.created,
            ownedBy: entry.owned_by,
            classification: router.classifyModel(entry.id, false, entry.supported_parameters),
            // Every entry here already cleared the free policy.
            verifiedFree: true as const,
          })),
        };
      }
      case 'select_model': {
        if (intent.providerId !== connectionId) await connect(intent.providerId);
        const entries = await provenFree(intent.providerId, provider!);
        if (!entries.some((entry) => entry.id === intent.modelId)) {
          throw new HostError('MODEL_NOT_FREE', `${intent.modelId} is not a verified free model for ${intent.providerId}.`);
        }
        selectedModel = { providerId: intent.providerId, modelId: intent.modelId };
        return { type: 'model_selected', providerId: intent.providerId, modelId: intent.modelId };
      }
      case 'set_credential': {
        // Write-only: the key goes to SecretStorage and is never echoed back.
        if (!services.credentials) throw new HostError('NO_SECRET_STORE', 'This host cannot store credentials.');
        await services.credentials.set(intent.providerId, intent.apiKey);
        return { type: 'credential_updated', providerId: intent.providerId };
      }
      case 'clear_credential': {
        if (!services.credentials) throw new HostError('NO_SECRET_STORE', 'This host cannot store credentials.');
        await services.credentials.delete(intent.providerId);
        return { type: 'credential_updated', providerId: intent.providerId };
      }
      case 'test_connection': {
        const known = listProviderPresets().some((item) => item.id === intent.providerId);
        if (!known) throw new HostError('UNKNOWN_PROVIDER', `No such provider: ${intent.providerId}`);
        const needsKey = Boolean(findProviderPreset(intent.providerId)?.requiresApiKey);
        if (needsKey && !(await services.hasCredential?.(intent.providerId))) {
          return { type: 'connection_tested', providerId: intent.providerId, ok: false, modelCount: 0, message: 'Add an API key for this provider first.' };
        }
        try {
          const adapter = await services.createProvider(intent.providerId);
          const models = filterProvenFreeModels(intent.providerId, await adapter.discoverModels());
          return {
            type: 'connection_tested',
            providerId: intent.providerId,
            ok: true,
            modelCount: models.length,
            message: models.length ? `Connected. ${models.length} verified free model(s).` : 'Connected, but no verified free models.',
          };
        } catch (err) {
          return {
            type: 'connection_tested',
            providerId: intent.providerId,
            ok: false,
            modelCount: 0,
            message: err instanceof Error ? err.message : String(err),
          };
        }
      }
      case 'get_about':
        if (!services.about) throw new HostError('NO_ABOUT', 'About metadata is unavailable.');
        return services.about();
      case 'start_turn':
        return runTurn(intent);
      case 'cancel_turn': {
        if (intent.sessionId !== activeSession) throw new HostError('NO_ACTIVE_TURN', 'No task is running for this session.');
        controller?.abort();
        return { type: 'turn_cancelled', sessionId: intent.sessionId };
      }
      case 'resolve_approval': {
        // A decision may only settle a request raised by the session asking.
        if (intent.sessionId !== activeSession) throw new HostError('STALE_DECISION', 'That request belongs to another session.');
        if (!activeGate.resolve(intent.approvalRequestId, intent.status)) throw new HostError('UNKNOWN_APPROVAL', 'That request is no longer pending.');
        return { type: 'approval_resolved', sessionId: intent.sessionId, approvalRequestId: intent.approvalRequestId, status: intent.status };
      }
      case 'update_settings':
        settings[intent.category] = intent.enabled;
        return { type: 'settings_updated', category: intent.category, enabled: intent.enabled };
      case 'list_sessions':
        return {
          type: 'sessions',
          sessions: [...sessions.values()].map((session) => ({
            id: session.id,
            title: session.title,
            updatedAt: session.updatedAt,
            providerId: selectedModel?.providerId,
            modelId: selectedModel?.modelId,
          })),
        };
      case 'resume_session':
        if (!sessions.has(intent.sessionId)) throw new HostError('UNKNOWN_SESSION', `No such session: ${intent.sessionId}`);
        return { type: 'session_resumed', sessionId: intent.sessionId };
    }
  }

  return {
    async handle(raw: unknown): Promise<HostResponse> {
      const requestId = typeof (raw as { requestId?: unknown } | null)?.requestId === 'string'
        ? (raw as { requestId: string }).requestId
        : 'unknown';
      const parsed = HostIntentSchema.safeParse(raw);
      if (!parsed.success) return { protocolVersion: 1, requestId, ok: false, error: { code: 'BAD_INTENT', message: 'Unrecognized webview message.' } };
      const intent = parsed.data;
      try {
        if (disposed) throw new HostError('HOST_DISPOSED', 'The Moderado view is closed.');
        return HostResponseSchema.parse({ protocolVersion: 1, requestId: intent.requestId, ok: true, result: await dispatch(intent) });
      } catch (err) {
        return {
          protocolVersion: 1,
          requestId: intent.requestId,
          ok: false,
          error: { code: err instanceof HostError ? err.code : 'HOST_ERROR', message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
    newSession(): string {
      const session: Session = { id: crypto.randomUUID(), updatedAt: new Date().toISOString(), history: [] };
      sessions.set(session.id, session);
      return session.id;
    },
    selectProvider: connect,
    selectModel: async (connection: string, model: string) => {
      await dispatch({ protocolVersion: 1, requestId: 'direct', type: 'select_model', providerId: connection, modelId: model });
    },
    getSelectedModel: () => selectedModel,
    getApprovalSettings: () => ({ ...settings }),
    async waitForIdle() {
      await running?.catch(() => undefined);
    },
    dispose() {
      disposed = true;
      // A closed view must not leave a tool call or a decision pending.
      controller?.abort();
      gate.dispose();
      activeGate.dispose();
    },
  };
}