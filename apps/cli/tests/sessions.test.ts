import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SessionStore,
  calculateSessionCost,
  compactSessionMessages,
  createSession,
  exportSessionMarkdown,
} from '../src/sessions.js';

describe('SessionStore', () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
  });

  function tempHome(): string {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-session-test-'));
    homes.push(home);
    return home;
  }

  it('saves and reloads a credential-free session', () => {
    const home = tempHome();
    const store = new SessionStore(home);
    const session = createSession('C:/repo', {
      providerId: 'openrouter',
      providerName: 'OpenRouter',
      modelId: 'z-ai/glm-5.2:free',
    });
    session.messages.push({ role: 'user', content: 'Hello' });
    store.save(session);

    expect(store.loadLatestSession('C:/repo')).toMatchObject({
      id: session.id,
      providerId: 'openrouter',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(fs.readFileSync(store.getSessionPath(session), 'utf8')).not.toContain('apiKey');
  });

  it('calculates cost only when provider usage and both prices exist', () => {
    expect(calculateSessionCost(
      { promptTokens: 1000, completionTokens: 2000, totalTokens: 3000 },
      { prompt: '0.000001', completion: '0.000002' }
    )).toEqual({ costKnown: true, costUsd: 0.005 });
    expect(calculateSessionCost(undefined, { prompt: '0', completion: '0' }))
      .toEqual({ costKnown: false });
  });

  it('exports redacted Markdown and compacts older messages deterministically', () => {
    const session = createSession('C:/repo');
    session.messages = [
      { role: 'user', content: 'first request nvapi-secret' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'second request' },
      { role: 'assistant', content: 'second answer' },
      { role: 'user', content: 'latest request' },
      { role: 'assistant', content: 'latest answer' },
    ];
    expect(exportSessionMarkdown(session)).not.toContain('nvapi-secret');
    const compacted = compactSessionMessages(session.messages);
    expect(compacted[0]).toMatchObject({ role: 'system' });
    expect(compacted.length).toBeLessThan(session.messages.length);
  });
});
