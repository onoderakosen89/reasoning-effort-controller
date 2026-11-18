import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runNodeTestCheck } from '../src/checkers/node-test.mjs';

export async function runRegressionCycle(workspace, call) {
  const implementation = join(workspace, 'answer.mjs');
  const testFile = join(workspace, 'regression.test.mjs');
  await writeFile(testFile, `
import assert from 'node:assert/strict';
import test from 'node:test';
import { answer } from './answer.mjs';
test('answer returns 42', () => assert.equal(answer(), 42));
`);
  const check = { files: [testFile], checkId: 'regression' };
  await call('Initial call', [], 'low');
  await writeFile(implementation, 'export const answer = () => 41;\n');
  const failure = await runNodeTestCheck({ ...check, id: 'failed' });
  await call('Verified failure', [failure], 'high');
  await writeFile(implementation, 'export const answer = () => 42;\n');
  const recheck = await runNodeTestCheck({ ...check, id: 'passed', resolves: failure.id });
  await call('Matching check passed', [recheck], 'low');
}
