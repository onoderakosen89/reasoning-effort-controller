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
  let diagnosed = false;
  const result = await runRepairLoop({
    check: async ({ id }) => changed
      ? { observation: { id, outcome: 'unknown' }, evidence: [], reason: 'collection_failed' }
      : { observation: { id, outcome: 'failure' }, evidence: [{ message: 'first failure' }] },
    repair: async () => { changed = true; },
    readDiff: async () => changed ? 'new diff' : '',
    diagnose: async () => { diagnosed = true; },
  });
  assert.equal(result.status, 'unknown');
  assert.equal(diagnosed, false);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.consultation.latest.reason, 'collection_failed');
  assert.equal(result.consultation.diff, 'new diff');
});

test('callers can set a positive repair limit', async () => {
  let edits = 0;
  const options = {
    check: async ({ id }) => ({ observation: { id, outcome: 'failure' }, evidence: [] }),
    repair: async () => { edits++; },
    readDiff: async () => String(edits),
  };
  await assert.rejects(runRepairLoop({ ...options, maxRepairs: 0 }), RangeError);
  assert.equal(edits, 0);
  const result = await runRepairLoop({ ...options, maxRepairs: 3 });
  assert.equal(edits, 3);
  assert.equal(result.status, 'repair_limit');
  assert.match(result.consultation.summary, /\(3\)/);
});

test('two failed Low repairs trigger one High diagnosis and a verified Low repair', async () => {
  let edits = 0;
  const turns = [];
  const result = await runRepairLoop({
    check: async ({ id, resolves }) => ({
      observation: { id, resolves, outcome: edits === 3 ? 'success' : 'failure' },
      evidence: [`observed ${edits}`],
    }),
    repair: async ({ effort, diagnosis }) => {
      turns.push(effort);
      if (++edits === 3) assert.equal(diagnosis.next, 'Correct the existing branch.');
    },
    readDiff: async () => `diff ${edits}`,
    diagnose: async ({ effort, attempts, latest, diff }) => {
      turns.push(effort);
      assert.equal(attempts.length, 2);
      assert.deepEqual(latest.evidence, ['observed 2']);
      assert.equal(diff, 'diff 2');
      return { action: 'repair', cause: 'Wrong branch.', evidence: 'Observed branch output.', next: 'Correct the existing branch.' };
    },
  });
  assert.deepEqual(turns, ['low', 'low', 'high', 'low']);
  assert.equal(result.status, 'passed');
  assert.equal(result.latest.observation.resolves, 'after-2');
});

test('an unknown cause, a human decision, or a failed diagnosis stops before any more repairs', async () => {
  for (const [action, status] of [
    ['unknown', 'diagnosis_unknown'], ['human_decision', 'diagnosis_needs_decision'],
    ['throw', 'diagnosis_interrupted'], ['invalid', 'diagnosis_interrupted'],
  ]) {
    let edits = 0;
    const result = await runRepairLoop({
      check: async ({ id }) => ({ observation: { id, outcome: 'failure' }, evidence: ['mismatch'] }),
      repair: async () => { edits++; },
      readDiff: async () => String(edits),
      diagnose: async () => {
        if (action === 'throw') throw new Error('Model unavailable');
        if (action === 'invalid') return { action: 'repair' };
        return { action, cause: 'Unclear expectation.', evidence: 'Tests disagree.', next: 'Confirm the expected output.' };
      },
    });
    assert.equal(edits, 2);
    assert.equal(result.status, status);
    assert.equal(result.consultation.diff, '2');
    assert.deepEqual(result.consultation.latest.evidence, ['mismatch']);
    if (result.diagnosis) assert.equal(result.consultation.question, result.diagnosis.next);
  }
});

test('a modified diff blocks repair and a failed post-diagnosis repair cannot loop', async () => {
  for (const mutateDuringDiagnosis of [true, false]) {
    let state = 0;
    let diagnoses = 0;
    let repairs = 0;
    const result = await runRepairLoop({
      check: async ({ id }) => ({ observation: { id, outcome: 'failure' } }),
      repair: async () => { repairs++; state++; },
      readDiff: async () => String(state),
      diagnose: async () => {
        diagnoses++;
        if (mutateDuringDiagnosis) state++;
        return { action: 'repair', cause: 'Wrong line.', evidence: 'Assertion failed.', next: 'Correct the line.' };
      },
    });
    assert.equal(diagnoses, 1);
    assert.equal(repairs, mutateDuringDiagnosis ? 2 : 3);
    assert.equal(result.status, mutateDuringDiagnosis ? 'diagnosis_changed_diff' : 'repair_limit');
  }
});

test('operational failures keep their stage and the evidence already collected', async () => {
  for (const scenario of ['initial_check', 'recheck', 'read_diff', 'repair_and_diff']) {
    let edits = 0;
    let reads = 0;
    const unavailable = new Error('fixture-private-raw-error');
    let result;
    try {
      result = await runRepairLoop({
        check: async ({ id }) => {
          if (scenario === 'initial_check' || (scenario === 'recheck' && edits)) throw unavailable;
          return { observation: { id, outcome: 'failure' }, evidence: ['recorded assertion'] };
        },
        repair: async () => {
          edits++;
          if (scenario === 'repair_and_diff') throw unavailable;
        },
        readDiff: async () => {
          reads++;
          if (scenario === 'read_diff' || (scenario === 'repair_and_diff' && reads > 1)) throw unavailable;
          return edits ? 'changed' : 'known baseline';
        },
      });
    } catch (error) {
      if (error !== unavailable) throw error;
      assert.fail(`${scenario}: the known callback rejection escaped instead of returning consultation`);
    }
    assert.ok(result.consultation, scenario);
    assert.equal(result.consultation.stage, scenario === 'repair_and_diff' ? 'repair' : scenario);
    assert.ok(!JSON.stringify(result).includes(unavailable.message), scenario);
    if (scenario === 'recheck' || scenario === 'repair_and_diff') {
      assert.deepEqual(result.consultation.latest.evidence, ['recorded assertion']);
      assert.equal(result.consultation.attempts.length, 1);
      assert.equal(result.consultation.diff, scenario === 'recheck' ? 'changed' : 'known baseline');
    }
    if (scenario === 'read_diff') assert.equal(edits, 0);
  }
});
