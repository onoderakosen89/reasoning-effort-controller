import http from 'node:http';
import { once, EventEmitter } from 'node:events';
import { createRouter } from '../src/proxy.mjs';

export async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening'); // EPERM is a failure, never a skipped success.
  return `http://127.0.0.1:${server.address().port}`;
}

export async function close(server) {
  if (!server.listening) return;
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections();
  await closed;
}

export async function readBody(req) {
  const parts = [];
  for await (const part of req) parts.push(part);
  return Buffer.concat(parts);
}

export function request(origin, { path = '/v1/chat/completions', method = 'POST', body = '', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${origin}${path}`, { method, agent: false,
      headers: { 'content-type': 'application/json', ...headers } }, res => {
      const parts = [];
      res.on('data', chunk => parts.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}

export async function fixture(t, handler, options = {}) {
  const logs = [];
  const logEvents = new EventEmitter();
  const captures = [];
  const fake = http.createServer((req, res) => {
    Promise.resolve(handler(req, res, captures)).catch(() => res.destroy());
  });
  t.after(() => close(fake));
  const upstream = await listen(fake);
  const router = createRouter({ upstream, model: 'fixed-model', log: row => {
    logs.push(row);
    logEvents.emit('record', row);
  }, ...options });
  t.after(() => close(router));
  const origin = await listen(router);
  const waitForLog = predicate => {
    const existing = logs.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const onRecord = row => {
        if (!predicate(row)) return;
        clearTimeout(timer);
        logEvents.off('record', onRecord);
        resolve(row);
      };
      const timer = setTimeout(() => {
        logEvents.off('record', onRecord);
        reject(new Error(`expected transport log not emitted: ${JSON.stringify(logs)}`));
      }, 1000);
      logEvents.on('record', onRecord);
    });
  };
  return { origin, upstream, router, fake, logs, captures, waitForLog };
}

export async function echo(req, res, captures) {
  const body = await readBody(req);
  captures.push({ body, headers: req.headers, url: req.url, method: req.method });
  res.writeHead(200, { 'content-type': 'application/json', 'x-future-response': 'kept',
    'set-cookie': ['a=1', 'b=2'] });
  res.end(body);
}

export const failure = (id = 'failure', check_id = 'suite', category = 'reasoning') =>
  ({ id, check_id, outcome: 'failure', category });
