#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runNodeTestCheck } from './checkers/node-test.mjs';
import { runPytestCheck } from './checkers/pytest.mjs';
import { validateContext } from './context.mjs';

const reasonText = {
  collection_failed: 'Pytest could not collect the tests. Check test imports and run python -m pytest with the same interpreter.',
  incomplete_run: 'The runner did not report a complete result.',
  invalid_test_selection: 'Check the pytest file paths and test arguments.',
  output_limit: 'The test runner exceeded its output limit. Reduce test output and rerun.',
  no_tests: 'The runner did not find runnable tests.',
  pytest_missing: 'Install pytest in the interpreter selected with --python.',
  pytest_report_unavailable: 'Pytest did not produce a report. Run python -m pytest with the same interpreter.',
  python_launch_failed: 'Check that --python points to an executable Python interpreter.',
  skipped_tests: 'The run contains skipped or deferred tests.',
  syntax_input_unavailable: 'A --syntax path does not name an accessible regular file. Check the paths relative to --cwd.',
  syntax_runner_unavailable: 'Could not start Node for the syntax check. Check the Node executable and --cwd.',
  syntax_timeout: 'Node did not finish checking the selected source files within the time limit.',
  syntax_output_limit: 'Node exceeded the syntax check output limit.',
  syntax_inconclusive: 'Node did not report a recognizable parser diagnostic. Run node --check FILE directly to inspect the error.',
  test_error: 'The runner reported an error outside a confirmed assertion failure. Run it directly to inspect the error.',
  test_timeout: 'The test run exceeded its time limit.',
};

let commandName = 'tfl-check';
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      cwd: { type: 'string', default: process.env.INIT_CWD || process.cwd() },
      runner: { type: 'string', default: 'node' },
      python: { type: 'string', default: 'python3' },
      syntax: { type: 'string', multiple: true },
      'check-id': { type: 'string' },
      id: { type: 'string', default: randomUUID() },
      resolves: { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (!['node', 'pytest'].includes(values.runner)) throw new TypeError('Choose node or pytest');
  commandName = `check:${values.runner}`;
  if (values.help) {
    console.log('tfl-check [--runner node|pytest] [--cwd DIR] [--check-id ID] [--id ID] [--resolves FAILURE_ID] [--json] TEST_FILE ...');
    console.log('For Node, repeat --syntax FILE to check source syntax before running the tests. Paths are relative to --cwd.');
    console.log('For pytest, select the interpreter with --python BIN.');
  } else {
    if (values.syntax && values.runner !== 'node') throw new TypeError('--syntax requires --runner node');
    const { cwd, id, resolves } = values;
    const runner = { node: runNodeTestCheck, pytest: runPytestCheck }[values.runner];
    const checkId = values['check-id'] ?? `${values.runner}-tests`;
    // Fail fast on invalid IDs before running project code.
    validateContext({
      v: 1, run_id: 'cli', call_id: 'check', seq: 1,
      observations: [{ id, check_id: checkId, outcome: 'success', ...(resolves === undefined ? {} : { resolves }) }],
    });
    const evidence = [];
    let reason;
    const files = positionals.map(file => resolve(cwd, file));
    const observation = await runner({ files, cwd: resolve(cwd), python: values.python, checkId, id, resolves,
      syntaxFiles: values.syntax,
      onFailure: failure => evidence.push(failure), onUnknown: value => { reason = value; } });
    if (values.json) {
      console.log(JSON.stringify({ observation, evidence, ...(reason && { reason }) }));
    } else {
      console.log(`${observation.outcome}: ${observation.check_id} (${observation.id})`);
      if (reason) console.log(`  ${reasonText[reason]}`);
      for (const item of evidence) {
        console.log(`  ${item.name} (${item.file}${item.line === undefined ? '' : `:${item.line}`})\n  ${item.message}`);
      }
    }
    process.exitCode = { success: 0, failure: 1, unknown: 2 }[observation.outcome];
  }
} catch (error) {
  console.error(`${commandName}: ${error.message}`);
  process.exitCode = 2;
}
