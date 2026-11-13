import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Picture {
  data: Buffer;
  // png, jpg, webp or gif.
  extension: string;
}

// With a picture, the prompt must tell the model to read `PICTURE_NAME.<extension>` from the current folder.
export type Ask = (prompt: string, system: string, picture?: Picture) => Promise<string>;

export const PICTURE_NAME = 'capture';

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

function run(command: string, args: string[], cwd: string, prompt: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
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

// Calls the Claude CLI as a plain completion: no settings, no plugins, no saved session, so none of the owner's
// Claude Code setup reaches the call. The prompt goes in on stdin, where its length does not matter.
//
// Text calls get no tools at all. A picture is the one exception: the CLI takes images only through its file-reading
// tool, so that call gets Read alone and runs in a folder holding nothing but the picture. Without an allow-list the
// CLI refuses reads outside the folder it runs in, which keeps whatever the picture says from reaching other files.
export function claudeCli({ command, cwd, model, timeoutMs }: CliOptions): Ask {
  const base = ['-p', '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--model', model, '--output-format', 'json'];
  return async (prompt, system, picture) => {
    mkdirSync(cwd, { recursive: true });
    if (!picture) return run(command, [...base, '--system-prompt', system, '--tools', '', '--max-turns', '1'], cwd, prompt, timeoutMs);
    const folder = mkdtempSync(join(cwd, 'picture-'));
    try {
      writeFileSync(join(folder, `${PICTURE_NAME}.${picture.extension}`), picture.data);
      return await run(command, [...base, '--system-prompt', system, '--tools', 'Read', '--max-turns', '4'], folder, prompt, timeoutMs);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  };
}
