import { IToolDefinition, ToolExecutionContext, ToolResult, WebSearchParams, WebSearchParamsSchema } from '@moderado/contracts';

type SearchItem = { title?: unknown; url?: unknown; snippet?: unknown };

export const WebSearchTool: IToolDefinition<WebSearchParams> = {
  name: 'web_search',
  description: 'Search a configured web endpoint and return bounded results with source URLs. Requires approval.',
  requiresApproval: true,
  parametersSchema: WebSearchParamsSchema,
  async execute(params: WebSearchParams, context: ToolExecutionContext): Promise<ToolResult> {
    const url = new URL(params.endpoint);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return { toolName: 'web_search', status: 'error', output: 'Search endpoint must use HTTPS or localhost.' };
    url.searchParams.set('q', params.query);
    url.searchParams.set('limit', String(params.maxResults));
    try {
      const response = await fetch(url, { signal: context.abortSignal });
      if (!response.ok) return { toolName: 'web_search', status: 'error', output: `Search endpoint returned HTTP ${response.status}.` };
      const payload = await response.json() as { results?: SearchItem[] };
      const valid = Array.isArray(payload.results) ? payload.results.slice(0, params.maxResults).filter((item) => typeof item.title === 'string' && typeof item.url === 'string') : [];
      const results = valid.map((item) => `${item.title}\n${item.url}${typeof item.snippet === 'string' ? `\n${item.snippet}` : ''}`);
      return { toolName: 'web_search', status: 'success', output: results.length ? results.join('\n\n') : 'No search results.', metadata: { sources: valid.map((item) => ({ title: item.title, url: item.url })) } };
    } catch (error) { return { toolName: 'web_search', status: 'error', output: `Web search failed: ${error instanceof Error ? error.message : String(error)}` }; }
  },
};
