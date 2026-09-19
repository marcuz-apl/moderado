import { createServer } from 'node:http';
import { WebSearchTool } from '../src/tools/web_search.js';
import { expect, it } from 'vitest';

it('returns bounded approved search results with source URLs', async () => {
  const server = createServer((_request, response) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ results: [{ title: 'One', url: 'https://example.com/one', snippet: 'A' }, { title: 'Two', url: 'https://example.com/two' }] })); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const result = await WebSearchTool.execute({ query: 'weather', endpoint: `http://127.0.0.1:${address.port}`, maxResults: 1 }, { workspaceRoot: process.cwd() });
  server.close();
  expect(result.status).toBe('success');
  expect(result.output).toContain('https://example.com/one');
  expect(result.output).not.toContain('https://example.com/two');
  expect(result.metadata?.sources).toEqual([{ title: 'One', url: 'https://example.com/one' }]);
});

it('rejects non-HTTPS remote search endpoints', async () => {
  const result = await WebSearchTool.execute({ query: 'x', endpoint: 'http://example.com' }, { workspaceRoot: process.cwd() });
  expect(result.status).toBe('error');
});
