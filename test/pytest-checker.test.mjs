import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runPytestCheck } from '../src/checkers/pytest.mjs';

test('pytest rechecks same-size changes and leaves setup failures unknown', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pytest-checker-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'test_case.py');
  const fixedTime = new Date(1_700_000_000_000);
  const fixture = async content => {
    await writeFile(file, content);
    await utimes(file, fixedTime, fixedTime);
  };
  const options = { cwd: dir, files: [file], checkId: 'regression', id: 'current' };
  await fixture('def test_sample():\n    assert 41 == 42\n');
  // Seed the ordinary interpreter's assertion rewrite cache.
  assert.throws(() => execFileSync('python3', ['-m', 'pytest', '-q', file], { cwd: dir }), { status: 1 });
  const findings = [];
  const failed = await runPytestCheck({ ...options, onFailure: item => findings.push(item) });
  assert.deepEqual(failed, { id: 'current', check_id: 'regression', outcome: 'failure', category: 'reasoning' });
  assert.equal(findings[0].name, 'test_case.py::test_sample');
  await fixture('def test_sample():\n    assert 42 == 42\n');
  assert.deepEqual(await runPytestCheck({ ...options, id: 'after', resolves: failed.id }),
    { id: 'after', check_id: 'regression', outcome: 'success', resolves: 'current' });
  await fixture('import pytest\n@pytest.fixture\ndef setup():\n    raise PermissionError()\ndef test_sample(setup):\n    pass\n');
  assert.equal((await runPytestCheck(options)).outcome, 'unknown');
  assert.equal((await runPytestCheck({ ...options, files: [join(dir, 'missing.py')] })).outcome, 'unknown');
});

test('pytest imports uninstalled project packages and reports why a check could not run', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pytest-checker-import-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const pkg = join(dir, 'demo_pkg');
  const tests = join(dir, 'tests');
  await mkdir(pkg);
  await mkdir(tests);
  await writeFile(join(pkg, '__init__.py'), 'ANSWER = 42\n');
  const file = join(tests, 'test_answer.py');
  await writeFile(file, 'from demo_pkg import ANSWER\ndef test_sample():\n    assert ANSWER == 42\n');
  let reason;
  const options = { cwd: dir, files: [file], checkId: 'imports', id: 'sample',
    onUnknown: value => { reason = value; } };
  assert.equal((await runPytestCheck(options)).outcome, 'success');
  assert.equal((await runPytestCheck({ ...options, python: join(dir, 'missing-python') })).outcome, 'unknown');
  assert.equal(reason, 'python_launch_failed');
  await writeFile(file, 'import package_that_does_not_exist\n');
  assert.equal((await runPytestCheck(options)).outcome, 'unknown');
  assert.equal(reason, 'collection_failed');
});
