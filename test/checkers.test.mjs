import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runNodeTestCheck } from '../src/checkers/node-test.mjs';

test('Node checker distinguishes failed assertions, successful rechecks and inconclusive runs', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'effort-controller-check-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'sample.test.mjs');
  const imports = "import test from 'node:test'; import assert from 'node:assert/strict';\n";
  const args = { files: [file], checkId: 'regression', id: 'current', resolves: 'previous' };
  const runSource = async source => {
    await writeFile(file, imports + source);
    return runNodeTestCheck(args);
  };
  const identity = { id: 'current', check_id: 'regression' };
  const failure = "test('assertion', () => assert.equal(1, 2));";
  const external = "test('permissions', () => { throw Object.assign(new Error('blocked'), { code: 'EACCES' }); });";
  assert.deepEqual(await runSource(failure), { ...identity, outcome: 'failure', category: 'reasoning' });
  assert.deepEqual(await runSource("test('output text', () => { console.log('FAILED'); assert.equal(1, 1); });"),
    { ...identity, outcome: 'success', resolves: 'previous' });
  for (const inconclusive of [external, failure + external, "test.skip('not run', () => assert.fail());"]) {
    assert.deepEqual(await runSource(inconclusive), { ...identity, outcome: 'unknown' });
  }
  assert.deepEqual(await runNodeTestCheck({ ...args, files: [join(dir, 'missing.test.mjs')] }),
    { ...identity, outcome: 'unknown' });
});
