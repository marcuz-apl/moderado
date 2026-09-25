import { describe, it, expect } from 'vitest';
import {
  WebviewToHostMessageSchema,
  HostToWebviewMessageSchema,
} from '../src/webview/messages.js';

describe('sidecar unavailable messaging', () => {
  it('accepts a retry request from the webview', () => {
    const parsed = WebviewToHostMessageSchema.safeParse({ type: 'retrySidecar' });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown webview message type', () => {
    expect(WebviewToHostMessageSchema.safeParse({ type: 'notAThing' }).success).toBe(false);
  });

  it('accepts an unavailable notice carrying an actionable message', () => {
    const parsed = HostToWebviewMessageSchema.safeParse({
      type: 'sidecarUnavailable',
      message: 'Moderado executable not found: "moderado".',
      attemptedExecutable: 'moderado',
      canRetry: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a sidecarReady notice', () => {
    expect(HostToWebviewMessageSchema.safeParse({ type: 'sidecarReady' }).success).toBe(true);
  });

  it('rejects an unavailable notice with an unbounded message', () => {
    const parsed = HostToWebviewMessageSchema.safeParse({
      type: 'sidecarUnavailable',
      message: 'x'.repeat(5000),
    });
    expect(parsed.success).toBe(false);
  });
});
