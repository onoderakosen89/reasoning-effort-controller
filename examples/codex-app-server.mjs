import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { RunContext } from '../src/adapter.mjs';
import { runNodeTestCheck } from '../src/checkers/node-test.mjs';
import { CONTEXT_HEADER, decodeContext } from '../src/context.mjs';
import { Policy } from '../src/policy.mjs';
import { close, listen, readBody } from '../test/http-fixture.mjs';

const { values } = parseArgs({ options: {
  chatgpt: { type: 'boolean' },
  model: { type: 'string', default: 'gpt-6.2-sol' },
} });
const live = values.chatgpt === true;
const workspace = await mkdtemp(join(tmpdir(), 'effort-codex-demo-'));
const efforts = [];
const upstream = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/responses') {
    res.writeHead(404).end();
    return;
  }
  try {
    const { reasoning } = JSON.parse(await readBody(req));
    efforts.push(reasoning?.effort);
    const id = `demo-${efforts.length}`;
    const item = {
      id: `message-${id}`, type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'Recorded effort.', annotations: [] }],
    };
    const events = [
      { type: 'response.created', response: { id } },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id, status: 'completed', output: [item] } },
    ];
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
    res.end();
  } catch {
    res.writeHead(400).end();
  }
});

let child;
let exited;
try {
  const provider = live ? ['-c', 'model_provider="openai"'] : [
    '-c', 'model_provider="demo"',
    '-c', 'model_providers.demo.name="Local mock"',
    '-c', `model_providers.demo.base_url="${await listen(upstream)}/v1"`,
    '-c', 'model_providers.demo.wire_api="responses"',
  ];
  const env = live
    ? { ...process.env, OPENAI_API_KEY: undefined, CODEX_API_KEY: undefined, OPENAI_BASE_URL: undefined }
    : { PATH: process.env.PATH, HOME: workspace, USERPROFILE: workspace, CODEX_HOME: workspace };
  child = spawn(process.env.CODEX_BIN || 'codex', ['app-server', '--listen', 'stdio://', ...provider], {
    cwd: workspace, env, stdio: ['pipe', 'pipe', 'inherit'],
  });
  // Bound the entire demo. Any approval request is rejected and ends the run.
  const deadline = setTimeout(() => child.kill(), live ? 90_000 : 25_000);
  exited = once(child, 'exit');
  exited.then(() => clearTimeout(deadline), () => clearTimeout(deadline));
  await once(child, 'spawn');

  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const completed = new Map();
  let nextId = 0;
  function send(message) {
    child.stdin.write(JSON.stringify(message) + '\n');
  }
  async function receive() {
    const { value, done } = await lines.next();
    if (done) throw new Error('Codex App Server closed its output');
    const message = JSON.parse(value);
    if (message.method && message.id !== undefined) {
      send({ id: message.id, error: { code: -32601, message: 'The demo does not grant approvals' } });
      throw new Error(`Unexpected App Server request: ${message.method}`);
    }
    if (message.method === 'turn/completed') {
      completed.set(message.params.turn.id, message.params.turn);
    }
    return message;
  }
  async function request(method, params) {
    const id = ++nextId;
    send({ id, method, params });
    for (;;) {
      const message = await receive();
      if (message.id !== id) continue;
      if (message.error) throw new Error(`${method}: ${message.error.message}`);
      return message.result;
    }
  }
  await request('initialize', { clientInfo: { name: 'effort_controller_demo', version: '0.1.0' } });
  send({ method: 'initialized' });
  if (live) {
    const { account } = await request('account/read', { refreshToken: false });
    if (account?.type !== 'chatgpt') throw new Error('Sign in to Codex with ChatGPT before using --chatgpt');
  }
  const { thread } = await request('thread/start', {
    cwd: workspace, model: values.model, sandbox: 'read-only', ephemeral: true,
  });

  const policy = new Policy();
  const run = new RunContext();
  async function turn(label, observations, expected) {
    const context = decodeContext(run.next(observations)[CONTEXT_HEADER]);
    const decision = policy.decide(context, label);
    assert.equal(decision.effort, expected);
    const { turn: started } = await request('turn/start', {
      threadId: thread.id,
      input: [{ type: 'text', text: `${label}. Reply with OK and do not use any tools.` }],
      effort: decision.effort,
    });
    while (!completed.has(started.id)) await receive();
    const finished = completed.get(started.id);
    assert.equal(finished.status, 'completed', JSON.stringify(finished.error));
    if (!live) assert.equal(efforts.at(-1), expected);
    console.log(`${label}: ${decision.effort}`);
  }

  const implementation = join(workspace, 'answer.mjs');
  const testFile = join(workspace, 'regression.test.mjs');
  await writeFile(testFile, `
import assert from 'node:assert/strict';
import test from 'node:test';
import { answer } from './answer.mjs';
test('answer returns 42', () => assert.equal(answer(), 42));
`);
  const check = { files: [testFile], checkId: 'regression' };
  await turn('Initial turn', [], 'low');
  await writeFile(implementation, 'export const answer = () => 41;\n');
  const failure = await runNodeTestCheck({ ...check, id: 'failed' });
  await turn('Verified failure', [failure], 'high');
  await writeFile(implementation, 'export const answer = () => 42;\n');
  const recheck = await runNodeTestCheck({ ...check, id: 'passed', resolves: failure.id });
  await turn('Matching check passed', [recheck], 'low');
  if (!live) assert.deepEqual(efforts, ['low', 'high', 'low']);
} finally {
  if (child) {
    child.stdin.end();
    child.kill();
    await exited.catch(() => {});
  }
  await close(upstream);
  await rm(workspace, { recursive: true, force: true });
}
