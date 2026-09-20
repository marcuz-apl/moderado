import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMcpTool, createMcpTools, discoverMcpServers } from '../src/mcp_adapter.js';
describe('MCP adapter', () => {
  let tempDir: string;
  let fakeServerConfig: { executable: string; args: string[]; enabled: boolean };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-mcp-test-'));
    const serverPath = path.join(tempDir, 'fake-server.mjs');
    fs.writeFileSync(serverPath, `
      let buffer = '';
      process.stdin.on('data', (chunk) => {
        buffer += chunk.toString();
        while (true) {
          const at = buffer.indexOf('\\r\\n\\r\\n');
          if (at < 0) return;
          const match = buffer.slice(0, at).match(/Content-Length:\\s*(\\d+)/i);
          if (!match) return;
          const end = at + 4 + Number(match[1]);
          if (buffer.length < end) return;
          const request = JSON.parse(buffer.slice(at + 4, end));
          buffer = buffer.slice(end);
          const result = request.method === 'tools/list' ? { tools: [{ name: 'search' }] } : { capabilities: {} };
          const body = JSON.stringify({ jsonrpc: '2.0', id: request.id, result });
          process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n\\r\\n' + body);
        }
      });
    `);
    fakeServerConfig = { executable: process.execPath, args: [serverPath], enabled: true };
  });

  afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  it('namespaces discovered tools and always requires approval', () => {
    const tool = createMcpTool('local', { executable: 'server', args: [] }, 'search');
    expect(tool.name).toBe('mcp.local.search');
    expect(tool.requiresApproval).toBe(true);
  });
  it('rejects unsafe server or tool names', () => {
    expect(() => createMcpTool('../bad', { executable: 'server', args: [] }, 'search')).toThrow();
  });

  it('skips disabled servers and keeps tools from a healthy peer', async () => {
    const tools = await createMcpTools({
      disabled: { executable: 'unused-disabled-server', args: [], enabled: false },
      healthy: fakeServerConfig,
    });

    expect(tools.map((tool) => tool.name)).toContain('mcp.healthy.search');
    expect(tools.map((tool) => tool.name)).not.toContain('mcp.disabled.search');
  });

  it('reports a failing server without rejecting healthy discovery', async () => {
    const result = await discoverMcpServers({
      bad: { executable: 'missing-mcp-server', args: [], enabled: true },
      healthy: fakeServerConfig,
    });

    expect(result.find((entry) => entry.name === 'bad')?.error).toContain('Unable to start');
    expect(result.find((entry) => entry.name === 'healthy')?.tools).toHaveLength(1);
  });
});
