import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { RunContext } from '../src/adapter.mjs';
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
try {
  const upstreamOrigin = await listen(upstream);
  controller = createRouter({ upstream: upstreamOrigin, model, log: () => {} });
  const origin = await listen(controller);
  const run = new RunContext();
  const steps = [
    { label: 'Initial call', observations: [], expected: 'low' },
    {
      label: 'Verified failure',
      observations: [{ id: 'fail-1', check_id: 'regression', outcome: 'failure', category: 'reasoning' }],
      expected: 'high',
    },
    {
      label: 'Matching check passed',
      observations: [{ id: 'pass-1', check_id: 'regression', outcome: 'success', resolves: 'fail-1' }],
      expected: 'low',
    },
  ];
  for (const { label, observations, expected } of steps) {
    const response = await request(origin, {
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Demo request' }] }),
      headers: run.next(observations),
    });
    assert.equal(response.status, 200);
    const { effort } = JSON.parse(response.body);
    assert.equal(effort, expected);
    console.log(`${label}: ${effort}`);
  }
} finally {
  if (controller) await close(controller);
  await close(upstream);
}
