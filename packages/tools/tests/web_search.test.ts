import { createServer } from 'node:http';
import { beforeEach, expect, it } from 'vitest';
import {
  boundSearchOutput,
  createWebSearchTool,
  EXA_SEARCH_URL,
  extractSearchSources,
  PARALLEL_SEARCH_URL,
  parseMcpSearchText,
  resolveWebSearchTargets,
  WebSearchTool,
} from '../src/tools/web_search.js';
import { WebSearchParamsSchema } from '@moderado/contracts';

beforeEach(() => {
  delete process.env.MODERADO_WEB_SEARCH_ENDPOINT;
  delete process.env.MODERADO_WEB_SEARCH_PROVIDER;
  delete process.env.EXA_API_KEY;
});

const mcpSse = (text: string): string =>
  `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } })}\n\n`;

const jsonBody = (body: string): Response =>
  new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });

it('runs bounded searches without an approval prompt', async () => {
  expect(WebSearchTool.requiresApproval).toBe(false);
  expect(WebSearchTool.description).toContain('never list source URLs');

  const server = createServer((_request, response) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ results: [{ title: 'One', url: 'https://example.com/one', snippet: 'A' }, { title: 'Two', url: 'https://example.com/two' }] })); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const result = await WebSearchTool.execute({ query: 'weather', endpoint: `http://127.0.0.1:${address.port}`, maxResults: 1 }, { workspaceRoot: process.cwd() });
  server.close();
  expect(result.status).toBe('success');
  expect(result.metadata?.provider).toBe('custom');
  expect(result.output).toContain('https://example.com/one');
  expect(result.output).not.toContain('https://example.com/two');
  expect(result.metadata?.sources).toEqual([{ title: 'One', url: 'https://example.com/one' }]);
});

it('answers a junk endpoint override with a readable error instead of an argument validation failure', async () => {
  expect(WebSearchParamsSchema.safeParse({ query: 'weather in Calgary', endpoint: 'web' }).success).toBe(true);
  const result = await WebSearchTool.execute({ query: 'weather in Calgary', endpoint: 'web', maxResults: 1 }, { workspaceRoot: process.cwd() });
  expect(result.status).toBe('error');
  expect(result.output).toContain('HTTPS or localhost');
});

it('rejects non-HTTPS remote search endpoints', async () => {
  const result = await WebSearchTool.execute({ query: 'x', endpoint: 'http://example.com', maxResults: 1 }, { workspaceRoot: process.cwd() });
  expect(result.status).toBe('error');
  expect(result.output).toContain('HTTPS or localhost');
});

it('searches the hosted Exa site by default without any API key', async () => {
  const calls: string[] = [];
  const tool = createWebSearchTool({ fetchImpl: async (input) => { calls.push(String(input)); return jsonBody(mcpSse('Title: Weather\nURL: https://example.test/weather\nOvercast, 57F.')); } });
  const result = await tool.execute({ query: 'weather in Lisbon', objective: 'today high and low', maxResults: 3 }, { workspaceRoot: process.cwd() });

  expect(calls).toEqual([EXA_SEARCH_URL]);
  expect(result.status).toBe('success');
  expect(result.metadata?.provider).toBe('exa');
  expect(result.output).toContain('Overcast, 57F.');
  expect(result.metadata?.sources).toEqual([{ title: 'Weather', url: 'https://example.test/weather' }]);
});

it('falls back to the next search site when the first one fails', async () => {
  const calls: string[] = [];
  const tool = createWebSearchTool({
    fetchImpl: async (input) => {
      calls.push(String(input));
      return String(input).startsWith(EXA_SEARCH_URL)
        ? new Response('unavailable', { status: 503 })
        : jsonBody(JSON.stringify({ result: { content: [{ type: 'text', text: 'Parallel weather context' }] } }));
    },
  });
  const result = await tool.execute({ query: 'weather in Lisbon', maxResults: 2 }, { workspaceRoot: process.cwd() });

  expect(calls).toEqual([EXA_SEARCH_URL, PARALLEL_SEARCH_URL]);
  expect(result.status).toBe('success');
  expect(result.metadata?.provider).toBe('parallel');
  expect(result.output).toBe('Parallel weather context');
});

it('bounds every search attempt with a timeout', async () => {
  const tool = createWebSearchTool({
    timeoutMs: 20,
    fetchImpl: (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  });
  const result = await tool.execute({ query: 'weather', maxResults: 1 }, { workspaceRoot: process.cwd() });

  expect(result.status).toBe('error');
  expect(result.output).toContain('timed out after 20ms');
});

it('orders search sites deterministically and honours a pinned provider', () => {
  expect(resolveWebSearchTargets({}, {}).map((target) => target.provider)).toEqual(['exa', 'parallel']);
  expect(resolveWebSearchTargets({}, { EXA_API_KEY: 'exa-key' })[0].url).toBe(`${EXA_SEARCH_URL}?exaApiKey=exa-key`);
  expect(resolveWebSearchTargets({ provider: 'parallel' }, {}).map((target) => target.provider)).toEqual(['parallel', 'exa']);
  expect(resolveWebSearchTargets({}, { MODERADO_WEB_SEARCH_PROVIDER: 'parallel' }).map((target) => target.provider)).toEqual(['parallel', 'exa']);
  expect(resolveWebSearchTargets({ endpoint: 'https://search.example.test/api' }, {}).map((target) => target.provider)).toEqual(['custom', 'exa', 'parallel']);
  expect(resolveWebSearchTargets({ endpoint: 'http://example.com' }, {}).map((target) => target.provider)).toEqual(['exa', 'parallel']);
});

it('reads both direct JSON and server-sent-event search payloads', () => {
  const text = 'answer context';
  expect(parseMcpSearchText(JSON.stringify({ result: { content: [{ type: 'text', text }] } }))).toBe(text);
  expect(parseMcpSearchText(mcpSse(text))).toBe(text);
  expect(parseMcpSearchText(JSON.stringify({ result: { isError: true, content: [{ type: 'text', text: 'denied' }] } }))).toBeUndefined();
  expect(parseMcpSearchText('<html>nope</html>')).toBeUndefined();
});

it('keeps citations and bounds the injected search context', () => {
  expect(extractSearchSources('Title: A\nURL: https://a.test/x\n\nTitle: B\nURL: https://b.test/y')).toEqual([
    { title: 'A', url: 'https://a.test/x' },
    { title: 'B', url: 'https://b.test/y' },
  ]);
  expect(extractSearchSources('no title block https://c.test/z here')).toEqual([{ title: 'https://c.test/z', url: 'https://c.test/z' }]);

  const bounded = boundSearchOutput('x'.repeat(20), 10);
  expect(bounded.truncated).toBe(true);
  expect(bounded.output.startsWith('x'.repeat(10))).toBe(true);
  expect(bounded.output).toContain('truncated');
  expect(boundSearchOutput('short', 10)).toEqual({ output: 'short', truncated: false });
});
