import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runNodeTestCheck } from './checkers/node-test.mjs';
import { validateContext } from './context.mjs';

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      cwd: { type: 'string', default: process.env.INIT_CWD || process.cwd() },
      'check-id': { type: 'string', default: 'node-tests' },
      id: { type: 'string', default: randomUUID() },
      resolves: { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log('npm run check:node -- [--cwd DIR] [--check-id ID] [--id ID] [--resolves FAILURE_ID] [--json] TEST_FILE ...');
  } else {
    const { cwd, id, resolves } = values;
    const checkId = values['check-id'];
    // Fail fast on invalid IDs before running project code.
    validateContext({
      v: 1, run_id: 'cli', call_id: 'check', seq: 1,
      observations: [{ id, check_id: checkId, outcome: 'success', ...(resolves === undefined ? {} : { resolves }) }],
    });
    const evidence = [];
    const files = positionals.map(file => resolve(cwd, file));
    const observation = await runNodeTestCheck({ files, cwd: resolve(cwd), checkId, id, resolves,
      onFailure: failure => evidence.push(failure) });
    if (values.json) {
      console.log(JSON.stringify({ observation, evidence }));
    } else {
      console.log(`${observation.outcome}: ${observation.check_id} (${observation.id})`);
      for (const item of evidence) {
        console.log(`  ${item.name} (${item.file}:${item.line})\n  ${item.message}`);
      }
    }
    process.exitCode = { success: 0, failure: 1, unknown: 2 }[observation.outcome];
  }
} catch (error) {
  console.error(`check:node: ${error.message}`);
  process.exitCode = 2;
}
