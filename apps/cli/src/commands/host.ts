import type { CliParsedArgs } from '../args.js';
import { serveHostProtocol, type HostSessionFactory } from '../host/protocol_server.js';
import { createHostRuntime } from '../host/runtime.js';

export async function handleHostCommand(
  args: CliParsedArgs,
  signal?: AbortSignal,
  sessionFactory?: HostSessionFactory,
): Promise<number> {
  if (!args.workspace || args.workspace.trim() === '') {
    process.stderr.write('Error: --workspace is required for host command\n');
    return 1;
  }

  if (args.protocol !== 1) {
    process.stderr.write(
      `Error: Unsupported protocol version "${args.protocol}". Only protocol version 1 is supported.\n`,
    );
    return 1;
  }

  const factory: HostSessionFactory =
    sessionFactory ??
    (async (emit) => {
      return createHostRuntime({
        workspaceRoot: args.workspace,
        emit,
        providerId: args.provider,
        modelId: args.model,
      });
    });

  try {
    await serveHostProtocol(process.stdin, process.stdout, factory, signal);
    return 0;
  } catch (err: any) {
    process.stderr.write(`Host protocol error: ${err?.message || String(err)}\n`);
    return 1;
  }
}
