// This suite needs authorized localhost sockets. It never contacts a real model.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { RunContext } from '../src/adapter.mjs';
import { encodeContext } from '../src/context.mjs';
import { fixture, echo, failure, request, readBody } from './http-fixture.mjs';

const opts = { timeout: 5000 };
const raw = Buffer.from('{"model":"fixed-model","messages":[{"role":"user","content":"FAILED example"}],"reasoning_effort":"medium","unknown":900719925474099312345}');
const meta = (seq, observations = [], run_id = 'run-a', call_id = `call-${seq}`) => ({
  'x-effort-context': encodeContext({ v: 1, run_id, call_id, seq, observations }),
});

test('real HTTP: low/high/hold/recheck, whole batch, false positive and unknown', opts, async t => {
  const f = await fixture(t, echo);
  const run = new RunContext();
  const send = observations => request(f.origin, { body: raw, headers: run.next(observations) });
  assert.equal(JSON.parse((await send([])).body).reasoning_effort, 'low');
  assert.equal(JSON.parse((await send([failure(), { id: 'read1', check_id: 'read', outcome: 'success' }])).body).reasoning_effort, 'high');
  assert.equal(JSON.parse((await send([{ id: 'unknown', check_id: 'suite', outcome: 'unknown' }])).body).reasoning_effort, 'high');
  assert.equal(JSON.parse((await send([{ id: 'read2', check_id: 'read', outcome: 'success' }])).body).reasoning_effort, 'high');
  assert.equal(JSON.parse((await send([{ id: 'passed', check_id: 'suite', outcome: 'success', resolves: 'failure' }])).body).reasoning_effort, 'low');
  assert.equal(f.captures.length, 5);
  assert.ok(f.captures.every(c => c.headers['x-effort-context'] === undefined));
});

test('real HTTP: external errors never become reasoning failures', opts, async t => {
  const f = await fixture(t, echo);
  for (const category of ['approval', 'permission', 'quota', 'transport']) {
    const result = await request(f.origin, { body: raw, headers: meta(1, [failure('f', 'suite', category)], category) });
    assert.equal(JSON.parse(result.body).reasoning_effort, 'low');
  }
});

test('real HTTP: separate runs and simultaneous identical retries are isolated and stable', opts, async t => {
  const f = await fixture(t, echo);
  const repeated = { body: raw, headers: meta(1, [failure()]) };
  const results = await Promise.all(Array.from({ length: 6 }, () => request(f.origin, repeated)));
  assert.ok(results.every(r => JSON.parse(r.body).reasoning_effort === 'high'));
  const other = await request(f.origin, { body: raw, headers: meta(1, [], 'other-run') });
  assert.equal(JSON.parse(other.body).reasoning_effort, 'low');
  assert.equal(f.logs.filter(l => l.run_id === 'run-a' && l.replay).length, 5);
  assert.equal(f.captures.length, 7); // Decision replay is NOT upstream exactly-once.
});

test('real HTTP: conflict and out-of-order sequence are unmodified passthrough', opts, async t => {
  const f = await fixture(t, echo);
  await request(f.origin, { body: raw, headers: meta(1) });
  const changed = Buffer.from(raw.toString().replace('FAILED', 'different'));
  assert.deepEqual((await request(f.origin, { body: changed, headers: meta(1) })).body, changed);
  assert.deepEqual((await request(f.origin, { body: raw, headers: meta(3) })).body, raw);
  assert.ok(f.logs.some(l => l.reason === 'call_conflict'));
  assert.ok(f.logs.some(l => l.reason === 'sequence_gap'));
});

test('real HTTP: only effort bytes change, query/header extensions remain, telemetry omits secrets', opts, async t => {
  const f = await fixture(t, echo);
  const result = await request(f.origin, { path: '/v1/chat/completions?custom=secret-query', body: raw,
    headers: { ...meta(1), authorization: 'Bearer test-key', 'x-future': 'retained' } });
  assert.equal(result.body.toString(), raw.toString().replace('"medium"', '"low"'));
  assert.equal(result.headers['x-future-response'], 'kept');
  assert.deepEqual(result.headers['set-cookie'], ['a=1', 'b=2']);
  assert.equal(f.captures[0].headers.authorization, 'Bearer test-key');
  assert.equal(f.captures[0].headers['x-future'], 'retained');
  assert.equal(f.captures[0].url, '/v1/chat/completions?custom=secret-query');
  const logs = JSON.stringify(f.logs);
  for (const value of ['test-key', 'secret-query', 'FAILED', '900719925474099312345']) assert.ok(!logs.includes(value));
});

test('real HTTP: unsupported and non-target requests retain their exact body', opts, async t => {
  const f = await fixture(t, echo);
  for (const options of [
    { path: '/v1/embeddings', body: raw, headers: meta(1) },
    { body: raw },
    { body: raw, headers: { 'x-effort-context': 'invalid' } },
    { body: raw, headers: { ...meta(1), 'content-type': 'text/plain' } },
    { body: gzipSync(raw), headers: { ...meta(1), 'content-encoding': 'gzip' } },
    { body: Buffer.from('not json'), headers: meta(1) },
    { body: Buffer.from('{"model":"other","future":123}'), headers: meta(1) },
  ]) assert.deepEqual((await request(f.origin, options)).body, Buffer.from(options.body));
});

test('real HTTP: oversized chunked request is replayed fully without adaptation', opts, async t => {
  const f = await fixture(t, echo, { maxBodyBytes: 16 });
  const large = Buffer.from(JSON.stringify({ model: 'fixed-model', payload: 'z'.repeat(128 * 1024) }));
  const result = await request(f.origin, { body: large,
    headers: { ...meta(1), 'transfer-encoding': 'chunked' } });
  assert.deepEqual(result.body, large);
  assert.equal(f.logs[0].reason, 'body_too_large');
});

test('real HTTP: Responses nested effort preserves unknown siblings', opts, async t => {
  const f = await fixture(t, echo);
  const body = Buffer.from('{"model":"fixed-model","input":[],"reasoning":{"summary":"auto","effort":"medium","future":true}}');
  const result = await request(f.origin, { path: '/v1/responses', body, headers: meta(1, [failure()]) });
  assert.equal(result.body.toString(), body.toString().replace('"medium"', '"high"'));
});

test('real HTTP: upstream error status and body pass through without retry or escalation', opts, async t => {
  let count = 0;
  const f = await fixture(t, async (req, res) => {
    await readBody(req); count++;
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '12' });
    res.end('{"error":{"code":"quota"}}');
  });
  const result = await request(f.origin, { body: raw, headers: meta(1) });
  assert.equal(result.status, 429);
  assert.equal(result.headers['retry-after'], '12');
  assert.equal(result.body.toString(), '{"error":{"code":"quota"}}');
  assert.equal(count, 1);
  assert.equal(f.logs[0].effort, 'low');
});

test('real HTTP: first SSE bytes arrive before upstream finishes; all bytes remain identical', opts, async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = ': keepalive\n\ndata: {"text":"日"}\n\n';
  const last = 'data: [DONE]\n\n';
  const f = await fixture(t, async (req, res) => {
    await readBody(req);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(first);
    await gate;
    res.end(last);
  });
  t.after(release);
  const chunks = [];
  await new Promise((resolve, reject) => {
    const req = http.request(`${f.origin}/v1/chat/completions`, { method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', ...meta(1) } }, res => {
      assert.match(res.headers['content-type'], /text\/event-stream/);
      res.on('data', chunk => { chunks.push(chunk); release(); });
      res.on('end', resolve);
      res.on('error', reject);
    });
    req.on('error', reject); req.end(raw);
  });
  assert.equal(Buffer.concat(chunks).toString(), first + last);
});

test('real HTTP: upstream partial SSE disconnect is a downstream error, never a forged DONE', opts, async t => {
  const f = await fixture(t, async (req, res) => {
    await readBody(req);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: partial\n\n', () => setImmediate(() => res.destroy()));
  });
  await assert.rejects(request(f.origin, { body: raw, headers: meta(1) }));
  await f.waitForLog(l => l.outcome === 'upstream_disconnect');
});

test('real HTTP: downstream cancellation closes the upstream SSE response', opts, async t => {
  let observedClose;
  const closed = new Promise(resolve => { observedClose = resolve; });
  const f = await fixture(t, async (req, res) => {
    await readBody(req);
    res.on('close', observedClose);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: first\n\n');
  });
  await new Promise((resolve, reject) => {
    const req = http.request(`${f.origin}/v1/chat/completions`, { method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', ...meta(1) } }, res => {
      res.once('data', () => { res.destroy(); req.destroy(); resolve(); });
      res.on('error', () => {});
    });
    req.on('error', reject); req.end(raw);
  });
  await closed;
  await f.waitForLog(l => l.outcome === 'client_cancel');
});

test('real HTTP: idle timeout before headers returns 504 and closes upstream', opts, async t => {
  let observedClose;
  const closed = new Promise(resolve => { observedClose = resolve; });
  const f = await fixture(t, async (req, res) => {
    res.on('close', observedClose); await readBody(req);
  }, { idleMs: 50, timeoutMs: 500 });
  const result = await request(f.origin, { body: raw, headers: meta(1) });
  assert.equal(result.status, 504);
  assert.equal(JSON.parse(result.body).error.code, 'idle_timeout');
  await closed;
});

test('real HTTP: overall timeout terminates active heartbeat SSE without inventing success', opts, async t => {
  const f = await fixture(t, async (req, res) => {
    await readBody(req);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(': start\n\n');
    const timer = setInterval(() => res.write(': alive\n\n'), 10);
    res.on('close', () => clearInterval(timer));
  }, { timeoutMs: 100, idleMs: 1000 });
  await assert.rejects(request(f.origin, { body: raw, headers: meta(1) }));
  await f.waitForLog(l => l.outcome === 'total_timeout');
});

test('real HTTP: idle timeout after SSE headers preserves the timeout cause', opts, async t => {
  const f = await fixture(t, async (req, res) => {
    await readBody(req);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(': only heartbeat\n\n');
  }, { timeoutMs: 1000, idleMs: 50 });
  await assert.rejects(request(f.origin, { body: raw, headers: meta(1) }));
  await f.waitForLog(l => l.outcome === 'idle_timeout');
});

test('real HTTP: total timeout bounds a slow inspected request body before upstream delivery', opts, async t => {
  const f = await fixture(t, echo, { timeoutMs: 50, idleMs: 1000 });
  const result = await new Promise((resolve, reject) => {
    const req = http.request(`${f.origin}/v1/chat/completions`, { method: 'POST', agent: false,
      headers: { ...meta(1), 'content-type': 'application/json', 'content-length': '10000' } }, res => {
      const parts = [];
      res.on('data', part => parts.push(part));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write('{"model":');
  });
  assert.equal(result.status, 504);
  assert.equal(JSON.parse(result.body).error.code, 'total_timeout');
  assert.equal(f.captures.length, 0);
  await f.waitForLog(l => l.outcome === 'total_timeout');
});

test('real HTTP: cancellation during inspected upload never sends a partial model request', opts, async t => {
  const f = await fixture(t, echo);
  const req = http.request(`${f.origin}/v1/chat/completions`, { method: 'POST', agent: false,
    headers: { ...meta(1), 'content-type': 'application/json', 'content-length': '10000' } });
  req.on('error', () => {});
  const arrived = once(f.router, 'request');
  req.write('{"model":');
  const [incoming] = await arrived;
  const aborted = once(incoming, 'aborted');
  req.destroy();
  await aborted;
  assert.equal(f.captures.length, 0);
});
