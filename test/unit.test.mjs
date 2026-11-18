import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Policy } from '../src/policy.mjs';
import { encodeContext, decodeContext } from '../src/context.mjs';
import { routeBody, prepareBody } from '../src/wire.mjs';
import { RunContext } from '../src/adapter.mjs';
import { forwardHeaders, inspectPrefix, createRouter } from '../src/proxy.mjs';

const failure = (id = 'failed', check_id = 'test-suite', category = 'reasoning') =>
  ({ id, check_id, outcome: 'failure', category });
const success = (resolves = 'failed', check_id = 'test-suite', id = 'passed') =>
  ({ id, check_id, outcome: 'success', resolves });
const context = (seq = 1, observations = [], run_id = 'run-a', call_id = `call-${seq}`) =>
  ({ v: 1, run_id, call_id, seq, observations });
const body = Buffer.from('{"model":"fixed-model","messages":[{"role":"user","content":"hello"}]}');
const route = (policy, ctx, raw = body, path = '/v1/chat/completions') =>
  routeBody({ policy, body: raw, path, model: 'fixed-model', encodedContext: encodeContext(ctx) });

test('FAILED prose and repeated tool calls do not imply reasoning failure', () => {
  const raw = Buffer.from(JSON.stringify({ model: 'fixed-model', messages: [
    { role: 'tool', tool_call_id: 'a', content: 'FAILED is a word in this manual. Exit code: 1' },
    { role: 'assistant', tool_calls: [{ id: 'a', function: { name: 'read', arguments: '{}' } }] },
    { role: 'assistant', tool_calls: [{ id: 'b', function: { name: 'read', arguments: '{}' } }] },
  ] }));
  const result = route(new Policy(), context(), raw);
  assert.equal(result.decision.effort, 'low');
  assert.equal(result.decision.unknown, true);
  assert.deepEqual(JSON.parse(result.body).messages, JSON.parse(raw).messages);
});

test('high survives unrelated read success and unknown; only a matching recheck restores low', () => {
  const p = new Policy();
  assert.equal(route(p, context(1, [failure()])).decision.effort, 'high');
  assert.equal(route(p, context(2, [{ id: 'read', check_id: 'read-file', outcome: 'success' }])).decision.effort, 'high');
  assert.equal(route(p, context(3, [{ id: 'uncertain', check_id: 'test-suite', outcome: 'unknown' }])).decision.effort, 'high');
  assert.equal(route(p, context(4, [success('failed', 'other-check', 'wrong')])).decision.effort, 'high');
  const result = route(p, context(5, [success()]));
  assert.equal(result.decision.effort, 'low');
  assert.equal(result.decision.reason, 'recheck_succeeded');
});

test('parallel results all count and all matching failures must be resolved', () => {
  const p = new Policy();
  const start = route(p, context(1, [failure('f1'), failure('f2', 'lint'),
    { id: 'last', check_id: 'read', outcome: 'success' }]));
  assert.equal(start.decision.pending, 2);
  assert.equal(route(p, context(2, [success('f1')])).decision.effort, 'high');
  assert.equal(route(p, context(3, [success('f2', 'lint', 'pass-lint')])).decision.effort, 'low');
});

test('same-batch fabricated recheck cannot clear a new failure in either order', () => {
  for (const events of [[failure(), success()], [success(), failure()]]) {
    assert.equal(route(new Policy(), context(1, events)).decision.effort, 'high');
  }
});

test('approval, permission, quota and transport failures do not raise low or clear high', () => {
  for (const category of ['approval', 'permission', 'quota', 'transport', 'unknown']) {
    const p = new Policy();
    const a = route(p, context(1, [failure('external1', 'tool', category)]));
    assert.equal(a.decision.effort, 'low');
    route(p, context(2, [failure()]));
    const b = route(p, context(3, [failure('external2', 'tool', category)]));
    assert.equal(b.decision.effort, 'high');
    assert.equal(b.decision.pending, 1);
  }
});

test('identical prompt in separate runs never shares pending failures', () => {
  const p = new Policy();
  assert.equal(route(p, context(1, [failure()], 'run-a')).decision.effort, 'high');
  assert.equal(route(p, context(1, [], 'run-b')).decision.effort, 'low');
});

test('retry after later recovery retains original effort and never reopens the failure', () => {
  const p = new Policy();
  const first = context(1, [failure()]);
  const original = route(p, first);
  route(p, context(2, [success()]));
  const retry = route(p, first);
  assert.equal(retry.decision.replay, true);
  assert.deepEqual(retry.body, original.body);
  assert.equal(p.runs.get('run-a').pending.size, 0);
  assert.equal(p.runs.get('run-a').events.size, 2);
});

test('call collision, stale sequence and out-of-order delivery pass unchanged, without mutations', () => {
  const p = new Policy();
  route(p, context());
  for (const [ctx, raw, reason] of [
    [context(), Buffer.from('{"model":"fixed-model","new":1}'), 'call_conflict'],
    [context(1, [], 'run-a', 'other'), body, 'sequence_gap'],
    [context(3), body, 'sequence_gap'],
  ]) {
    const result = route(p, ctx, raw);
    assert.equal(result.decision.reason, reason);
    assert.deepEqual(result.body, raw);
    assert.equal(p.runs.get('run-a').calls.size, 1);
  }
  assert.equal(route(p, context(2)).decision.managed, true);
  assert.equal(route(p, context(3)).decision.managed, true);
});

test('duplicate observations do not count twice; conflicting batch is atomic', () => {
  const p = new Policy();
  route(p, context(1, [failure(), failure()]));
  assert.equal(route(p, context(2, [failure()])).decision.pending, 1);
  const result = route(p, context(3, [failure('new'), failure('failed', 'changed')]));
  assert.equal(result.decision.reason, 'event_conflict');
  assert.equal(p.runs.get('run-a').events.size, 1);
  assert.equal(p.runs.get('run-a').seq, 2);
});

test('bounded state never silently evicts replay protection', () => {
  const p = new Policy({ maxRuns: 1, maxCalls: 1, maxEvents: 1 });
  const first = context(1, [failure()]);
  route(p, first);
  assert.equal(route(p, context(1, [], 'run-b')).decision.reason, 'capacity');
  assert.equal(route(p, context(2)).decision.reason, 'capacity');
  assert.equal(route(p, first).decision.replay, true);
  assert.equal(route(new Policy({ maxEvents: 1 }), context(1, [failure('a'), failure('b')])).decision.reason, 'capacity');
});

test('unknown arguments and exact numeric/escape/whitespace bytes survive the single-field edit', () => {
  const raw = Buffer.from('{ "model":"fixed-model", "messages": [ {"content":"\\u65e5\\nFAILED"} ], "tools":[], "vendor_id":900719925474099312345, "future":{"n":1e400}, "reasoning_effort" : "medium" }');
  const result = route(new Policy(), context(), raw);
  assert.equal(result.body.toString(), raw.toString().replace('"medium"', '"low"'));
});

test('Responses changes nested effort only and preserves unknown reasoning fields', () => {
  const raw = Buffer.from('{"model":"fixed-model","input":[],"reasoning": { "summary":"auto", "future":12345678901234567890,"effort":"medium" }}');
  const result = route(new Policy(), context(1, [failure()]), raw, '/v1/responses');
  assert.equal(result.body.toString(), raw.toString().replace('"medium"', '"high"'));
  for (const source of ['{"model":"fixed-model","reasoning":{ }}', '{"model":"fixed-model"}']) {
    assert.equal(JSON.parse(prepareBody(Buffer.from(source), '/v1/responses', 'fixed-model')('low')).reasoning.effort, 'low');
  }
});

test('invalid/ambiguous JSON is byte-for-byte passthrough without recording policy state', () => {
  for (const raw of [Buffer.from('broken'), Buffer.from('{"model":"fixed-model","x":1,"x":2}'),
    Buffer.from('{"model":"fixed-model","x":{"y":0,"y":1}}'),
    Buffer.from([0xff]), Buffer.from('\ufeff{"model":"fixed-model"}')]) {
    const p = new Policy();
    assert.deepEqual(route(p, context(), raw).body, raw);
    assert.equal(p.runs.size, 0);
  }
  const raw = Buffer.from('{"model":"fixed-model","reasoning":null}');
  assert.deepEqual(route(new Policy(), context(), raw, '/v1/responses').body, raw);
});

test('non-target model and malformed context pass exactly without modifying state', () => {
  const p = new Policy();
  const raw = Buffer.from('{"model":"other-model","reasoning_effort":"medium"}');
  assert.deepEqual(route(p, context(), raw).body, raw);
  for (const encodedContext of ['', 'bad%%', 'e30', encodeContext(context()) + '=']) {
    assert.deepEqual(routeBody({ body, path: '/v1/chat/completions', model: 'fixed-model', policy: p, encodedContext }).body, body);
  }
  assert.equal(p.runs.size, 0);
});

test('contract rejects malformed classifications, missing IDs, oversize metadata and untrusted prose', () => {
  for (const ctx of [{ ...context(), run_id: '' }, { ...context(), seq: 1.5 },
    { ...context(), observations: [failure('a', 'test', 'FAILED')] },
    { ...context(), observations: [{ ...failure(), content: 'private' }] },
    { ...context(), observations: Array.from({ length: 65 }, () => failure()) },
    { ...context(), run_id: '../secrets' }]) assert.throws(() => encodeContext(ctx));
  const many = context(1, Array.from({ length: 64 }, (_, i) => failure(`id-${i}`, 'x'.repeat(80))));
  assert.throws(() => encodeContext(many), /too_large/);
  assert.deepEqual(decodeContext(encodeContext(context())), context());
});

test('caller helper separates runs and freezes a reusable retry header', () => {
  const a = new RunContext(); const b = new RunContext();
  const first = a.next();
  assert.ok(Object.isFrozen(first));
  assert.notEqual(decodeContext(first['x-effort-context']).run_id, b.runId);
  const second = a.next([failure()]);
  assert.equal(decodeContext(second['x-effort-context']).seq, 2);
  assert.equal(decodeContext(first['x-effort-context']).seq, 1);
});

test('headers preserve end-to-end extensions and repeated values, remove hop-by-hop and private context', () => {
  const message = { headers: { connection: 'keep-alive, x-hop' }, headersDistinct: {
    connection: ['keep-alive, x-hop'], host: ['client'], 'x-hop': ['secret'],
    authorization: ['Bearer test-key'], 'x-effort-context': ['private'],
    'x-future': ['one', 'two'], 'transfer-encoding': ['chunked'],
  } };
  const headers = forwardHeaders(message, { request: true, host: '127.0.0.1:1', length: 50 });
  assert.equal(headers.host, '127.0.0.1:1');
  assert.equal(headers.authorization, 'Bearer test-key');
  assert.deepEqual(headers['x-future'], ['one', 'two']);
  assert.equal(headers['content-length'], '50');
  for (const key of ['connection', 'x-hop', 'x-effort-context', 'transfer-encoding']) assert.equal(headers[key], undefined);
});

test('oversized inspection replays every byte across chunks', async () => {
  const chunks = [Buffer.from('abc'), Buffer.from('defg'), Buffer.from('hijkl')];
  const result = await inspectPrefix(Readable.from(chunks), 4);
  assert.ok(result.stream);
  const got = [];
  for await (const chunk of result.stream) got.push(chunk);
  assert.deepEqual(Buffer.concat(got), Buffer.concat(chunks));
  const small = await inspectPrefix(Readable.from(chunks), 100);
  assert.deepEqual(small.body, Buffer.concat(chunks));
});

test('upstream cannot be changed to an external host or model-suffix override', () => {
  for (const upstream of ['http://example.com', 'http://127.0.0.1/path', 'http://u:p@127.0.0.1', 'https://127.0.0.1']) {
    assert.throws(() => createRouter({ upstream, model: 'fixed-model' }));
  }
  assert.throws(() => createRouter({ upstream: 'http://127.0.0.1', model: 'fixed-model(high)' }));
});
