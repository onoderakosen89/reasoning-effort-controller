import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { RunContext } from '../src/adapter.mjs';
import { runRegressionCycle } from './regression-cycle.mjs';
import { CONTEXT_HEADER, decodeContext } from '../src/context.mjs';
import { Policy } from '../src/policy.mjs';

const { values } = parseArgs({ options: {
  'use-subscription': { type: 'boolean' },
  model: { type: 'string' },
} });
if (!values['use-subscription']) {
  throw new Error('Run with --use-subscription to make three calls using your local Claude Code sign-in');
}

const workspace = await mkdtemp(join(tmpdir(), 'effort-claude-demo-'));
const exec = promisify(execFile);
const env = { ...process.env };
// Use the installed CLI's own login and first-party endpoint.
for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_EFFORT_LEVEL']) {
  delete env[key];
}
async function invoke(args) {
  const command = exec(process.env.CLAUDE_BIN || 'claude', args, {
    cwd: workspace, env, timeout: 60_000,
  });
  command.child.stdin.end();
  const { stdout } = await command;
  return JSON.parse(stdout);
}

try {
  const account = await invoke(['auth', 'status']);
  if (!account.loggedIn || account.authMethod !== 'claude.ai' || account.apiProvider !== 'firstParty') {
    throw new Error('Sign in to the official Claude Code CLI with your own Claude account first');
  }
  const context = new RunContext();
  const policy = new Policy();
  let session;
  async function turn(label, observations, expected) {
    const decision = policy.decide(decodeContext(context.next(observations)[CONTEXT_HEADER]), label);
    assert.equal(decision.effort, expected);
    const result = await invoke([
      '-p', '--output-format', 'json', '--tools', '', '--setting-sources', '',
      '--strict-mcp-config', '--effort', decision.effort,
      ...(values.model ? ['--model', values.model] : []),
      ...(session ? ['--resume', session] : []),
      `${label}. Reply with OK only. Do not use tools.`,
    ]);
    if (result.is_error || result.subtype !== 'success' || !result.session_id) {
      throw new Error(`Claude Code did not complete the turn (${result.subtype ?? 'unknown'})`);
    }
    if (session) assert.equal(result.session_id, session);
    session = result.session_id;
    console.log(`${label}: ${decision.effort}`);
  }

  await runRegressionCycle(workspace, turn);
} finally {
  await rm(workspace, { recursive: true, force: true });
}
