import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createVscodeStub, loadExtensionBundle } from './host_stub.js';

const bundlePath = path.resolve(import.meta.dirname, '../dist/extension.cjs');
const manifestPath = path.resolve(import.meta.dirname, '../package.json');

async function activate() {
  // About reads the packaged manifest off disk, so the stub points at the real one.
  const stub = createVscodeStub({ manifestPath });
  const extension = await loadExtensionBundle(bundlePath, stub);
  extension.activate(stub.extensionContext);
  stub.registered.views[0].provider.resolveWebviewView(stub.view);
  // The message handler is async; awaiting it lets the host finish posting.
  const send = async (message: unknown) => { await stub.webview.handler?.(message); await new Promise((resolve) => setImmediate(resolve)); };
  return { stub, extension, send };
}

describe('extension host', () => {
  it('activates, registering the sidebar view and both commands', async () => {
    expect(fs.existsSync(bundlePath)).toBe(true);
    const stub = createVscodeStub({ manifestPath });
    const { activate } = await loadExtensionBundle(bundlePath, stub);
    activate(stub.extensionContext);
    expect(stub.registered.views.map((view) => view.id)).toEqual(['moderado.chat']);
    expect(stub.registered.commands).toEqual(['moderado.newSession', 'moderado.openSettings']);
  });

  it('serves the webview a locked-down document when the view resolves', async () => {
    const { stub } = await activate();
    expect(stub.webview.html).toContain("default-src 'none'");
    expect(stub.webview.html).toMatch(/<script nonce="[0-9a-f]{32}"/);
    expect(stub.webview.options?.enableScripts).toBe(true);
  });

  it('hands the webview a session it minted, on ready', async () => {
    const { stub, send } = await activate();
    await send({ type: 'ready' });
    const state = stub.posted.at(-1)?.state;
    expect(typeof state?.sessionId).toBe('string');
    expect(state.sessionId.length).toBeGreaterThan(0);
    // The settings pages need these to render on first paint.
    expect(Array.isArray(state.providers)).toBe(true);
    expect(typeof state.about.version).toBe('string');
  });

  it('never posts a stored secret back to the webview', async () => {
    const { stub, send } = await activate();
    await send({ protocolVersion: 1, requestId: 'r1', type: 'set_credential', providerId: 'nvidia-nim', apiKey: 'sk-super-secret' });
    expect(stub.secrets.get('moderado.apiKey.nvidia-nim')).toBe('sk-super-secret');
    expect(JSON.stringify(stub.posted)).not.toContain('sk-super-secret');
  });

  it('denies a stale approval decision', async () => {
    const { stub, send } = await activate();
    await send({ protocolVersion: 1, requestId: 'r2', type: 'resolve_approval', sessionId: 'nope', approvalRequestId: 'a1', status: 'approved' });
    expect(stub.posted.at(-1)).toMatchObject({ ok: false });
  });

  it('stops answering once the view is disposed', async () => {
    const { stub, send } = await activate();
    await send({ type: 'ready' });
    const before = stub.posted.length;
    // Disposal must stop the host answering, so no turn can run afterwards.
    stub.view.disposeHandler?.();
    await send({ protocolVersion: 1, requestId: 'r3', type: 'start_turn', sessionId: 'x', prompt: 'go', mode: 'Execute' });
    expect(stub.posted.length).toBe(before);
  });
});