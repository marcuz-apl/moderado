import fs from 'node:fs';
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

export function splitCommandString(str: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if (char === '\\') {
      if (process.platform === 'win32') {
        // On Windows, backslash is a directory separator unless immediately escaping a quote
        const nextChar = str[i + 1];
        if (nextChar === '"' || nextChar === "'") {
          current += nextChar;
          i++;
          continue;
        }
        current += char;
        continue;
      } else {
        // On POSIX, backslash escapes the next character
        if (i + 1 < str.length) {
          current += str[++i];
          continue;
        }
        current += char;
        continue;
      }
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

export function parseCommandLine(command: string, args: string[] = []): { executable: string; args: string[] } {
  const trimmed = command.trim();
  if (!trimmed) {
    return { executable: '', args: [] };
  }

  if (args.length > 0) {
    if (fs.existsSync(trimmed)) {
      return { executable: trimmed, args };
    }
    if (trimmed.includes(' ')) {
      const parts = splitCommandString(trimmed);
      return {
        executable: parts[0] || trimmed,
        args: [...parts.slice(1), ...args],
      };
    }
    return { executable: trimmed, args };
  }

  if (fs.existsSync(trimmed)) {
    return { executable: trimmed, args: [] };
  }

  // Check if command starts with an existing executable path (e.g. unquoted C:\Program Files\nodejs\node.exe)
  const lower = trimmed.toLowerCase();
  for (const ext of ['.exe', '.cmd', '.bat']) {
    const idx = lower.indexOf(ext);
    if (idx !== -1 && (idx + ext.length === trimmed.length || /\s/.test(trimmed[idx + ext.length]))) {
      const candidate = trimmed.slice(0, idx + ext.length);
      if (fs.existsSync(candidate)) {
        const rest = trimmed.slice(idx + ext.length).trim();
        return {
          executable: candidate,
          args: rest ? splitCommandString(rest) : [],
        };
      }
    }
  }

  const parts = splitCommandString(trimmed);
  return {
    executable: parts[0] || trimmed,
    args: parts.slice(1),
  };
}

export const RunCommandTool: IToolDefinition<RunCommandParams> = {
  name: 'run_command',
  description: 'shell alias: execute an external command and argument array with shell: false; shell syntax is not interpreted.',
  requiresApproval: true,
  parametersSchema: RunCommandParamsSchema,

  async execute(params: RunCommandParams, context: ToolExecutionContext): Promise<ToolResult> {
    const cwd = resolveInJail(context.workspaceRoot, '.');
    const { executable, args } = parseCommandLine(params.command, params.args);

    let spawnExec = executable;
    let spawnArgs = args;

    if (process.platform === 'win32') {
      const lower = executable.toLowerCase();
      const isBatch = lower.endsWith('.cmd') || lower.endsWith('.bat');
      const isCmdBuiltin = ['dir', 'del', 'copy', 'move', 'type', 'mkdir', 'rmdir', 'cls', 'ver', 'vol'].includes(lower);
      const isCommonNodeCmd = ['npm', 'npx', 'pnpm', 'yarn', 'tsc', 'corepack'].includes(lower);

      if (isBatch || isCmdBuiltin || isCommonNodeCmd) {
        spawnExec = process.env.COMSPEC || 'cmd.exe';
        spawnArgs = ['/d', '/s', '/c', executable, ...args];
      }
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
        child = spawn(spawnExec, spawnArgs, {
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

      const timeoutSecs = typeof params.timeoutSeconds === 'number' && !isNaN(params.timeoutSeconds) ? params.timeoutSeconds : 60;

      // Timeout timer
      const timeoutTimer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        killProcess();
      }, timeoutSecs * 1000);

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
            output: `Command timed out after ${timeoutSecs} seconds.\n${output}`,
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
