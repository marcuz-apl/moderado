import { PassThrough, Readable, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { readHostMessages, writeHostMessage } from '../src/host/ndjson.js';
import { serveHostProtocol } from '../src/host/protocol_server.js';
import type { HostNotification, HostRequest } from '@moderado/contracts';

describe('Host NDJSON Transport', () => {
  describe('readHostMessages', () => {
    it('handles split chunks across writes', async () => {
      const stream = new PassThrough();
      const messagesPromise = (async () => {
        const results: unknown[] = [];
        for await (const msg of readHostMessages(stream)) {
          results.push(msg);
        }
        return results;
      })();

      stream.write(Buffer.from('{"type":"req'));
      stream.write(Buffer.from('uest","id":"1"}\n'));
      stream.end();

      const results = await messagesPromise;
      expect(results).toEqual([{ type: 'request', id: '1' }]);
    });

    it('handles multiple lines in a single chunk', async () => {
      const stream = new PassThrough();
      const messagesPromise = (async () => {
        const results: unknown[] = [];
        for await (const msg of readHostMessages(stream)) {
          results.push(msg);
        }
        return results;
      })();

      stream.write(Buffer.from('{"id":"1"}\n{"id":"2"}\n{"id":"3"}\n'));
      stream.end();

      const results = await messagesPromise;
      expect(results).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }]);
    });

    it('handles CRLF line terminators', async () => {
      const stream = new PassThrough();
      const messagesPromise = (async () => {
        const results: unknown[] = [];
        for await (const msg of readHostMessages(stream)) {
          results.push(msg);
        }
        return results;
      })();

      stream.write(Buffer.from('{"id":"1"}\r\n{"id":"2"}\r\n'));
      stream.end();

      const results = await messagesPromise;
      expect(results).toEqual([{ id: '1' }, { id: '2' }]);
    });

    it('preserves multi-byte UTF-8 text', async () => {
      const stream = new PassThrough();
      const messagesPromise = (async () => {
        const results: unknown[] = [];
        for await (const msg of readHostMessages(stream)) {
          results.push(msg);
        }
        return results;
      })();

      const text = 'Hello 🌍 café 🚀';
      stream.write(Buffer.from(JSON.stringify({ text }) + '\n', 'utf8'));
      stream.end();

      const results = await messagesPromise;
      expect(results).toEqual([{ text }]);
    });

    it('throws on malformed JSON', async () => {
      const stream = new PassThrough();
      const iterator = readHostMessages(stream)[Symbol.asyncIterator]();

      stream.write(Buffer.from('{bad json\n'));
      stream.end();

      await expect(iterator.next()).rejects.toThrow();
    });

    it('throws on EOF with an incomplete line', async () => {
      const stream = new PassThrough();
      const iterator = readHostMessages(stream)[Symbol.asyncIterator]();

      stream.write(Buffer.from('{"id":"incomplete"}'));
      stream.end();

      await expect(iterator.next()).rejects.toThrow(/incomplete|EOF/i);
    });

    it('accepts a line of exactly 1 MiB', async () => {
      const maxLineBytes = 1_048_576; // 1 MiB
      const stream = new PassThrough();
      const messagesPromise = (async () => {
        const results: unknown[] = [];
        for await (const msg of readHostMessages(stream, maxLineBytes)) {
          results.push(msg);
        }
        return results;
      })();

      // Construct a payload whose UTF-8 byte count including '\n' is exactly maxLineBytes
      // Prefix: '{"id":"x","data":"' (20 bytes)
      // Suffix: '"}\n' (3 bytes)
      // data length needed: 1_048_576 - 23 = 1_048_553
      const prefix = '{"id":"x","data":"';
      const suffix = '"}\n';
      const dataLen = maxLineBytes - Buffer.byteLength(prefix, 'utf8') - Buffer.byteLength(suffix, 'utf8');
      const payload = prefix + 'a'.repeat(dataLen) + suffix;
      expect(Buffer.byteLength(payload, 'utf8')).toBe(maxLineBytes);

      stream.write(Buffer.from(payload, 'utf8'));
      stream.end();

      const results = await messagesPromise;
      expect(results.length).toBe(1);
      expect((results[0] as { id: string }).id).toBe('x');
    });

    it('rejects a line exceeding 1 MiB before newline arrives', async () => {
      const maxLineBytes = 1000;
      const stream = new PassThrough();
      const iterator = readHostMessages(stream, maxLineBytes)[Symbol.asyncIterator]();

      // Write 1001 bytes without a newline
      stream.write(Buffer.alloc(1001, 'a'));

      await expect(iterator.next()).rejects.toThrow(/exceeds/i);
    });
  });

  describe('writeHostMessage', () => {
    it('writes a JSON line and handles backpressure', async () => {
      let drained = false;
      const customWritable = new Writable({
        highWaterMark: 16,
        write(_chunk, _encoding, callback) {
          setTimeout(() => {
            drained = true;
            callback();
          }, 10);
        },
      });

      const message = { type: 'response', id: '1', ok: true, result: { large: 'x'.repeat(100) } };
      await writeHostMessage(customWritable, message as any);

      expect(drained).toBe(true);
    });
  });

  describe('serveHostProtocol', () => {
    it('routes requests to runtime and ensures zero stray stdout output', async () => {
      const input = new PassThrough();
      const output = new PassThrough();

      const stdoutChunks: string[] = [];
      output.on('data', (chunk) => {
        stdoutChunks.push(chunk.toString('utf8'));
      });

      const fakeRuntime = {
        initialize: vi.fn().mockResolvedValue({
          protocolVersion: 1,
          sessionId: 'sess-1',
          workspaceName: 'test',
          resumableSessions: [],
        }),
        dispatch: vi.fn().mockResolvedValue({ accepted: true }),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const sessionFactory = vi.fn().mockReturnValue(fakeRuntime);

      const serverPromise = serveHostProtocol(input, output, sessionFactory);

      const req: HostRequest = {
        type: 'request',
        id: 'req-init',
        method: 'initialize',
        params: { protocolVersion: 1 },
      };

      input.write(Buffer.from(JSON.stringify(req) + '\n', 'utf8'));
      input.end();

      await serverPromise;

      expect(fakeRuntime.initialize).toHaveBeenCalledTimes(1);
      expect(fakeRuntime.close).toHaveBeenCalledTimes(1);

      // Verify each chunk on output is valid NDJSON and matches HostResponse schema
      const fullOutput = stdoutChunks.join('');
      const lines = fullOutput.trim().split('\n');
      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed).toEqual({
        type: 'response',
        id: 'req-init',
        ok: true,
        result: {
          protocolVersion: 1,
          sessionId: 'sess-1',
          workspaceName: 'test',
          resumableSessions: [],
        },
      });
    });

    it('emits notifications directly as single NDJSON lines on output', async () => {
      const input = new PassThrough();
      const output = new PassThrough();

      const lines: string[] = [];
      output.on('data', (chunk) => {
        lines.push(...chunk.toString('utf8').trim().split('\n'));
      });

      let emitter: ((notification: HostNotification) => Promise<void>) | undefined;
      const fakeRuntime = {
        initialize: vi.fn(),
        dispatch: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const sessionFactory = (emit: (notification: HostNotification) => Promise<void>) => {
        emitter = emit;
        return fakeRuntime;
      };

      const serverPromise = serveHostProtocol(input, output, sessionFactory);

      // Emit a notification
      await emitter!({
        type: 'event',
        envelope: {
          protocolVersion: 1,
          sessionId: 's-1',
          sequence: 1,
          timestamp: 1000,
          event: {
            type: 'assistant_delta',
            delta: 'hello',
            timestamp: 1000,
          },
        },
      });

      input.end();
      await serverPromise;

      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.type).toBe('event');
      expect(parsed.envelope.event.delta).toBe('hello');
    });

    it('rejects invalid schema requests with INVALID_REQUEST and keeps session open', async () => {
      const input = new PassThrough();
      const output = new PassThrough();

      const lines: string[] = [];
      output.on('data', (chunk) => {
        lines.push(...chunk.toString('utf8').trim().split('\n'));
      });

      const fakeRuntime = {
        initialize: vi.fn(),
        dispatch: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const sessionFactory = vi.fn().mockReturnValue(fakeRuntime);
      const serverPromise = serveHostProtocol(input, output, sessionFactory);

      // Send request with readable ID but invalid params (missing sessionId)
      input.write(Buffer.from(JSON.stringify({
        type: 'request',
        id: 'req-bad-1',
        method: 'chat.send',
        params: { text: 'no session id' },
      }) + '\n', 'utf8'));

      input.end();
      await serverPromise;

      expect(lines.length).toBe(1);
      const res = JSON.parse(lines[0]);
      expect(res.ok).toBe(false);
      expect(res.id).toBe('req-bad-1');
      expect(res.error.code).toBe('INVALID_REQUEST');
    });

    it('rejects unsupported protocol version with UNSUPPORTED_VERSION and closes session', async () => {
      const input = new PassThrough();
      const output = new PassThrough();

      const lines: string[] = [];
      output.on('data', (chunk) => {
        lines.push(...chunk.toString('utf8').trim().split('\n'));
      });

      const fakeRuntime = {
        initialize: vi.fn(),
        dispatch: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const sessionFactory = vi.fn().mockReturnValue(fakeRuntime);
      const serverPromise = serveHostProtocol(input, output, sessionFactory);

      // Send initialize with protocolVersion 99
      input.write(Buffer.from(JSON.stringify({
        type: 'request',
        id: 'req-proto-bad',
        method: 'initialize',
        params: { protocolVersion: 99 },
      }) + '\n', 'utf8'));

      await serverPromise;

      expect(lines.length).toBe(1);
      const res = JSON.parse(lines[0]);
      expect(res.ok).toBe(false);
      expect(res.id).toBe('req-proto-bad');
      expect(res.error.code).toBe('UNSUPPORTED_VERSION');
      expect(fakeRuntime.close).toHaveBeenCalledTimes(1);
    });

    it('rejects duplicate in-flight request IDs with BUSY', async () => {
      const input = new PassThrough();
      const output = new PassThrough();

      const lines: string[] = [];
      output.on('data', (chunk) => {
        lines.push(...chunk.toString('utf8').trim().split('\n'));
      });

      let resolveFirst: (() => void) | undefined;
      const fakeRuntime = {
        initialize: vi.fn(),
        dispatch: vi.fn().mockImplementation(() => new Promise((resolve) => {
          resolveFirst = () => resolve({ accepted: true });
        })),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const sessionFactory = vi.fn().mockReturnValue(fakeRuntime);
      const serverPromise = serveHostProtocol(input, output, sessionFactory);

      const req: HostRequest = {
        type: 'request',
        id: 'req-dup',
        method: 'chat.send',
        params: { sessionId: 's1', text: 'turn 1' },
      };

      // Send first request
      input.write(Buffer.from(JSON.stringify(req) + '\n', 'utf8'));
      // Send identical ID while first is pending
      input.write(Buffer.from(JSON.stringify(req) + '\n', 'utf8'));

      // Wait a tick for second to be processed
      await new Promise((r) => setTimeout(r, 10));

      // Resolve first
      resolveFirst?.();
      input.end();
      await serverPromise;

      expect(lines.length).toBe(2);
      const responses = lines.map((l) => JSON.parse(l));
      const busyRes = responses.find((r) => r.ok === false);
      expect(busyRes).toBeDefined();
      expect(busyRes.error.code).toBe('BUSY');
    });
  });

  describe('handleHostCommand', () => {
    it('rejects missing or empty workspace and returns exit code 1', async () => {
      const stderrChunks: string[] = [];
      const origStderr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        stderrChunks.push(String(chunk));
        return true;
      }) as any;

      try {
        const { handleHostCommand } = await import('../src/commands/host.js');
        const code = await handleHostCommand({
          command: 'host',
          workspace: '',
          protocol: 1,
          profile: 'hosted-nvidia',
          maxSteps: 25,
          timeout: 600,
          readOnly: false,
          autoApprove: false,
          nonInteractive: false,
          allowPaid: false,
          allowUnknown: false,
          verbose: false,
          json: false,
          refresh: false,
          connectivity: false,
          migrateCredentials: false,
          help: false,
          version: false,
        });

        expect(code).toBe(1);
        expect(stderrChunks.join('')).toContain('--workspace is required');
      } finally {
        process.stderr.write = origStderr;
      }
    });

    it('rejects unsupported protocol version and returns exit code 1', async () => {
      const stderrChunks: string[] = [];
      const origStderr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        stderrChunks.push(String(chunk));
        return true;
      }) as any;

      try {
        const { handleHostCommand } = await import('../src/commands/host.js');
        const code = await handleHostCommand({
          command: 'host',
          workspace: './my-workspace',
          protocol: 2,
          profile: 'hosted-nvidia',
          maxSteps: 25,
          timeout: 600,
          readOnly: false,
          autoApprove: false,
          nonInteractive: false,
          allowPaid: false,
          allowUnknown: false,
          verbose: false,
          json: false,
          refresh: false,
          connectivity: false,
          migrateCredentials: false,
          help: false,
          version: false,
        });

        expect(code).toBe(1);
        expect(stderrChunks.join('')).toContain('Unsupported protocol version');
      } finally {
        process.stderr.write = origStderr;
      }
    });
  });
});
