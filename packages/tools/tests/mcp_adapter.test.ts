import { describe, expect, it } from 'vitest';
import { createMcpTool } from '../src/mcp_adapter.js';
describe('MCP adapter', () => {
  it('namespaces discovered tools and always requires approval', () => {
    const tool = createMcpTool('local', { executable: 'server', args: [] }, 'search');
    expect(tool.name).toBe('mcp.local.search');
    expect(tool.requiresApproval).toBe(true);
  });
  it('rejects unsafe server or tool names', () => {
    expect(() => createMcpTool('../bad', { executable: 'server', args: [] }, 'search')).toThrow();
  });
});