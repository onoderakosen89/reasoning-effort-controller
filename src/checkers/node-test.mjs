import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { run } from 'node:test';

const exec = promisify(execFile);

function parserDiagnostic(stderr, path, file) {
  const output = stderr.replaceAll('\r\n', '\n');
  if (!output.startsWith(path)) return;
  const body = output.slice(path.length);
  const header = /^(?::([1-9]\d*))?\n/.exec(body);
  if (!header) return;
  // Require the native --check stack, not just a source excerpt containing “SyntaxError”.
  const diagnostic = /\n\n(SyntaxError(?:: [^\n]*)?)\n((?:    at [^\n]+\n)+)\nNode\.js v[^\n]+\n$/.exec(body.slice(header[0].length - 1));
  if (!diagnostic || !/^    at checkSyntax \(node:internal\/main\/check_syntax:\d+:\d+\)$/m.test(diagnostic[2])) return;
  const line = Number(header[1]);
  return { kind: 'code_syntax_error', name: 'Node syntax check', file,
    ...(Number.isSafeInteger(line) && { line }), message: diagnostic[1] };
}

async function checkSyntax(files, cwd, timeoutMs) {
  const env = { ...process.env };
  // Inherited preload flags can run arbitrary code before Node reaches the parser.
  delete env.NODE_OPTIONS;
  const deadline = performance.now() + timeoutMs;
  let failure;
  for (const input of files) {
    let file, path;
    try {
      if (!input) return { reason: 'syntax_input_unavailable' };
      file = resolve(cwd ?? process.cwd(), input);
      path = await realpath(file);
      if (!(await stat(path)).isFile()) return { reason: 'syntax_input_unavailable' };
      await access(path, constants.R_OK);
    } catch {
      return { reason: 'syntax_input_unavailable' };
    }
    const timeout = Math.ceil(deadline - performance.now());
    if (timeout <= 0) return { reason: 'syntax_timeout' };
    try {
      const { stdout, stderr } = await exec(process.execPath, ['--check', '--', path], {
        cwd, env, timeout, killSignal: 'SIGKILL', maxBuffer: 64 * 1024,
      });
      if (stdout || stderr) return { reason: 'syntax_inconclusive' };
    } catch (error) {
      if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { reason: 'syntax_output_limit' };
      if (error.killed) return { reason: 'syntax_timeout' };
      if (typeof error.code === 'string') return { reason: 'syntax_runner_unavailable' };
      const diagnostic = error.code === 1 && !error.stdout && parserDiagnostic(error.stderr, path, file);
      if (!diagnostic) return { reason: 'syntax_inconclusive' };
      failure ??= diagnostic;
    }
  }
  return { failure };
}

/** Turn a trusted Node.js test run into one observation for RunContext. */
export async function runNodeTestCheck({ files, cwd, syntaxFiles = [], checkId, id, resolves,
  timeoutMs = 30_000, onFailure, onUnknown }) {
  if (!Array.isArray(files) || files.length === 0) throw new TypeError('Provide at least one test file');
  const observation = { id, check_id: checkId };
  const unknown = reason => {
    onUnknown?.(reason);
    return { ...observation, outcome: 'unknown' };
  };
  if (syntaxFiles.length) {
    const { reason, failure } = await checkSyntax(syntaxFiles, cwd, timeoutMs);
    if (reason) return unknown(reason);
    if (failure) {
      onFailure?.(failure);
      return { ...observation, outcome: 'failure', category: 'reasoning' };
    }
  }
  let summary;
  let assertionFailed = false;
  let uncertainFailure = false;

  for await (const event of run({ files, cwd, timeout: timeoutMs, isolation: 'process' })) {
    if (event.type === 'test:summary' && !event.data.file) summary = event.data;
    if (event.type !== 'test:fail' || event.data.todo) continue;
    const error = event.data.details.error;
    // A parent test can also fail solely because a child already reported failure.
    if (error?.failureType === 'subtestsFailed') continue;
    if (error?.failureType === 'testCodeFailure' && error.cause?.code === 'ERR_ASSERTION') {
      assertionFailed = true;
      onFailure?.({
        name: event.data.name, file: event.data.file, line: event.data.line,
        message: error.cause.message,
      });
    } else {
      uncertainFailure = true;
    }
  }

  if (summary && !uncertainFailure && assertionFailed) {
    return { ...observation, outcome: 'failure', category: 'reasoning' };
  }
  if (summary?.success && !uncertainFailure && !assertionFailed &&
      summary.counts.passed > 0 && !summary.counts.skipped && !summary.counts.todo) {
    return { ...observation, outcome: 'success', ...(resolves === undefined ? {} : { resolves }) };
  }
  const reason = uncertainFailure ? 'test_error'
    : !summary || summary.counts.cancelled ? 'incomplete_run'
    : summary.counts.skipped || summary.counts.todo ? 'skipped_tests'
    : !summary.counts.passed ? 'no_tests' : 'incomplete_run';
  onUnknown?.(reason);
  return { ...observation, outcome: 'unknown' };
}
