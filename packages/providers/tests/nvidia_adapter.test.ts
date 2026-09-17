import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { NvidiaAdapter } from '../src/nvidia/nvidia_adapter.js';
import { AuthenticationError, ModelUnavailableError, RateLimitError } from '@moderado/contracts';

describe('NvidiaAdapter (Offline Local Server)', () => {
  let server: http.Server;
  let serverUrl: string;
  let nextHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (nextHandler) {
        nextHandler(req, res);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${addr.port}/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('discovers live models from GET /v1/models', async () => {
    nextHandler = (req, res) => {
      expect(req.method).toBe('GET');
      expect(req.url).toBe('/v1/models');
      expect(req.headers.authorization).toBe('Bearer test-key');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          data: [
            { id: 'meta/llama-3.3-70b-instruct', object: 'model', created: 1700000000, owned_by: 'nvidia' },
            { id: 'mistralai/mixtral-8x7b-instruct-v0.1', object: 'model', created: 1700000000, owned_by: 'nvidia' },
          ],
        })
      );
    };

    const adapter = new NvidiaAdapter({ apiKey: 'test-key', baseUrl: serverUrl });
    const models = await adapter.discoverModels();

    expect(models.length).toBe(2);
    expect(models[0].id).toBe('meta/llama-3.3-70b-instruct');
    expect(models[1].id).toBe('mistralai/mixtral-8x7b-instruct-v0.1');
  });

  it('maps 401 error to AuthenticationError on discovery', async () => {
    nextHandler = (_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Invalid API key' }));
    };

    const adapter = new NvidiaAdapter({ apiKey: 'invalid-key', baseUrl: serverUrl });
    await expect(adapter.discoverModels()).rejects.toThrow(AuthenticationError);
  });

  it('maps 503 error to ModelUnavailableError on discovery', async () => {
    nextHandler = (_req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Service temporarily overloaded' }));
    };

    const adapter = new NvidiaAdapter({ apiKey: 'test-key', baseUrl: serverUrl });
    await expect(adapter.discoverModels()).rejects.toThrow(ModelUnavailableError);
  });

  it('streams chat completion text chunks via SSE', async () => {
    nextHandler = (req, res) => {
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/v1/chat/completions');

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      res.write('data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n');
      res.write('data: {"choices": [{"delta": {"content": " world!"}, "finish_reason": "stop"}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    };

    const adapter = new NvidiaAdapter({ apiKey: 'test-key', baseUrl: serverUrl });
    const chunks = [];
    for await (const chunk of adapter.streamChat({
      modelId: 'meta/llama-3.3-70b-instruct',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(2);
    expect(chunks[0].contentDelta).toBe('Hello');
    expect(chunks[1].contentDelta).toBe(' world!');
    expect(chunks[1].finishReason).toBe('stop');
  });

  it('streams tool call deltas via SSE', async () => {
    nextHandler = (_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      });

      res.write(
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    function: {
                      name: 'read_file',
                      arguments: '{"path": ',
                    },
                  },
                ],
              },
            },
          ],
        })}\n\n`
      );
      res.write(
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: '"index.ts"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        })}\n\n`
      );
      res.write('data: [DONE]\n\n');
      res.end();
    };

    const adapter = new NvidiaAdapter({ apiKey: 'test-key', baseUrl: serverUrl });
    const chunks = [];
    for await (const chunk of adapter.streamChat({
      modelId: 'meta/llama-3.3-70b-instruct',
      messages: [{ role: 'user', content: 'Read file' }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(2);
    expect(chunks[0].toolCallChunks?.[0].name).toBe('read_file');
    expect(chunks[0].toolCallChunks?.[0].argumentsDelta).toBe('{"path": ');
    expect(chunks[1].toolCallChunks?.[0].argumentsDelta).toBe('"index.ts"}');
    expect(chunks[1].finishReason).toBe('tool_calls');
  });

  it('parses Retry-After header on 429 into RateLimitError', async () => {
    nextHandler = (_req, res) => {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': '14',
      });
      res.end(JSON.stringify({ detail: 'Rate limit exceeded' }));
    };

    const adapter = new NvidiaAdapter({ apiKey: 'test-key', baseUrl: serverUrl });

    let caughtError: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of adapter.streamChat({
        modelId: 'meta/llama-3.3-70b-instruct',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        // noop
      }
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(RateLimitError);
    expect(caughtError.retryAfterSeconds).toBe(14);
  });
});
