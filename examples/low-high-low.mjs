import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunContext } from '../src/adapter.mjs';
import { runNodeTestCheck } from '../src/checkers/node-test.mjs';
import { createRouter } from '../src/proxy.mjs';
import { close, listen, readBody, request } from '../test/http-fixture.mjs';

const model = 'demo-model';
const upstream = createServer(async (req, res) => {
  try {
    const { reasoning_effort: effort } = JSON.parse(await readBody(req));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ effort }));
  } catch {
    res.writeHead(400).end();
  }
});

let controller;
const workspace = await mkdtemp(join(tmpdir(), 'effort-controller-demo-'));
try {
  const upstreamOrigin = await listen(upstream);
  controller = createRouter({ upstream: upstreamOrigin, model, log: () => {} });
  const origin = await listen(controller);
  const context = new RunContext();
  async function send(label, observations, expected) {
    const response = await request(origin, {
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Demo request' }] }),
      headers: context.next(observations),
    });
    assert.equal(response.status, 200);
    const { effort } = JSON.parse(response.body);
    assert.equal(effort, expected);
    console.log(`${label}: ${effort}`);
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
  await send('Initial call', [], 'low');
  await writeFile(implementation, 'export const answer = () => 41;\n');
  const failure = await runNodeTestCheck({ ...check, id: 'fail-1' });
  await send('Verified failure', [failure], 'high');
  await writeFile(implementation, 'export const answer = () => 42;\n');
  const recheck = await runNodeTestCheck({ ...check, id: 'pass-1', resolves: failure.id });
  await send('Matching check passed', [recheck], 'low');
} finally {
  if (controller) await close(controller);
  await close(upstream);
  await rm(workspace, { recursive: true, force: true });
}
