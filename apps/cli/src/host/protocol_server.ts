import {
  HostRequestSchema,
  type HostNotification,
  type HostRequest,
  type InitializeRequest,
  type InitializeResult,
} from '@moderado/contracts';
import { readHostMessages, writeHostMessage } from './ndjson.js';

export interface HostSessionRuntime {
  initialize(request: InitializeRequest): Promise<InitializeResult>;
  dispatch(request: HostRequest): Promise<unknown>;
  close(): Promise<void>;
}

export type HostSessionFactory = (
  emit: (notification: HostNotification) => Promise<void>,
) => HostSessionRuntime | Promise<HostSessionRuntime>;

export async function serveHostProtocol(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  sessionFactory: HostSessionFactory,
  signal?: AbortSignal,
): Promise<void> {
  const emit = async (notification: HostNotification) => {
    await writeHostMessage(output, notification);
  };

  const runtime = await sessionFactory(emit);
  const inFlightRequestIds = new Set<string>();

  const sendResponse = async (
    id: string,
    ok: boolean,
    resultOrError: { result?: unknown; error?: { code: string; message: string } },
  ) => {
    if (ok) {
      await writeHostMessage(output, {
        type: 'response',
        id,
        ok: true,
        result: resultOrError.result,
      });
    } else {
      await writeHostMessage(output, {
        type: 'response',
        id,
        ok: false,
        error: resultOrError.error,
      });
    }
  };

  try {
    for await (const raw of readHostMessages(input)) {
      if (signal?.aborted) {
        break;
      }

      const hasStringId = typeof (raw as any)?.id === 'string' && (raw as any).id.length > 0;
      const rawId = hasStringId ? (raw as any).id : undefined;

      // Check for unsupported protocol version in initialize
      if ((raw as any)?.method === 'initialize') {
        const proto = (raw as any)?.params?.protocolVersion;
        if (proto !== 1) {
          if (rawId) {
            await sendResponse(rawId, false, {
              error: {
                code: 'UNSUPPORTED_VERSION',
                message: `Unsupported protocol version ${proto}. Expected 1.`,
              },
            });
          }
          break;
        }
      }

      const parseResult = HostRequestSchema.safeParse(raw);
      if (!parseResult.success) {
        if (rawId) {
          await sendResponse(rawId, false, {
            error: {
              code: 'INVALID_REQUEST',
              message: parseResult.error.message,
            },
          });
        }
        continue;
      }

      const request = parseResult.data;

      if (inFlightRequestIds.has(request.id)) {
        await sendResponse(request.id, false, {
          error: {
            code: 'BUSY',
            message: `Request ID ${request.id} is already in flight`,
          },
        });
        continue;
      }

      inFlightRequestIds.add(request.id);

      (async () => {
        try {
          let result: unknown;
          if (request.method === 'initialize') {
            result = await runtime.initialize(request);
          } else {
            result = await runtime.dispatch(request);
          }
          await sendResponse(request.id, true, { result });
        } catch (err: any) {
          await sendResponse(request.id, false, {
            error: {
              code: err.code || 'INTERNAL_ERROR',
              message: err.message || 'Internal host error',
            },
          });
        } finally {
          inFlightRequestIds.delete(request.id);
        }
      })();
    }
  } finally {
    await runtime.close();
  }
}
