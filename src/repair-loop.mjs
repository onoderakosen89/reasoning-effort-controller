const stopSummary = {
  unknown: 'The independent check could not establish a result.',
  repair_interrupted: 'The repair turn did not complete.',
  diagnosis_unknown: 'The diagnosis could not identify an actionable cause.',
  diagnosis_needs_decision: 'The diagnosis requires a human decision.',
  diagnosis_interrupted: 'The diagnosis did not return a usable result.',
  diagnosis_diff_unavailable: 'The project diff could not be checked after diagnosis.',
  diagnosis_changed_diff: 'The project diff changed during the read-only diagnosis.',
  no_change: 'The last repair left the project diff unchanged and the check still failed.',
};

const questions = {
  repair_limit: 'Do the expected behavior, test inputs, and chosen code boundary still describe the same problem?',
  unknown: 'Can the same check run to completion in this environment?',
  repair_interrupted: 'What interrupted the repair, and can the same session safely continue?',
  diagnosis_interrupted: 'Can the diagnosis be run again with the same evidence?',
  diagnosis_diff_unavailable: 'Can the current project diff be read before retrying?',
  diagnosis_changed_diff: 'What changed during diagnosis, and can the original diff be restored?',
  no_change: 'What prevented a code change, and does the task need a decision before another attempt?',
};

const operationalErrors = {
  initial_check: 'The initial check callback failed.',
  repair: 'The repair callback failed.',
  recheck: 'The recheck callback failed.',
  read_diff: 'The diff reader callback failed.',
};

/** The caller supplies a trusted check, a repair session, and a project diff reader. */
export async function runRepairLoop({ check, repair, readDiff, maxRepairs = 2, diagnose }) {
  if (!Number.isSafeInteger(maxRepairs) || maxRepairs < 1) {
    throw new RangeError('maxRepairs must be a positive safe integer');
  }
  if (diagnose !== undefined && typeof diagnose !== 'function') {
    throw new TypeError('diagnose must be a function');
  }
  for (const [name, callback] of Object.entries({ check, repair, readDiff })) {
    if (typeof callback !== 'function') throw new TypeError(`${name} must be a function`);
  }
  const attempts = [];
  let diagnosis;
  let initial;
  let latest;
  let diff;

  function result(status, stage) {
    const run = { status, initial, attempts, latest, ...(diagnosis && { diagnosis }) };
    if (status === 'passed' || status === 'already_passed') return run;
    const question = latest?.reason === 'regression_test_changed'
      ? 'Can the original independent check be restored before resuming?'
      : (status === 'diagnosis_unknown' || status === 'diagnosis_needs_decision'
        ? diagnosis.next : questions[status]);
    const summary = status === 'repair_limit'
      ? `The independent check still failed after reaching the repair limit (${attempts.length}).`
      : stopSummary[status];
    return {
      ...run,
      consultation: {
        reason: status, summary, question, latest, diff, attempts,
        ...(stage && { stage, error: operationalErrors[stage] }),
      },
    };
  }

  try {
    initial = await check({ id: 'before' });
  } catch {
    return result('unknown', 'initial_check');
  }
  latest = initial;
  try {
    diff = await readDiff();
  } catch {
    return result('unknown', 'read_diff');
  }

  if (initial.observation.outcome === 'success') return result('already_passed');
  if (initial.observation.outcome !== 'failure') return result('unknown');

  for (let number = 1; number <= maxRepairs + (diagnosis?.action === 'repair' ? 1 : 0); number++) {
    const problem = diagnose
      ? { ...latest, attempt: number, effort: 'low', ...(diagnosis && { diagnosis }) }
      : { ...latest, attempt: number };
    let usage;
    try {
      usage = await repair(problem);
    } catch {
      attempts.push({ number, interrupted: true });
      try {
        diff = await readDiff();
      } catch {
        // Keep the last known diff; the repair failure is primary.
      }
      return result('repair_interrupted', 'repair');
    }
    const previousDiff = diff;
    try {
      diff = await readDiff();
    } catch {
      attempts.push({ number, usage });
      return result('unknown', 'read_diff');
    }
    const previousFailure = latest.observation.id;
    try {
      latest = await check({ id: `after-${number}`, resolves: previousFailure });
    } catch {
      attempts.push({ number, usage });
      return result('unknown', 'recheck');
    }
    attempts.push({ number, usage, ...latest });

    if (latest.observation.outcome === 'success') return result('passed');
    if (latest.observation.outcome !== 'failure') return result('unknown');
    const hasChange = diff !== previousDiff;
    if (diagnose && number === maxRepairs) {
      let decision;
      try {
        decision = await diagnose(structuredClone({ initial, attempts, latest, diff, effort: 'high' }));
      } catch {
        // Preserve the latest evidence when the diagnostic callback fails.
      }
      let afterDiagnosis;
      try {
        afterDiagnosis = await readDiff();
      } catch {
        return result('diagnosis_diff_unavailable', 'read_diff');
      }
      if (afterDiagnosis !== diff) {
        diff = afterDiagnosis;
        return result('diagnosis_changed_diff');
      }
      if (!['repair', 'unknown', 'human_decision'].includes(decision?.action) ||
          !['cause', 'evidence', 'next'].every(field => typeof decision[field] === 'string' && decision[field].trim())) {
        return result('diagnosis_interrupted');
      }
      diagnosis = { action: decision.action, cause: decision.cause, evidence: decision.evidence, next: decision.next };
      if (diagnosis.action === 'unknown') return result('diagnosis_unknown');
      if (diagnosis.action === 'human_decision') return result('diagnosis_needs_decision');
    } else if (!hasChange) {
      return result('no_change');
    }
  }

  return result('repair_limit');
}
