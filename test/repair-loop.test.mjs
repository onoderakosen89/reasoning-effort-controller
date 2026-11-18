import assert from 'node:assert/strict';
import test from 'node:test';
import { runRepairLoop } from '../src/repair-loop.mjs';

test('the second repair receives fresh evidence and a third repair is never started', async () => {
  let change = 0;
  const problems = [];
  const result = await runRepairLoop({
    check: async ({ id }) => ({
      observation: { id, check_id: 'example', outcome: 'failure', category: 'reasoning' },
      evidence: [{ message: `observed ${change}` }],
    }),
    repair: async problem => {
      problems.push(problem);
      change++;
    },
    readDiff: async () => `change ${change}`,
  });
  assert.deepEqual(problems.map(problem => problem.evidence[0].message), ['observed 0', 'observed 1']);
  assert.equal(result.status, 'repair_limit');
  assert.equal(result.consultation.diff, 'change 2');
  assert.equal(result.consultation.latest.evidence[0].message, 'observed 2');
  assert.match(result.consultation.question, /expected behavior/);
});

test('an inconclusive recheck stops and preserves its reason and the diff', async () => {
  let changed = false;
  const result = await runRepairLoop({
    check: async ({ id }) => changed
      ? { observation: { id, outcome: 'unknown' }, evidence: [], reason: 'collection_failed' }
      : { observation: { id, outcome: 'failure' }, evidence: [{ message: 'first failure' }] },
    repair: async () => { changed = true; },
    readDiff: async () => changed ? 'new diff' : '',
  });
  assert.equal(result.status, 'unknown');
  assert.equal(result.attempts.length, 1);
  assert.equal(result.consultation.latest.reason, 'collection_failed');
  assert.equal(result.consultation.diff, 'new diff');
});
