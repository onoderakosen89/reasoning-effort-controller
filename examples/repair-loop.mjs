import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { runNodeTestCheck } from '../src/checkers/node-test.mjs';
import { runRepairLoop } from '../src/repair-loop.mjs';

const { values } = parseArgs({ options: {
  chatgpt: { type: 'boolean' },
  'show-stop': { type: 'boolean' },
  model: { type: 'string', default: 'gpt-6.2-sol' },
} });
if (values.chatgpt && values['show-stop']) throw new Error('Choose the live repair or the scripted stop.');

const workspace = await mkdtemp(join(tmpdir(), 'test-feedback-repair-'));
const implementation = join(workspace, 'answer.mjs');
const testFile = join(workspace, 'answer.test.mjs');
const original = 'export const answer = () => 41;\n';
const regression = `import assert from 'node:assert/strict';
import test from 'node:test';
import { answer } from './answer.mjs';
test('returns 42', () => assert.equal(answer(), 42));
test('returns a number', () => assert.equal(typeof answer(), 'number'));
`;

let sessionId;
const executable = process.env.CODEX_BIN || 'codex';
const env = { ...process.env, OPENAI_API_KEY: undefined, CODEX_API_KEY: undefined, OPENAI_BASE_URL: undefined };
async function callCodex(args, prompt, onEvent) {
  const child = spawn(executable, args, { cwd: workspace, env, stdio: ['pipe', 'pipe', 'inherit'] });
  child.stdin.on('error', () => {});
  const done = once(child, 'close');
  // Register the handler before starting to read output, which may also end on spawn failure.
  done.catch(() => {});
  const deadline = setTimeout(() => child.kill(), 120_000);
  try {
    child.stdin.end(prompt);
    for await (const line of createInterface({ input: child.stdout })) onEvent(line);
    const [code] = await done;
    if (code !== 0) throw new Error('Codex command failed');
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

async function readFixture(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function repairWithCodex(problem) {
  const args = ['exec', '--ignore-user-config', '--sandbox', 'workspace-write',
    '--skip-git-repo-check', '--json', '-m', values.model, '-c', 'model_provider="openai"',
    '-c', 'model_reasoning_effort="low"'];
  if (sessionId) args.push('resume', sessionId);
  args.push('-');
  const context = sessionId ? 'The same independent check ran again.' :
    'Fix the failing behavior by changing only answer.mjs in this disposable fixture.';
  let usage;
  await callCodex(args, `${context}\n${JSON.stringify(problem)}`, line => {
    const event = JSON.parse(line);
    if (event.type === 'thread.started') {
      if (sessionId && sessionId !== event.thread_id) throw new Error('Codex resumed a different session');
      sessionId = event.thread_id;
    }
    if (event.type === 'turn.completed') usage = event.usage;
  });
  if (!sessionId || !usage) throw new Error('Codex did not report a completed turn');
  return usage;
}

try {
  if (values.chatgpt) {
    const { status, stdout, stderr } = spawnSync(executable, ['login', 'status'], {
      cwd: workspace, env, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    // The status text may be on stderr. Check the mode before running the demo.
    if (status !== 0 || ![stdout, stderr].some(text => text?.includes('Logged in using ChatGPT'))) throw new Error('Sign in to Codex with ChatGPT before using --chatgpt');
  }
  await writeFile(implementation, original);
  await writeFile(testFile, regression);
  const check = async ({ id, resolves }) => {
    if (await readFixture(testFile) !== regression) {
      return { observation: { id, check_id: 'answer', outcome: 'unknown' },
        evidence: [], reason: 'regression_test_changed' };
    }
    const evidence = [];
    let reason;
    const observation = await runNodeTestCheck({ files: [testFile], cwd: workspace, checkId: 'answer',
      id, resolves, onFailure: item => evidence.push(item), onUnknown: value => { reason = value; } });
    return { observation, evidence, ...(reason && { reason }) };
  };
  const repair = values.chatgpt ? repairWithCodex : async ({ attempt, evidence }) => {
    if (!evidence.length) throw new Error('The repair requires assertion evidence');
    const answer = values['show-stop'] ? 42 + attempt : 42;
    await writeFile(implementation, `export const answer = () => ${answer};\n`);
  };
  const readDiff = async () => {
    const current = await readFixture(implementation);
    if (current === original) return '';
    return ['--- before/answer.mjs', current === null ? '+++ /dev/null' : '+++ current/answer.mjs',
      ...original.trimEnd().split('\n').map(line => `-${line}`),
      ...(current === null ? [] : current.trimEnd().split('\n').map(line => `+${line}`))].join('\n');
  };
  const result = await runRepairLoop({ check, repair, readDiff });
  console.log(JSON.stringify(result, null, 2));
  if (result.consultation) process.exitCode = result.status === 'unknown' ? 2 : 1;
} finally {
  await rm(workspace, { recursive: true, force: true });
}
