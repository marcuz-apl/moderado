import { describe, expect, it } from 'vitest';
import { HostIntentSchema, HostResponseSchema } from '../src/index.js';

const base = { protocolVersion: 1, requestId: 'request-1' };

describe('webview host protocol', () => {
  it.each([
    { type: 'start_turn', sessionId: 'session-1', prompt: 'Explain this', mode: 'Plan' },
    { type: 'cancel_turn', sessionId: 'session-1' },
    { type: 'list_providers' },
    { type: 'select_provider', providerId: 'nvidia' },
    { type: 'list_models', providerId: 'nvidia' },
    { type: 'select_model', providerId: 'nvidia', modelId: 'free-model' },
    { type: 'resolve_approval', sessionId: 'session-1', approvalRequestId: 'approval-1', status: 'denied' },
    { type: 'update_settings', category: 'execute', enabled: true },
    { type: 'list_sessions' },
    { type: 'resume_session', sessionId: 'session-1' },
  ])('accepts $type intent', (intent) => {
    expect(HostIntentSchema.parse({ ...base, ...intent })).toMatchObject(intent);
  });

  it('rejects stale and malformed intent envelopes', () => {
    expect(HostIntentSchema.safeParse({ ...base, protocolVersion: 2, type: 'list_sessions' }).success).toBe(false);
    expect(HostIntentSchema.safeParse({ ...base, requestId: '', type: 'list_sessions' }).success).toBe(false);
    expect(HostIntentSchema.safeParse({ ...base, type: 'unknown' }).success).toBe(false);
    expect(HostIntentSchema.safeParse({ ...base, type: 'start_turn', prompt: 'Hi', mode: 'Plan' }).success).toBe(false);
    expect(HostIntentSchema.safeParse({ ...base, type: 'start_turn', sessionId: 's', prompt: ' ', mode: 'Plan' }).success).toBe(false);
    expect(HostIntentSchema.safeParse({ ...base, type: 'resolve_approval', sessionId: 's', approvalRequestId: 'a', status: 'aborted' }).success).toBe(false);
    expect(HostIntentSchema.safeParse({ ...base, type: 'update_settings', category: 'shell', enabled: true }).success).toBe(false);
    expect(HostIntentSchema.safeParse({ ...base, type: 'update_settings', category: 'edit', enabled: 'yes' }).success).toBe(false);
  });

  it('rejects unexpected fields at the trust boundary', () => {
    expect(HostIntentSchema.safeParse({ ...base, type: 'list_sessions', command: 'echo hi' }).success).toBe(false);
  });

  it('accepts typed results and correlated errors', () => {
    expect(HostResponseSchema.parse({ ...base, ok: true, result: { type: 'providers', providers: [{ id: 'nvidia', name: 'NVIDIA NIM' }] } }).ok).toBe(true);
    expect(HostResponseSchema.parse({ ...base, ok: true, result: { type: 'turn_started', sessionId: 'session-1' } }).ok).toBe(true);
    expect(HostResponseSchema.parse({ ...base, ok: false, error: { code: 'NO_PROVIDER', message: 'Choose a provider.' } }).ok).toBe(false);
  });

  it('rejects malformed host results', () => {
    expect(HostResponseSchema.safeParse({ ...base, ok: true, result: { type: 'models', models: [{ id: 'unknown' }] } }).success).toBe(false);
    expect(HostResponseSchema.safeParse({ ...base, ok: false, error: { code: '', message: '' } }).success).toBe(false);
    expect(HostResponseSchema.safeParse({ ...base, protocolVersion: 2, ok: true, result: { type: 'sessions', sessions: [] } }).success).toBe(false);
  });
});
