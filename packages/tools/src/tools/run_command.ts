import { spawn } from 'node:child_process';
import {
  IToolDefinition,
  RunCommandParams,
  RunCommandParamsSchema,
  ToolExecutionContext,
  ToolResult,
} from '@moderado/contracts';
import { resolveInJail } from '../jail.js';

const SENSITIVE_ENV_VARS = [
  'NVIDIA_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'MODERADO_TOKEN',
];

const MAX_BUFFER_BYTES = 64 * 1024; // 64KB limit per stream

export function getSanitizedEnv(): NodeJS.ProcessEnv {
  const cleanEnv = { ...process.env };
  for (const key of SENSITIVE_ENV_VARS) {
    delete cleanEnv[key];
  }
  return cleanEnv;
}

export const RunCommandTool: IToolDefinition<RunCommandParams> = {
  name: 'run_command',
  description: 'Execute an external command using an argument array with shell: false.',
  requiresApproval: true,
  parametersSchema: RunCommandParamsSchema,

  async execute(params: RunCommandParams, context: ToolExecutionContext): Promise<ToolResult> {
    const cwd = resolveInJail(context.workspaceRoot, '.');

    // Windows batch guard: prevent silent shell execution of batch files
    const cmdLower = params.command.toLowerCase();
    if (cmdLower.endsWith('.bat') || cmdLower.endsWith('.cmd')) {
      return {
        toolName: 'run_command',
        status: 'error',
        output: `Error: Cannot execute Windows batch file '${params.command}' directly with shell: false. Invoke via 'cmd.exe' with explicit args ['/c', '${params.command}'].`,
      };
    }

    return new Promise((resolve) => {
      const sanitizedEnv = getSanitizedEnv();
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let timedOut = false;
      let settled = false;

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(params.command, params.args, {
          cwd,
          env: sanitizedEnv,
          shell: false,
          windowsHide: true,
        });
      } catch (err: any) {
        return resolve({
          toolName: 'run_command',
          status: 'error',
          output: `Failed to spawn process '${params.command}': ${err.message}`,
        });
      }

      // Output buffer capture with size capping
      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdoutBuffer.length + chunk.length > MAX_BUFFER_BYTES) {
          const allowed = Math.max(0, MAX_BUFFER_BYTES - stdoutBuffer.length);
          stdoutBuffer += chunk.toString('utf8', 0, allowed);
          stdoutTruncated = true;
        } else {
          stdoutBuffer += chunk.toString('utf8');
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderrBuffer.length + chunk.length > MAX_BUFFER_BYTES) {
          const allowed = Math.max(0, MAX_BUFFER_BYTES - stderrBuffer.length);
          stderrBuffer += chunk.toString('utf8', 0, allowed);
          stderrTruncated = true;
        } else {
          stderrBuffer += chunk.toString('utf8');
        }
      });

      // Timeout timer
      const timeoutTimer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        killProcess();
      }, params.timeoutSeconds * 1000);

      // Abort signal listener
      const onAbort = () => {
        if (settled) return;
        killProcess();
      };

      if (context.abortSignal) {
        context.abortSignal.addEventListener('abort', onAbort, { once: true });
      }

      function killProcess() {
        try {
          child.kill('SIGTERM');
          setTimeout(() => {
            try {
              child.kill('SIGKILL');
            } catch {
              // ignore
            }
          }, 2000);
        } catch {
          // ignore
        }
      }

      function cleanup() {
        settled = true;
        clearTimeout(timeoutTimer);
        if (context.abortSignal) {
          context.abortSignal.removeEventListener('abort', onAbort);
        }
      }

      child.on('error', (err) => {
        cleanup();
        resolve({
          toolName: 'run_command',
          status: 'error',
          output: `Process error while executing '${params.command}': ${err.message}`,
        });
      });

      child.on('close', (code, signal) => {
        cleanup();

        let output = '';
        if (stdoutBuffer) {
          output += stdoutBuffer;
          if (stdoutTruncated) {
            output += '\n... [stdout truncated at 64KB]';
          }
        }
        if (stderrBuffer) {
          if (output) output += '\n';
          output += `[stderr]\n${stderrBuffer}`;
          if (stderrTruncated) {
            output += '\n... [stderr truncated at 64KB]';
          }
        }

        if (timedOut) {
          return resolve({
            toolName: 'run_command',
            status: 'error',
            output: `Command timed out after ${params.timeoutSeconds} seconds.\n${output}`,
            metadata: { timedOut: true },
          });
        }

        if (signal) {
          return resolve({
            toolName: 'run_command',
            status: 'error',
            output: `Command terminated by signal ${signal}.\n${output}`,
            metadata: { signal },
          });
        }

        const isSuccess = code === 0;
        return resolve({
          toolName: 'run_command',
          status: isSuccess ? 'success' : 'error',
          output: output.trim() || `(Process exited with code ${code})`,
          metadata: {
            exitCode: code,
            stdoutTruncated,
            stderrTruncated,
          },
        });
      });
    });
  },
};
