import http from 'node:http';
import { Readable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { CONTEXT_HEADER } from './context.mjs';
import { Policy } from './policy.mjs';
import { routeBody } from './wire.mjs';

const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade']);

export function forwardHeaders(message, { request = false, host, length } = {}) {
  const blocked = new Set(HOP);
  for (const token of (message.headers.connection ?? '').split(',')) blocked.add(token.trim().toLowerCase());
  if (request) blocked.add(CONTEXT_HEADER);
  const result = Object.create(null);
  for (const [key, values] of Object.entries(message.headersDistinct)) {
    if (!blocked.has(key) && !(request && key === 'host')) result[key] = values.length === 1 ? values[0] : values;
  }
  if (request) result.host = host;
  if (length !== undefined) result['content-length'] = String(length);
  return result;
}

// Once inspection exceeds the cap, replay the buffered prefix and then stream.
export async function inspectPrefix(source, limit) {
  const iterator = source.iterator({ destroyOnReturn: false });
  const chunks = [];
  let size = 0;
  while (true) {
    const next = await iterator.next();
    if (next.done) return { body: Buffer.concat(chunks, size) };
    chunks.push(next.value);
    size += next.value.length;
    if (size > limit) {
      return { stream: Readable.from((async function* () {
        try {
          yield* chunks;
          while (true) {
            const next = await iterator.next();
            if (next.done) break;
            yield next.value;
          }
        } finally { await iterator.return?.(); }
      })()) };
    }
  }
}

export function createRouter({ upstream, model, baseEffort, failureEffort, timeoutMs = 120_000, idleMs = 30_000,
  maxBodyBytes = 2 * 1024 * 1024, policy = new Policy({ baseEffort, failureEffort }),
  log = row => console.log(JSON.stringify(row)) }) {
  const origin = new URL(upstream);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' ||
      origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
    throw new Error('upstream must be an HTTP origin on 127.0.0.1');
  }
  if (typeof model !== 'string' || !model || /[()\s]/.test(model)) throw new Error('explicit unsuffixed model required');
  for (const value of [timeoutMs, idleMs, maxBodyBytes]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('positive integer limits required');
  }
  const agent = new http.Agent({ keepAlive: true, proxyEnv: {} });
  const server = http.createServer((req, res) => {
    const started = performance.now();
    let upstreamRequest;
    let upstreamResponse;
    let bodySource;
    let context;
    let decision = { managed: false, effort: null, reason: 'non_target_request', unknown: true };
    let outcome;
    let logged = false;
    const stopUpstream = () => {
      upstreamResponse?.destroy();
      upstreamRequest?.destroy();
      if (bodySource && bodySource !== req) bodySource.destroy();
    };
    const record = () => {
      if (logged) return;
      logged = true;
      clearTimeout(timer);
      try {
        log({ at: new Date().toISOString(), ...decision,
          ...(context ? { run_id: context.run_id, call_id: context.call_id, seq: context.seq } : {}),
          status: res.headersSent ? res.statusCode : null,
          outcome: outcome ?? (res.writableFinished ? 'complete' : 'client_cancel'),
          elapsed_ms: Math.round((performance.now() - started) * 1000) / 1000 });
      } catch { /* Telemetry cannot change request delivery. */ }
    };
    const fail = (status, code) => {
      // destroy() can synchronously emit upstream 'aborted'; keep the first cause.
      if (outcome !== undefined || logged || res.writableEnded || res.destroyed) return;
      outcome = code;
      stopUpstream();
      if (res.headersSent) res.destroy();
      else {
        res.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
        res.end(JSON.stringify({ error: { type: 'effort_router_transport', code } }));
      }
    };
    const timer = setTimeout(() => fail(504, 'total_timeout'), timeoutMs);
    res.on('finish', record);
    res.on('close', () => {
      stopUpstream();
      if (!req.complete) req.destroy();
      record();
    });
    req.on('aborted', () => { outcome ??= 'client_cancel'; stopUpstream(); res.destroy(); });
    req.on('error', () => { outcome ??= 'client_cancel'; stopUpstream(); res.destroy(); });
    res.on('error', () => { outcome ??= 'client_cancel'; stopUpstream(); });

    async function handle() {
      // Only origin-form URLs; never let an absolute client URL pick the host.
      if (!req.url.startsWith('/') || req.url.startsWith('//')) return fail(400, 'invalid_target');
      const path = req.url.split('?', 1)[0];
      const target = req.method === 'POST' && ['/v1/chat/completions', '/v1/responses'].includes(path);
      let body;
      let length;
      bodySource = req;
      if (target) {
        const values = req.headersDistinct[CONTEXT_HEADER];
        decision.reason = !values ? 'missing_context' : 'unsupported_encoding';
        const jsonType = /^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '');
        if (values && jsonType && (!req.headers['content-encoding'] || req.headers['content-encoding'] === 'identity')) {
          const inspected = await inspectPrefix(req, maxBodyBytes);
          if (inspected.stream) {
            bodySource = inspected.stream;
            decision.reason = 'body_too_large';
          } else {
            body = inspected.body;
            if (res.writableEnded || res.destroyed) return;
            const routed = routeBody({ body, path, model, encodedContext: values.length === 1 ? values[0] : null, policy });
            ({ body, decision, context } = routed);
            length = body.length;
          }
        }
      }
      if (res.writableEnded || res.destroyed) return;
      upstreamRequest = http.request({ hostname: origin.hostname, port: origin.port || 80,
        path: req.url, method: req.method, agent,
        headers: forwardHeaders(req, { request: true, host: origin.host, length }) }, response => {
        upstreamResponse = response;
        if (res.destroyed || res.writableEnded) { response.destroy(); return; }
        res.writeHead(response.statusCode, forwardHeaders(response));
        res.flushHeaders();
        response.on('error', () => fail(502, 'upstream_disconnect'));
        response.on('aborted', () => fail(502, 'upstream_disconnect'));
        response.pipe(res);
      });
      upstreamRequest.setTimeout(idleMs, () => fail(504, 'idle_timeout'));
      upstreamRequest.on('error', () => fail(502, 'upstream_error'));
      if (body !== undefined) upstreamRequest.end(body);
      else {
        bodySource.on('error', () => fail(502, 'request_body_error'));
        bodySource.pipe(upstreamRequest);
      }
    }
    handle().catch(() => fail(502, 'request_error'));
  });
  // Explicitly outside the MVP's HTTP request/response contract.
  for (const event of ['upgrade', 'connect']) server.on(event, (_req, socket) => {
    socket.end('HTTP/1.1 501 Not Implemented\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  server.on('close', () => agent.destroy());
  return server;
}
