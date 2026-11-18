#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createRouter } from './proxy.mjs';

const serviceName = 'test-feedback-loop';

try {
  const { values } = parseArgs({ options: {
    upstream: { type: 'string' }, model: { type: 'string' },
    port: { type: 'string', default: '8318' },
    'base-effort': { type: 'string' }, 'failure-effort': { type: 'string' },
    'timeout-ms': { type: 'string', default: '120000' },
    'idle-ms': { type: 'string', default: '30000' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('test-feedback-loop --upstream http://127.0.0.1:8317 --model MODEL [--port 8318]\n'
      + '  [--base-effort low] [--failure-effort high] [--timeout-ms 120000] [--idle-ms 30000]');
  } else {
    if (!values.upstream || !values.model) throw new Error('--upstream and --model are required');
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be 1..65535');
    const server = createRouter({ upstream: values.upstream, model: values.model,
      baseEffort: values['base-effort'], failureEffort: values['failure-effort'],
      timeoutMs: Number(values['timeout-ms']), idleMs: Number(values['idle-ms']) });
    server.on('error', error => { console.error(`${serviceName}: ${error.code ?? 'startup_error'}`); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.error(`${serviceName}: listening on 127.0.0.1:${port}`));
    const stop = () => { server.close(); server.closeAllConnections(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }
} catch (error) {
  console.error(`${serviceName}: ${error.message}`);
  process.exitCode = 1;
}
