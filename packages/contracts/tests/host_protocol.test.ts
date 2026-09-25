import { describe, expect, it } from 'vitest';
import {
  ApprovalRespondRequestSchema,
  ChatCancelRequestSchema,
  ChatSendRequestSchema,
  HostErrorCodeSchema,
  HostErrorResponseSchema,
  HostNotificationSchema,
  HostRequestSchema,
  HostResponseSchema,
  HostSuccessResponseSchema,
  InitializeRequestSchema,
  ModelListRequestSchema,
  ModelListResultSchema,
  ProviderConnectRequestSchema,
  ProviderListRequestSchema,
  ProviderListResultSchema,
  SessionNewRequestSchema,
  SessionResumeRequestSchema,
} from '../src/index.js';

describe('Host protocol v1 contracts', () => {
  describe('HostRequestSchema', () => {
    it('validates a valid initialize request', () => {
      const parsed = HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-init',
        method: 'initialize',
        params: { protocolVersion: 1 },
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.method).toBe('initialize');
        expect(parsed.data.params.protocolVersion).toBe(1);
      }
    });

    it('rejects unsupported protocol versions in initialize', () => {
      const parsed = HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-init',
        method: 'initialize',
        params: { protocolVersion: 2 },
      });
      expect(parsed.success).toBe(false);
    });

    it('validates a valid chat.send request without context', () => {
      const parsed = HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-1',
        method: 'chat.send',
        params: {
          sessionId: 'session-1',
          text: 'review this function',
        },
      });
      expect(parsed.success).toBe(true);
    });

    it('validates a valid chat.send request with selection context', () => {
      const parsed = HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-2',
        method: 'chat.send',
        params: {
          sessionId: 'session-1',
          text: 'explain this code',
          context: {
            selection: {
              relativePath: 'src/parser.ts',
              startLine: 12,
              endLine: 18,
              text: 'function parse(input) { return true; }',
            },
          },
        },
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects chat.send with empty prompt text', () => {
      const parsed = HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-empty',
        method: 'chat.send',
        params: {
          sessionId: 'session-1',
          text: '',
        },
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects chat.send with prompt exceeding 100,000 characters', () => {
      const parsed = HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-large',
        method: 'chat.send',
        params: {
          sessionId: 'session-1',
          text: 'a'.repeat(100_001),
        },
      });
      expect(parsed.success).toBe(false);
    });

    it('validates chat.cancel without a target request id (cancel active generation)', () => {
      expect(ChatCancelRequestSchema.safeParse({
        type: 'request',
        id: 'req-cancel',
        method: 'chat.cancel',
        params: { sessionId: 'session-1' },
      }).success).toBe(true);
      expect(ChatCancelRequestSchema.safeParse({
        type: 'request',
        id: 'req-cancel2',
        method: 'chat.cancel',
        params: { sessionId: 'session-1', targetRequestId: 'req-send-1' },
      }).success).toBe(true);
      expect(ChatCancelRequestSchema.safeParse({
        type: 'request',
        id: 'req-cancel3',
        method: 'chat.cancel',
        params: { sessionId: 'session-1', targetRequestId: '' },
      }).success).toBe(false);
    });

    it('rejects chat.send with selection text exceeding 20,000 characters', () => {
      const parsed = HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-sel-large',
        method: 'chat.send',
        params: {
          sessionId: 'session-1',
          text: 'check this',
          context: {
            selection: {
              relativePath: 'src/file.ts',
              startLine: 1,
              endLine: 10,
              text: 'x'.repeat(20_001),
            },
          },
        },
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects chat.send with selection relativePath having POSIX path traversal', () => {
      const parsed = HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-traversal-posix',
        method: 'chat.send',
        params: {
          sessionId: 'session-1',
          text: 'review',
          context: {
            selection: {
              relativePath: '../secret.txt',
              startLine: 1,
              endLine: 1,
              text: 'secret',
            },
          },
        },
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects chat.send with selection relativePath having Windows path traversal', () => {
      const parsed = HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-traversal-win',
        method: 'chat.send',
        params: {
          sessionId: 'session-1',
          text: 'review',
          context: {
            selection: {
              relativePath: 'foo\\..\\secret.txt',
              startLine: 1,
              endLine: 1,
            },
          },
        },
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects chat.send with absolute POSIX or Windows drive paths in selection', () => {
      for (const badPath of ['/etc/passwd', 'C:\\Windows\\system32', 'd:/projects/test.ts', '\\\\server\\share']) {
        const parsed = HostRequestSchema.safeParse({
          type: 'request',
          id: 'req-abs',
          method: 'chat.send',
          params: {
            sessionId: 'session-1',
            text: 'review',
            context: {
              selection: {
                relativePath: badPath,
                startLine: 1,
                endLine: 1,
              },
            },
          },
        });
        expect(parsed.success, `Expected path ${badPath} to be rejected`).toBe(false);
      }
    });

    it('rejects selection with invalid line bounds (endLine < startLine or non-positive)', () => {
      const inverted = HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-inv',
        method: 'chat.send',
        params: {
          sessionId: 'session-1',
          text: 'review',
          context: {
            selection: {
              relativePath: 'src/file.ts',
              startLine: 10,
              endLine: 5,
            },
          },
        },
      });
      expect(inverted.success).toBe(false);

      const zeroLine = HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-zero',
        method: 'chat.send',
        params: {
          sessionId: 'session-1',
          text: 'review',
          context: {
            selection: {
              relativePath: 'src/file.ts',
              startLine: 0,
              endLine: 10,
            },
          },
        },
      });
      expect(zeroLine.success).toBe(false);
    });

    it('validates a valid chat.cancel request', () => {
      const parsed = HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-cancel',
        method: 'chat.cancel',
        params: {
          sessionId: 'session-1',
          targetRequestId: 'req-18',
        },
      });
      expect(parsed.success).toBe(true);
    });

    it('validates a valid approval.respond request', () => {
      for (const status of ['approved', 'denied', 'aborted'] as const) {
        const parsed = HostRequestSchema.safeParse({
          type: 'request',
          id: `req-appr-${status}`,
          method: 'approval.respond',
          params: {
            sessionId: 'session-1',
            requestId: 'approval-123',
            status,
          },
        });
        expect(parsed.success).toBe(true);
      }
    });

    it('rejects approval.respond with unknown status', () => {
      const parsed = HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-appr-bad',
        method: 'approval.respond',
        params: {
          sessionId: 'session-1',
          requestId: 'approval-123',
          status: 'rejected',
        },
      });
      expect(parsed.success).toBe(false);
    });

    it('validates session.new and session.resume requests', () => {
      const newParsed = HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-new',
        method: 'session.new',
        params: { sessionId: 'session-current' },
      });
      expect(newParsed.success).toBe(true);

      const resumeParsed = HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-resume',
        method: 'session.resume',
        params: { sessionId: 'session-current', targetSessionId: 'session-target' },
      });
      expect(resumeParsed.success).toBe(true);
    });

    it('rejects requests with missing or empty id', () => {
      const missingId = HostRequestSchema.safeParse({
        type: 'request',
        method: 'initialize',
        params: { protocolVersion: 1 },
      });
      expect(missingId.success).toBe(false);

      const emptyId = HostRequestSchema.safeParse({
        type: 'request',
        id: '',
        method: 'initialize',
        params: { protocolVersion: 1 },
      });
      expect(emptyId.success).toBe(false);
    });

    it('rejects unknown request methods', () => {
      const parsed = HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-unknown',
        method: 'unsupported.action',
        params: {},
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe('Model manager requests', () => {
    it('validates provider.list with empty params', () => {
      const parsed = HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-pl',
        method: 'provider.list',
        params: {},
      });
      expect(parsed.success).toBe(true);
    });

    it('validates provider.connect with an API key', () => {
      const parsed = HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-pc',
        method: 'provider.connect',
        params: { providerId: 'openrouter', apiKey: 'sk-or-test' },
      });
      expect(parsed.success).toBe(true);
    });

    it('validates provider.connect without an API key for re-activation', () => {
      const parsed = HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-pc2',
        method: 'provider.connect',
        params: { providerId: 'nvidia-nim' },
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects provider.connect with an empty api key or unsafe provider id', () => {
      expect(HostRequestSchema.safeParse({
        type: 'request',
        id: 'r1',
        method: 'provider.connect',
        params: { providerId: 'openrouter', apiKey: '' },
      }).success).toBe(false);
      expect(HostRequestSchema.safeParse({
        type: 'request',
        id: 'r2',
        method: 'provider.connect',
        params: { providerId: '../evil' },
      }).success).toBe(false);
      expect(HostRequestSchema.safeParse({
        type: 'request',
        id: 'r3',
        method: 'provider.connect',
        params: { providerId: 'openrouter', apiKey: 'k'.repeat(4097) },
      }).success).toBe(false);
    });

    it('validates model.list with and without an explicit providerId', () => {
      expect(HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-ml',
        method: 'model.list',
        params: {},
      }).success).toBe(true);
      expect(HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-ml2',
        method: 'model.list',
        params: { providerId: 'openrouter' },
      }).success).toBe(true);
      expect(HostRequestSchema.safeParse({
        type: 'request',
        id: 'req-ml3',
        method: 'model.list',
        params: { providerId: '' },
      }).success).toBe(false);
    });

    it('parses result schemas for providers and models', () => {
      const providers = ProviderListResultSchema.safeParse({
        providers: [{
          id: 'openrouter',
          label: 'OpenRouter',
          requiresApiKey: true,
          hasApiKey: true,
          isActive: true,
        }],
        activeProviderId: 'openrouter',
      });
      expect(providers.success).toBe(true);

      const models = ModelListResultSchema.safeParse({
        providerId: 'openrouter',
        models: [{ id: 'qwen/qwen3.8-27b:free', isFree: true, ownedBy: 'qwen' }],
        truncated: false,
      });
      expect(models.success).toBe(true);

      expect(ModelListResultSchema.safeParse({
        providerId: 'openrouter',
        models: [{ id: '', isFree: true }],
      }).success).toBe(false);
    });
  });

  describe('Individual request schemas', () => {
    it('exports strongly-typed schemas for each method', () => {
      expect(InitializeRequestSchema).toBeDefined();
      expect(ChatSendRequestSchema).toBeDefined();
      expect(ChatCancelRequestSchema).toBeDefined();
      expect(ApprovalRespondRequestSchema).toBeDefined();
      expect(SessionNewRequestSchema).toBeDefined();
      expect(SessionResumeRequestSchema).toBeDefined();
      expect(ProviderListRequestSchema).toBeDefined();
      expect(ProviderConnectRequestSchema).toBeDefined();
      expect(ModelListRequestSchema).toBeDefined();
    });
  });

  describe('HostResponseSchema', () => {
    it('validates a successful response with result', () => {
      const parsed = HostResponseSchema.safeParse({
        type: 'response',
        id: 'req-1',
        ok: true,
        result: { protocolVersion: 1, sessionId: 's1', workspaceName: 'project', resumableSessions: [] },
      });
      expect(parsed.success).toBe(true);
      expect(HostSuccessResponseSchema.safeParse(parsed.data).success).toBe(true);
    });

    it('validates an error response with supported error codes', () => {
      const codes = [
        'INVALID_REQUEST',
        'UNSUPPORTED_VERSION',
        'WORKSPACE_DENIED',
        'SESSION_NOT_FOUND',
        'APPROVAL_STALE',
        'BUSY',
        'INTERNAL_ERROR',
      ] as const;

      for (const code of codes) {
        expect(HostErrorCodeSchema.safeParse(code).success).toBe(true);
        const parsed = HostResponseSchema.safeParse({
          type: 'response',
          id: 'req-fail',
          ok: false,
          error: {
            code,
            message: `Failed due to ${code}`,
          },
        });
        expect(parsed.success).toBe(true);
        expect(HostErrorResponseSchema.safeParse(parsed.data).success).toBe(true);
      }
    });

    it('rejects error response with unsupported error code', () => {
      const parsed = HostResponseSchema.safeParse({
        type: 'response',
        id: 'req-fail',
        ok: false,
        error: {
          code: 'UNEXPECTED_CUSTOM_ERROR',
          message: 'Unknown',
        },
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe('HostNotificationSchema', () => {
    it('validates host notification wrapping a valid HostEventEnvelope', () => {
      const parsed = HostNotificationSchema.safeParse({
        type: 'event',
        envelope: {
          protocolVersion: 1,
          sessionId: 'session-123',
          sequence: 1,
          timestamp: Date.now(),
          event: {
            type: 'assistant_delta',
            delta: 'Hello world',
            timestamp: Date.now(),
          },
        },
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects notification with missing envelope or wrong type', () => {
      const badType = HostNotificationSchema.safeParse({
        type: 'notification',
        envelope: {},
      });
      expect(badType.success).toBe(false);
    });
  });
});
