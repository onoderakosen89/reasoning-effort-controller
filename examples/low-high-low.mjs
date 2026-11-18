import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunContext } from '../src/adapter.mjs';
import { runRegressionCycle } from './regression-cycle.mjs';
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

  await runRegressionCycle(workspace, send);
} finally {
  if (controller) await close(controller);
  await close(upstream);
  await rm(workspace, { recursive: true, force: true });
}
