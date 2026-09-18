import crypto from 'node:crypto';
import {
  AgentEventListener,
  ApprovalDecision,
  ApprovalRequest,
  AssistantMessage,
  ChatUsage,
  ChatMessage,
  DiscoveredModel,
  EmptyResponseError,
  IApprovalHandler,
  IProviderAdapter,
  IToolRegistry,
  ModelInventoryEntry,
  ModelUnavailableError,
  RateLimitError,
  ToolCall,
  ToolResult,
} from '@moderado/contracts';
import { Router, RouteSelectionOptions } from './router.js';
import { PolicyManager } from './policy.js';

export interface AgentRunOptions {
  workspaceRoot: string;
  provider: IProviderAdapter;
  tools: IToolRegistry;
  approvalHandler: IApprovalHandler;
  router?: Router;
  policy?: PolicyManager;
  routeOptions?: RouteSelectionOptions;
  eventListener?: AgentEventListener;
  signal?: AbortSignal;
  conversationHistory?: ChatMessage[];
  modelInventory?: ModelInventoryEntry[];
}

export interface AgentRunResult {
  status: 'completed' | 'step_limit_reached' | 'cancelled' | 'failed';
  totalSteps: number;
  finalMessage: string | null;
  selectedModel: DiscoveredModel;
  messages: ChatMessage[];
  usage?: ChatUsage;
}

const DEFAULT_SYSTEM_PROMPT = `You are Moderado, a lightweight, pragmatic, bloat-free AI coding agent.
You follow the Ponytail Decision Ladder: YAGNI, standard library first, zero unnecessary dependencies, and minimal code.
Use the provided workspace tools to inspect, read, search, modify, and test files within the workspace.

CORE OPERATIONAL RULES:
- If the user prompt is a greeting, question, explanation request, or conversational query, output regular markdown text directly without calling any tools.
- ONLY invoke tools when explicitly needed to inspect or modify the workspace as requested by the user.
- NEVER create, write, or overwrite any files (including documentation, project summaries, or boilerplate) unless the user explicitly commanded you to create or modify that file in their prompt.
- Do NOT create unsolicited files on your own initiative.
- Always inspect existing code (with list_files, read_file, search_files) before editing. Keep edits focused, clean, and test-driven.
- Do NOT invent tool names.`;

function buildSystemPrompt(modelId: string, workspaceRoot: string): string {
  return `${DEFAULT_SYSTEM_PROMPT}

SYSTEM RUNTIME CONTEXT:
- Active Model: ${modelId}
- Workspace Root: ${workspaceRoot}`;
}

const PSEUDO_ANSWER_TOOLS = new Set([
  'answer_directly',
  'answer',
  'respond',
  'response',
  'chat',
  'message',
  'final_answer',
  'reply',
]);

export class AgentLoop {
  async run(task: string, options: AgentRunOptions): Promise<AgentRunResult> {
    const emit = options.eventListener ?? (() => {});
    const policy = options.policy ?? new PolicyManager();
    const router = options.router ?? new Router();
    const signal = options.signal;
    let latestUsage: ChatUsage | undefined;

    if (signal?.aborted) {
      emit({ type: 'cancellation', reason: 'Aborted by user', timestamp: Date.now() });
      return {
        status: 'cancelled',
        totalSteps: 0,
        finalMessage: null,
        selectedModel: {
          id: 'aborted',
          ownedBy: 'system',
          classification: {
            modelId: 'aborted',
            accessTier: 'unknown',
            toolSupport: 'unknown',
            source: 'heuristic',
          },
        },
        messages: options.conversationHistory ? [...options.conversationHistory] : [],
        usage: latestUsage,
      };
    }

    // 1. Model Discovery & Routing
    let inventory = options.modelInventory;
    if (!inventory || inventory.length === 0) {
      if (options.routeOptions?.pinnedModelId) {
        try {
          inventory = await options.provider.discoverModels(signal);
        } catch {
          // A pinned model can still be usable when its provider does not
          // expose a model catalogue. Continue without dynamic metadata.
          inventory = [{ id: options.routeOptions.pinnedModelId, object: 'model', owned_by: options.provider.id }];
        }
      } else {
        emit({
          type: 'progress',
          step: 0,
          maxSteps: policy.maxSteps,
          status: 'Discovering and selecting models...',
          timestamp: Date.now(),
        });
        inventory = await options.provider.discoverModels(signal);
      }
    }

    const { selectedModel: initialModel, rankedCandidates } = router.selectModel(
      inventory,
      options.routeOptions
    );

    let currentModel = initialModel;
    emit({
      type: 'model_change',
      newModelId: currentModel.id,
      reason: options.routeOptions?.pinnedModelId ? 'user_pinned' : 'initial_selection',
      accessClass: currentModel.classification.accessTier,
      timestamp: Date.now(),
    });

    // 2. Initialize Conversation Context
    const messages: ChatMessage[] =
      options.conversationHistory && options.conversationHistory.length > 0
        ? [...options.conversationHistory, { role: 'user', content: task }]
        : [
            { role: 'system', content: buildSystemPrompt(currentModel.id, options.workspaceRoot) },
            { role: 'user', content: task },
          ];

    let step = 0;
    let finalAssistantText: string | null = null;

    while (policy.isStepWithinLimit(step)) {
      if (signal?.aborted) {
        emit({ type: 'cancellation', reason: 'Aborted by user', timestamp: Date.now() });
        return {
          status: 'cancelled',
          totalSteps: step,
          finalMessage: finalAssistantText,
          selectedModel: currentModel,
          messages,
          usage: latestUsage,
        };
      }

      step++;
      emit({
        type: 'progress',
        step,
        maxSteps: policy.maxSteps,
        status: `Step ${step}/${policy.maxSteps}: Inferring next action with ${currentModel.id}...`,
        timestamp: Date.now(),
      });

      // 3. Inference with Streaming
      let assistantText = '';
      const toolCallDeltas: Map<number, { id?: string; name?: string; args: string }> = new Map();

      try {
        const stream = options.provider.streamChat({
          modelId: currentModel.id,
          messages,
          tools:
            currentModel.classification.toolSupport === 'unsupported'
              ? undefined
              : options.tools.getDeclarations(),
          signal,
        });

        for await (const chunk of stream) {
          if (signal?.aborted) {
            emit({ type: 'cancellation', reason: 'Aborted by user', timestamp: Date.now() });
            return {
              status: 'cancelled',
              totalSteps: step,
              finalMessage: finalAssistantText,
              selectedModel: currentModel,
              messages,
              usage: latestUsage,
            };
          }

          if (chunk.reasoningDelta) {
            emit({
              type: 'reasoning_delta',
              delta: chunk.reasoningDelta,
              timestamp: Date.now(),
            });
          }

          if (chunk.contentDelta) {
            assistantText += chunk.contentDelta;
            emit({
              type: 'assistant_delta',
              delta: chunk.contentDelta,
              timestamp: Date.now(),
            });
          }

          if (chunk.usage) {
            latestUsage = chunk.usage;
          }

          if (chunk.toolCallChunks) {
            for (const delta of chunk.toolCallChunks) {
              const current = toolCallDeltas.get(delta.index) ?? { args: '' };
              if (delta.id) current.id = delta.id;
              if (delta.name) current.name = delta.name;
              if (delta.argumentsDelta) current.args += delta.argumentsDelta;
              toolCallDeltas.set(delta.index, current);
            }
          }
        }
      } catch (err: any) {
        // Handle transient errors & failover cascades in AUTO mode
        const isTransient = err instanceof RateLimitError || err instanceof ModelUnavailableError;
        const isAutoMode = !options.routeOptions?.pinnedModelId;

        if (isTransient && isAutoMode) {
          const fallback = router.getNextFallback(rankedCandidates, currentModel.id);
          if (fallback) {
            emit({
              type: 'model_change',
              previousModelId: currentModel.id,
              newModelId: fallback.id,
              reason: err instanceof RateLimitError ? 'fallback_rate_limit' : 'fallback_unavailable',
              accessClass: fallback.classification.accessTier,
              timestamp: Date.now(),
            });
            currentModel = fallback;
            step--; // Retry current step without consuming step limit
            continue;
          }
        }

        emit({
          type: 'error',
          code: err.code ?? 'ERR_INFERENCE_FAILED',
          message: err.message,
          recoverable: false,
          timestamp: Date.now(),
        });
        return {
          status: 'failed',
          totalSteps: step,
          finalMessage: null,
          selectedModel: currentModel,
          messages,
          usage: latestUsage,
        };
      }

      finalAssistantText = assistantText || null;

      // 4. Assemble Completed Tool Calls
      const completedToolCalls: ToolCall[] = [];
      for (const [, delta] of Array.from(toolCallDeltas.entries()).sort(([a], [b]) => a - b)) {
        if (delta.name) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = delta.args ? JSON.parse(delta.args) : {};
          } catch {
            parsedArgs = { _raw: delta.args };
          }
          completedToolCalls.push({
            id: delta.id ?? `call_${crypto.randomUUID()}`,
            name: delta.name,
            arguments: parsedArgs,
          });
        }
      }

      if (!assistantText.trim() && completedToolCalls.length === 0) {
        const emptyResponse = new EmptyResponseError(
          `${options.provider.name} returned no assistant content or tool calls for ${currentModel.id}.`
        );
        const isAutoMode = !options.routeOptions?.pinnedModelId;
        const fallback = isAutoMode
          ? router.getNextFallback(rankedCandidates, currentModel.id)
          : undefined;

        if (fallback) {
          emit({
            type: 'model_change',
            previousModelId: currentModel.id,
            newModelId: fallback.id,
            reason: 'fallback_unavailable',
            accessClass: fallback.classification.accessTier,
            timestamp: Date.now(),
          });
          currentModel = fallback;
          step--;
          continue;
        }

        emit({
          type: 'error',
          code: emptyResponse.code,
          message: emptyResponse.message,
          recoverable: false,
          timestamp: Date.now(),
        });
        return {
          status: 'failed',
          totalSteps: step,
          finalMessage: null,
          selectedModel: currentModel,
          messages,
          usage: latestUsage,
        };
      }

      // Record Assistant message
      const assistantMessage: AssistantMessage = {
        role: 'assistant',
        content: assistantText || null,
        toolCalls: completedToolCalls.length > 0 ? completedToolCalls : undefined,
      };
      messages.push(assistantMessage);

      // If no tool calls, task is finished!
      if (completedToolCalls.length === 0) {
        emit({
          type: 'completion',
          status: 'completed',
          totalSteps: step,
          summary: assistantText || undefined,
          timestamp: Date.now(),
        });
        return {
          status: 'completed',
          totalSteps: step,
          finalMessage: assistantText,
          selectedModel: currentModel,
          messages,
          usage: latestUsage,
        };
      }

      // 5. Execute Each Tool Call
      for (const call of completedToolCalls) {
        if (signal?.aborted) {
          emit({ type: 'cancellation', reason: 'Aborted by user', timestamp: Date.now() });
            return {
              status: 'cancelled',
              totalSteps: step,
              finalMessage: finalAssistantText,
              selectedModel: currentModel,
              messages,
              usage: latestUsage,
            };
        }

        emit({
          type: 'tool_call_initiated',
          toolCallId: call.id,
          toolName: call.name,
          parameters: call.arguments,
          timestamp: Date.now(),
        });

        if (PSEUDO_ANSWER_TOOLS.has(call.name.toLowerCase())) {
          const answerText =
            (typeof call.arguments.text === 'string' && call.arguments.text) ||
            (typeof call.arguments.message === 'string' && call.arguments.message) ||
            (typeof call.arguments.content === 'string' && call.arguments.content) ||
            (typeof call.arguments.response === 'string' && call.arguments.response) ||
            (typeof call.arguments.answer === 'string' && call.arguments.answer) ||
            (typeof call.arguments._raw === 'string' && call.arguments._raw) ||
            JSON.stringify(call.arguments);

          emit({
            type: 'assistant_delta',
            delta: (assistantText ? '\n' : '') + answerText,
            timestamp: Date.now(),
          });
          assistantText = (assistantText ? assistantText + '\n' : '') + answerText;
          finalAssistantText = assistantText;

          const handledResult: ToolResult = {
            toolName: call.name,
            status: 'success',
            output: 'Response delivered.',
          };
          emit({ type: 'tool_result', toolCallId: call.id, result: handledResult, timestamp: Date.now() });
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: handledResult.output,
            status: 'success',
          });
          continue;
        }

        const tool = options.tools.get(call.name);
        if (!tool) {
          const notFoundResult: ToolResult = {
            toolName: call.name,
            status: 'error',
            output: `Unknown tool: '${call.name}'.`,
          };
          emit({ type: 'tool_result', toolCallId: call.id, result: notFoundResult, timestamp: Date.now() });
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: notFoundResult.output,
            status: 'error',
          });
          continue;
        }

        // Validate parameter schema
        const parseResult = tool.parametersSchema.safeParse(call.arguments);
        if (!parseResult.success) {
          const validationResult: ToolResult = {
            toolName: call.name,
            status: 'error',
            output: `Invalid arguments for tool '${call.name}': ${parseResult.error.message}`,
          };
          emit({ type: 'tool_result', toolCallId: call.id, result: validationResult, timestamp: Date.now() });
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: validationResult.output,
            status: 'error',
          });
          continue;
        }

        // Intercept unsolicited README/documentation write operations before approval gate
        if (call.name === 'write_file' || call.name === 'edit_file') {
          const rawPath = String((call.arguments as any)?.path ?? '').trim();
          const normPath = rawPath.toLowerCase().replace(/\\/g, '/');
          const isReadmeTarget = normPath === 'readme.md' || normPath.endsWith('/readme.md');
          const taskLower = task.toLowerCase();

          if (isReadmeTarget && !taskLower.includes('readme')) {
            const rejectedResult: ToolResult = {
              toolName: call.name,
              status: 'error',
              output: `Unsolicited file modification rejected: Do not create or edit README.md unless explicitly commanded by the user's prompt. Please answer the user directly or address their actual request.`,
            };
            emit({ type: 'tool_result', toolCallId: call.id, result: rejectedResult, timestamp: Date.now() });
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              name: call.name,
              content: rejectedResult.output,
              status: 'error',
            });
            continue;
          }
        }

        // Check policy constraints (read-only, non-interactive)
        const policyCheck = policy.validateToolAction(call.name, tool.requiresApproval);
        if (!policyCheck.allowed) {
          const deniedResult: ToolResult = {
            toolName: call.name,
            status: 'denied',
            output: policyCheck.reason ?? 'Denied by security policy.',
          };
          emit({ type: 'tool_result', toolCallId: call.id, result: deniedResult, timestamp: Date.now() });
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: deniedResult.output,
            status: 'denied',
          });
          continue;
        }

        // Approval Boundary
        if (tool.requiresApproval) {
          const requestId = `req_${crypto.randomUUID()}`;
          const requestPayload: ApprovalRequest = {
            requestId,
            toolName: call.name,
            actionSummary: `Execute ${call.name} with ${JSON.stringify(call.arguments)}`,
            exactPayload: {
              targetFile: (call.arguments as any).path,
              command: (call.arguments as any).command
                ? [(call.arguments as any).command, ...((call.arguments as any).args ?? [])]
                : undefined,
              cwd: options.workspaceRoot,
            },
            timestamp: Date.now(),
          };

          emit({ type: 'approval_request', request: requestPayload, timestamp: Date.now() });

          let decision: ApprovalDecision;
          try {
            decision = await options.approvalHandler.requestApproval(requestPayload, signal);
          } catch (err: any) {
            decision = { requestId, status: 'aborted', reason: err.message };
          }

          emit({
            type: 'approval_resolved',
            requestId,
            status: decision.status,
            reason: decision.reason,
            timestamp: Date.now(),
          });

          if (decision.status !== 'approved') {
            const userDeniedResult: ToolResult = {
              toolName: call.name,
              status: 'denied',
              output: `Action '${call.name}' was denied by the user: ${decision.reason ?? 'Approval denied'}`,
            };
            emit({ type: 'tool_result', toolCallId: call.id, result: userDeniedResult, timestamp: Date.now() });
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              name: call.name,
              content: userDeniedResult.output,
              status: 'denied',
            });
            continue;
          }
        }

        // Execute tool inside workspace
        let result: ToolResult;
        try {
          result = await tool.execute(parseResult.data, {
            workspaceRoot: options.workspaceRoot,
            abortSignal: signal,
          });
        } catch (err: any) {
          result = {
            toolName: call.name,
            status: 'error',
            output: `Tool execution failed: ${err.message}`,
          };
        }

        emit({ type: 'tool_result', toolCallId: call.id, result, timestamp: Date.now() });
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: result.output,
          status: result.status,
        });
      }

      // If all executed tools in this turn were pseudo-answering tools, task is complete!
      const hasRealTool = completedToolCalls.some(
        (c) => !PSEUDO_ANSWER_TOOLS.has(c.name.toLowerCase())
      );
      if (!hasRealTool) {
        emit({
          type: 'completion',
          status: 'completed',
          totalSteps: step,
          summary: assistantText || undefined,
          timestamp: Date.now(),
        });
        return {
          status: 'completed',
          totalSteps: step,
          finalMessage: assistantText,
          selectedModel: currentModel,
          messages,
          usage: latestUsage,
        };
      }
    }

    // Max steps reached
    emit({
      type: 'completion',
      status: 'step_limit_reached',
      totalSteps: step,
      summary: `Reached maximum step limit (${policy.maxSteps}).`,
      timestamp: Date.now(),
    });

    return {
      status: 'step_limit_reached',
      totalSteps: step,
      finalMessage: finalAssistantText,
      selectedModel: currentModel,
      messages,
      usage: latestUsage,
    };
  }
}
