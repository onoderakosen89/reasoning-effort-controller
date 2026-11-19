import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readNote, writeNote } from './app.mjs';

test('the storage function writes and reads an explicit file', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tfl-storage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'any-file.txt');
  await writeNote(file, 'first note');
  assert.equal(await readNote(file), 'first note');
});
