import path from 'node:path';
import type {
  HostNotification,
  HostRequest,
  InitializeRequest,
  InitializeResult,
  IProviderAdapter,
  IToolRegistry,
} from '@moderado/contracts';
import { AgentLoop, HostEventStream, PolicyManager, Router } from '@moderado/core';
import { canonicalizeRoot, createDefaultToolRegistry, resolveInJail } from '@moderado/tools';
import { NvidiaAdapter } from '@moderado/providers';
import {
  getActiveConnection,
  loadConfig,
  resolveApiKey,
  resolveConnectionCredential,
} from '../config.js';
import { CredentialStore, MemoryCredentialStore } from '../credentials.js';
import { WindowsCredentialStore } from '../windows_credentials.js';
import { createSession, SessionStore, type StoredSession } from '../sessions.js';
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
    ? (config.connections[providerIdOverride] ?? getActiveConnection(config))
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
  const credentialStore = dependencies?.credentialStore;
  const provider =
    dependencies?.provider ?? (await resolveDefaultProvider(customHome, credentialStore, options.providerId));
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
          activeGeneration.requestId === request.params.targetRequestId
        ) {
          activeGeneration.abortController.abort();
          activeGeneration = null;
        }

        return { cancelled: true };
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

        let turnPrompt = request.params.text;
        if (request.params.context?.selection) {
          const sel = request.params.context.selection;
          turnPrompt = `Active selection in workspace file "${sel.relativePath}" (lines ${sel.startLine}-${sel.endLine}):\n\`\`\`\n${sel.text ?? ''}\n\`\`\`\n\n${turnPrompt}`;
        }

        const abortController = new AbortController();

        const generationPromise = (async () => {
          try {
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
