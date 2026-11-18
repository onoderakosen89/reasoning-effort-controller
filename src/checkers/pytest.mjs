import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const runner = fileURLToPath(new URL('./pytest_runner.py', import.meta.url));

export async function runPytestCheck({ files, cwd, python = 'python3', checkId, id, resolves,
  timeoutMs = 30_000, onFailure, onUnknown }) {
  if (!Array.isArray(files) || files.length === 0) throw new TypeError('Provide at least one test file');
  const observation = { id, check_id: checkId };
  const unknown = reason => {
    onUnknown?.(reason);
    return { ...observation, outcome: 'unknown' };
  };
  const folder = await mkdtemp(join(tmpdir(), 'test-feedback-pytest-'));
  const report = join(folder, 'report.json');
  try {
    let exitCode = 0;
    const child = run(python, ['-B', '-X', `pycache_prefix=${join(folder, 'pycache')}`,
      runner, report, ...files], { cwd, timeout: timeoutMs });
    child.child.stdin.end();
    try {
      await child;
    } catch (error) {
      exitCode = error.code;
      if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return unknown('output_limit');
      if (error.killed) return unknown('test_timeout');
      if (typeof exitCode === 'string') return unknown('python_launch_failed');
    }
    const result = JSON.parse(await readFile(report, 'utf8'));
    for (const failure of result.failures ?? []) onFailure?.(failure);
    if (exitCode === 1 && result.outcome === 'failure') {
      return { ...observation, outcome: 'failure', category: 'reasoning' };
    }
    if (exitCode === 0 && result.outcome === 'success') {
      return { ...observation, outcome: 'success', ...(resolves === undefined ? {} : { resolves }) };
    }
    return unknown(result.reason ?? 'incomplete_run');
  } catch {
    return unknown('pytest_report_unavailable');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
