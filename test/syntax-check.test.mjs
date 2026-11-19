import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runRepairLoop } from '../src/repair-loop.mjs';

const cli = fileURLToPath(new URL('../src/check-cli.mjs', import.meta.url));

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'tfl-syntax-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const write = (file, content) => writeFile(join(cwd, file), content);
  await write('control.test.mjs', "import test from 'node:test'; test('control', () => {});\n");
  await write('source.mjs', 'export const value = 42;\n');
  return {
    write,
    check({ id = 'current', resolves, syntax = ['source.mjs'], file = 'control.test.mjs' } = {}) {
      const env = { ...process.env };
      // The standalone CLI starts its own node:test runner.
      delete env.NODE_TEST_CONTEXT;
      const run = spawnSync(process.execPath, [cli, '--json', '--cwd', cwd, '--id', id,
        ...syntax.flatMap(path => ['--syntax', path]), ...(resolves ? ['--resolves', resolves] : []), file],
      { encoding: 'utf8', timeout: 10_000, env });
      assert.ifError(run.error);
      assert.ok(run.stdout.trim().startsWith('{'), run.stderr || 'Missing JSON');
      return { ...JSON.parse(run.stdout), status: run.status };
    },
  };
}

test('explicit syntax input reaches a Low repair and the same check verifies the fix', async t => {
  const { write, check } = await fixture(t);
  const bad = 'export const good = 1;\nexport const broken = ;\n';
  let source = bad;
  await write('source.mjs', source);
  let diagnostic;
  const result = await runRepairLoop({
    check: async request => check(request),
    readDiff: async () => source,
    diagnose: async () => { assert.fail('High should not run'); },
    repair: async ({ effort, evidence }) => {
      assert.equal(effort, 'low');
      diagnostic = evidence[0];
      source = 'export const good = 1;\nexport const broken = 2;\n';
      await write('source.mjs', source);
    },
  });
  assert.equal(result.initial.status, 1);
  assert.equal(result.initial.observation.outcome, 'failure');
  assert.equal(result.initial.observation.category, 'reasoning');
  assert.equal(diagnostic.kind, 'code_syntax_error');
  assert.match(diagnostic.file, /source\.mjs$/);
  assert.equal(diagnostic.line, 2);
  assert.match(diagnostic.message, /SyntaxError/);
  assert.equal(result.status, 'passed');
  assert.equal(result.latest.status, 0);
  assert.equal(result.latest.observation.resolves, 'before');
});

test('valid syntax still runs the independent tests', async t => {
  const { check, write } = await fixture(t);
  assert.equal(check().observation.outcome, 'success');
  await write('control.test.mjs', "import test from 'node:test'; import assert from 'node:assert/strict'; test('control', () => assert.fail('control failed'));\n");
  const result = check();
  assert.equal(result.observation.outcome, 'failure');
  assert.match(result.evidence[0].message, /control failed/);
});

test('an unavailable source or a runtime SyntaxError is inconclusive', async t => {
  const { check, write } = await fixture(t);
  const missing = check({ syntax: ['missing.mjs'] });
  assert.equal(missing.status, 2);
  assert.equal(missing.observation.outcome, 'unknown');
  assert.equal(missing.evidence.length, 0);
  await write('control.test.mjs', "import test from 'node:test'; test('runtime', () => { throw new SyntaxError('runtime exception'); });\n");
  const runtime = check();
  assert.equal(runtime.status, 2);
  assert.equal(runtime.observation.outcome, 'unknown');
  assert.equal(runtime.evidence.length, 0);
});

test('syntax inputs can repeat and ordinary callers keep their existing behavior', async t => {
  const { check, write } = await fixture(t);
  await write('second.mjs', 'let = ;\n');
  assert.equal(check({ syntax: [] }).observation.outcome, 'success');
  const result = check({ syntax: ['source.mjs', 'second.mjs'] });
  assert.equal(result.status, 1);
  assert.match(result.evidence[0].file, /second\.mjs$/);
});
