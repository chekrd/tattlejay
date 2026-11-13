import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

export type Ask = (prompt: string, system: string) => Promise<string>;

export interface CliOptions {
  command: string;
  // An empty folder of the app's own: the CLI loads project instructions from where it runs.
  cwd: string;
  model: string;
  timeoutMs: number;
}

export function readEnvelope(stdout: string, code: number | null, stderr: string): string {
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout);
  } catch (err) {
    const said = (stderr || stdout).trim().slice(0, 300);
    throw new Error(`the Claude CLI gave no readable answer${code ? ` (exit ${code})` : ''}${said ? `: ${said}` : ''}`, { cause: err });
  }
  const { is_error: isError, result } = envelope as { is_error?: unknown; result?: unknown };
  const said = typeof result === 'string' ? result : 'no result';
  if (isError || typeof result !== 'string') throw new Error(`the Claude CLI reported an error: ${said.slice(0, 300)}`);
  return result;
}

// Calls the Claude CLI as a plain completion: no tools, no settings, no plugins, no saved session, so none of the
// owner's Claude Code setup reaches the call. The prompt goes in on stdin, where its length does not matter.
export function claudeCli({ command, cwd, model, timeoutMs }: CliOptions): Ask {
  return (prompt, system) =>
    new Promise((resolve, reject) => {
      mkdirSync(cwd, { recursive: true });
      const child = spawn(
        command,
        [
          '-p',
          '--system-prompt',
          system,
          '--tools',
          '',
          '--setting-sources',
          '',
          '--strict-mcp-config',
          '--disable-slash-commands',
          '--no-session-persistence',
          '--model',
          model,
          '--max-turns',
          '1',
          '--output-format',
          'json',
        ],
        { cwd, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`the model did not answer within ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      child.stdout.on('data', (chunk) => (stdout += String(chunk)));
      child.stderr.on('data', (chunk) => (stderr += String(chunk)));
      child.stdin.on('error', () => {});
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`could not start the Claude CLI (${command}): ${err.message}`, { cause: err }));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        try {
          resolve(readEnvelope(stdout, code, stderr));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
      child.stdin.end(prompt);
    });
}
