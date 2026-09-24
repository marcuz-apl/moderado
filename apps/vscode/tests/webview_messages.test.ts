import { describe, it, expect } from 'vitest';
import {
  WebviewToHostMessageSchema,
  HostToWebviewMessageSchema,
  type WebviewToHostMessage,
} from '../src/webview/messages.js';

describe('Webview Message Schemas', () => {
  describe('WebviewToHostMessageSchema', () => {
    it('validates a valid send message', () => {
      const msg: WebviewToHostMessage = {
        type: 'send',
        text: 'Fix the bug in parser.ts',
        context: {
          selection: {
            relativePath: 'src/parser.ts',
            startLine: 10,
            endLine: 20,
            text: 'const x = 1;',
          },
        },
      };

      const result = WebviewToHostMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('rejects send message with path traversal in selection relativePath', () => {
      const msg = {
        type: 'send',
        text: 'Hello',
        context: {
          selection: {
            relativePath: '../secret.txt',
            startLine: 1,
            endLine: 5,
          },
        },
      };

      const result = WebviewToHostMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('rejects send message with invalid line bounds (endLine < startLine)', () => {
      const msg = {
        type: 'send',
        text: 'Hello',
        context: {
          selection: {
            relativePath: 'src/index.ts',
            startLine: 50,
            endLine: 10,
          },
        },
      };

      const result = WebviewToHostMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('validates approval decisions (approve and reject)', () => {
      const approveMsg = {
        type: 'approve',
        requestId: 'req-123',
      };
      const rejectMsg = {
        type: 'reject',
        requestId: 'req-123',
        reason: 'Too destructive',
      };

      expect(WebviewToHostMessageSchema.safeParse(approveMsg).success).toBe(true);
      expect(WebviewToHostMessageSchema.safeParse(rejectMsg).success).toBe(true);
    });

    it('validates lifecycle messages (cancel, newSession, resumeSession, attachSelection)', () => {
      expect(WebviewToHostMessageSchema.safeParse({ type: 'cancel' }).success).toBe(true);
      expect(WebviewToHostMessageSchema.safeParse({ type: 'newSession' }).success).toBe(true);
      expect(
        WebviewToHostMessageSchema.safeParse({
          type: 'resumeSession',
          sessionId: 'sess-abc',
        }).success,
      ).toBe(true);
      expect(WebviewToHostMessageSchema.safeParse({ type: 'attachSelection' }).success).toBe(true);
    });

    it('rejects unknown or malformed message types', () => {
      expect(WebviewToHostMessageSchema.safeParse({ type: 'hackTheWorld' }).success).toBe(false);
      expect(WebviewToHostMessageSchema.safeParse(null).success).toBe(false);
      expect(WebviewToHostMessageSchema.safeParse({ type: 'approve' }).success).toBe(false); // missing requestId
    });
  });

  describe('HostToWebviewMessageSchema', () => {
    it('validates state and activeEditorContext messages', () => {
      const editorCtxMsg = {
        type: 'activeEditorContext',
        context: {
          relativePath: 'src/main.ts',
          startLine: 1,
          endLine: 10,
          text: 'console.log("hi");',
        },
      };

      expect(HostToWebviewMessageSchema.safeParse(editorCtxMsg).success).toBe(true);
    });
  });
});
