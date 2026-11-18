const MAX_REPAIRS = 2;

const stopSummary = {
  repair_limit: 'Both repairs left the independent check failing.',
  unknown: 'The independent check could not establish a result.',
  repair_interrupted: 'The repair turn did not complete.',
  no_change: 'The last repair left the project diff unchanged and the check still failed.',
};

const questions = {
  repair_limit: 'Do the expected behavior, test inputs, and chosen code boundary still describe the same problem?',
  unknown: 'Can the same check run to completion in this environment?',
  repair_interrupted: 'What interrupted the repair, and can the same session safely continue?',
  no_change: 'What prevented a code change, and does the task need a decision before another attempt?',
};

/** The caller supplies a trusted check, a repair session, and a project diff reader. */
export async function runRepairLoop({ check, repair, readDiff }) {
  const attempts = [];
  const initial = await check({ id: 'before' });
  let latest = initial;
  let diff = await readDiff();

  function result(status) {
    const run = { status, initial, attempts, latest };
    if (status === 'passed' || status === 'already_passed') return run;
    const question = latest.reason === 'regression_test_changed'
      ? 'Can the original independent check be restored before resuming?'
      : questions[status];
    return {
      ...run,
      consultation: { reason: status, summary: stopSummary[status], question, latest, diff, attempts },
    };
  }

  if (initial.observation.outcome === 'success') return result('already_passed');
  if (initial.observation.outcome !== 'failure') return result('unknown');

  for (let number = 1; number <= MAX_REPAIRS; number++) {
    const problem = { ...latest, attempt: number };
    let usage;
    try {
      usage = await repair(problem);
    } catch {
      diff = await readDiff();
      attempts.push({ number, interrupted: true });
      return result('repair_interrupted');
    }
    const changed = await readDiff();
    const previousFailure = latest.observation.id;
    latest = await check({ id: `after-${number}`, resolves: previousFailure });
    attempts.push({ number, usage, ...latest });

    if (latest.observation.outcome === 'success') return result('passed');
    if (latest.observation.outcome !== 'failure') {
      diff = changed;
      return result('unknown');
    }
    if (changed === diff) return result('no_change');
    diff = changed;
  }

  return result('repair_limit');
}
