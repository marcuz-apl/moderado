import { describe, it, expect } from 'vitest';
import {
  WebviewToHostMessageSchema,
  HostToWebviewMessageSchema,
} from '../src/webview/messages.js';

describe('composer controls messaging', () => {
  it('accepts an attach-file request', () => {
    expect(WebviewToHostMessageSchema.safeParse({ type: 'attachFile' }).success).toBe(true);
  });

  it('accepts a model status update', () => {
    const parsed = HostToWebviewMessageSchema.safeParse({
      type: 'modelStatus',
      providerId: 'nvidia-nim',
      providerLabel: 'NVIDIA NIM',
      modelId: 'z-ai/glm-5.3-flash',
      needsApiKey: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a model status with no provider or model yet', () => {
    expect(HostToWebviewMessageSchema.safeParse({ type: 'modelStatus' }).success).toBe(true);
  });

  it('rejects a model status carrying a key-shaped field', () => {
    // The schema has no apiKey member, so any attempt is stripped on parse.
    const parsed: any = HostToWebviewMessageSchema.safeParse({
      type: 'modelStatus',
      providerId: 'openrouter',
      apiKey: 'sk-leaked',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data.apiKey).toBeUndefined();
  });

  it('accepts composer text to append', () => {
    const parsed = HostToWebviewMessageSchema.safeParse({
      type: 'appendComposerText',
      text: '@src/index.ts ',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an oversized appendComposerText payload', () => {
    const parsed = HostToWebviewMessageSchema.safeParse({
      type: 'appendComposerText',
      text: 'x'.repeat(10_000),
    });
    expect(parsed.success).toBe(false);
  });
});
