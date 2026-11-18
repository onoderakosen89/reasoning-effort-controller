import { run } from 'node:test';

/** Turn a trusted Node.js test run into one observation for RunContext. */
export async function runNodeTestCheck({ files, checkId, id, resolves, timeoutMs = 30_000 }) {
  if (!Array.isArray(files) || files.length === 0) throw new TypeError('Provide at least one test file');
  const observation = { id, check_id: checkId };
  let summary;
  let assertionFailed = false;
  let uncertainFailure = false;

  for await (const event of run({ files, timeout: timeoutMs, isolation: 'process' })) {
    if (event.type === 'test:summary' && !event.data.file) summary = event.data;
    if (event.type !== 'test:fail' || event.data.todo) continue;
    const error = event.data.details.error;
    // A parent test can also fail solely because a child already reported failure.
    if (error?.failureType === 'subtestsFailed') continue;
    if (error?.failureType === 'testCodeFailure' && error.cause?.code === 'ERR_ASSERTION') {
      assertionFailed = true;
    } else {
      uncertainFailure = true;
    }
  }

  if (summary && !uncertainFailure && assertionFailed) {
    return { ...observation, outcome: 'failure', category: 'reasoning' };
  }
  if (summary?.success && summary.counts.passed > 0 && !summary.counts.skipped && !summary.counts.todo) {
    return { ...observation, outcome: 'success', ...(resolves === undefined ? {} : { resolves }) };
  }
  return { ...observation, outcome: 'unknown' };
}
