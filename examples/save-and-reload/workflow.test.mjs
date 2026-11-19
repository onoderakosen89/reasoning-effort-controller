import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('./app.mjs', import.meta.url));
const miswired = process.env.TFL_DEMO_MISWIRED === '1';

async function fixture(t, seed) {
  const directory = await mkdtemp(join(tmpdir(), 'tfl-workflow-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  if (seed) await writeFile(join(directory, 'note.txt'), seed, 'utf8');
  return directory;
}

async function runApp(directory, operation) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const args = [entry, '--data', directory, '--port', '0'];
  if (miswired) args.push('--miswired');
  const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const done = once(child, 'close');
  done.catch(() => {});
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  const timeout = setTimeout(() => child.kill(), 5000);
  try {
    const first = await lines[Symbol.asyncIterator]().next();
    if (first.done || !/^http:\/\/127\.0\.0\.1:\d+$/.test(first.value)) {
      throw new Error('Could not start independent application entry point');
    }
    return await operation(first.value);
  } finally {
    clearTimeout(timeout);
    lines.close();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await done;
  }
}

async function page(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(3000) });
  if (response.status !== 200) throw new Error('HTTP check unavailable: ' + response.status);
  return response.text();
}

async function saveAndReload(directory, note) {
  const saved = await runApp(directory, url => page(url, { method: 'POST', body: new URLSearchParams({ note }) }));
  assert.match(saved, /role="status">Saved</);
  return runApp(directory, url => page(url));
}

test('a saved note survives a fresh application process', async t => {
  const directory = await fixture(t);
  assert.match(await saveAndReload(directory, 'new note'), /<textarea[^>]*>new note<\/textarea>/);
});

test('editing an existing note keeps the updated content after reload', async t => {
  const directory = await fixture(t, 'existing note');
  const initial = await runApp(directory, url => page(url));
  assert.match(initial, /<textarea[^>]*>existing note<\/textarea>/);
  assert.match(await saveAndReload(directory, 'updated note'), /<textarea[^>]*>updated note<\/textarea>/);
});
