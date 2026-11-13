import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { claudeCli, readEnvelope } from './model.ts';

test('reads the result out of the CLI envelope', () => {
  assert.equal(readEnvelope('{"is_error":false,"result":"[1]"}', 0, ''), '[1]');
  assert.throws(() => readEnvelope('{"is_error":true,"result":"Not logged in"}', 1, ''), /reported an error: Not logged in/);
  assert.throws(() => readEnvelope('', 1, 'command failed'), /no readable answer \(exit 1\): command failed/);
});

// Stands in for the CLI: echoes back what it was given, in the CLI's own envelope.
function fakeCli(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'fake-claude-')), 'claude.mjs');
  writeFileSync(
    path,
    `#!${process.execPath}
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  const after = (flag) => args[args.indexOf(flag) + 1];
  const result = JSON.stringify({ input, system: after('--system-prompt'), model: after('--model'), tools: after('--tools'), cwd: process.cwd() });
  console.log(JSON.stringify({ is_error: false, result }));
});
`,
  );
  chmodSync(path, 0o755);
  return path;
}

test('sends the prompt on stdin, the system prompt as an argument, and runs in its own folder', async () => {
  const cwd = join(mkdtempSync(join(tmpdir(), 'model-')), 'not-there-yet');
  const ask = claudeCli({ command: fakeCli(), cwd, model: 'sonnet', timeoutMs: 10_000 });
  const reply = JSON.parse(await ask('the prompt', 'the system')) as Record<string, string>;

  assert.equal(reply.input, 'the prompt');
  assert.equal(reply.system, 'the system');
  assert.equal(reply.model, 'sonnet');
  assert.equal(reply.tools, '');
  assert.match(reply.cwd ?? '', /not-there-yet$/);
});

test('fails clearly when the CLI is missing', async () => {
  const ask = claudeCli({ command: '/nonexistent/claude', cwd: mkdtempSync(join(tmpdir(), 'model-')), model: 'sonnet', timeoutMs: 10_000 });
  await assert.rejects(ask('p', 's'), /could not start the Claude CLI/);
});
