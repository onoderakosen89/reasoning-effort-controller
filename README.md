# Test Feedback Loop

**Build on Low. Catch mistakes while they’re still cheap to fix.**

Use your coding agent’s Low setting for small implementation steps and repairs. After each step, run the earliest check that can decide whether the behavior is right, separately from the agent’s own judgment. Feed back the evidence, not a request to “try harder.” If the check can’t decide, stop and find out why.

Say your app claims it saved a note, but the note disappears on reload. You don’t need to wait for the whole screen: test save → read at the storage or API boundary, as soon as that code exists. Keep a working edit case as a control. Later, use a browser check for the parts only the screen can prove.

[日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [Agent Skill](skills/test-feedback-loop/SKILL.md)

**Building with AI, not writing tests?** [Describe the behavior and the earliest way to check it](#share-an-early-check-recipe). No code required. **Integrating a check?** [Try the demo](#try-the-complete-repair-loop) or [run it on your project](#check-your-own-project).

## Try the complete repair loop

Use Node.js 24 or later. Both demos run without a model account or API key.

```sh
git clone https://github.com/onoderakosen89/test-feedback-loop.git
cd test-feedback-loop
npm run --silent demo:repair
```

The demo reproduces a failure, hands the assertion evidence to a scripted repair, and independently reruns the regression and its normal control. To see what happens when two repairs fail, run:

```sh
npm run --silent demo:repair -- --show-stop
```

This exits with code 1 and returns a `consultation` object with both attempts, the final difference, the latest evidence, and the premise to check. An inconclusive run exits with code 2. The caller can display or route the consultation.

Run `npm run --silent demo:repair -- --chatgpt` to have Codex apply the fix at fixed Low using your ChatGPT sign-in. The demo uses a disposable checkout-free fixture. A follow-up appends only the new check result to the same Codex session. Reported usage includes cached input when Codex supplies it. The [runRepairLoop API](src/repair-loop.mjs) defaults to two repair attempts. Callers can set `maxRepairs` to a positive integer.

## The workflow

1. **Reproduce.** Run a small check against the behavior you expect, with a normal case to check for regressions.
2. **Make one bounded change.** Give Codex or Claude Code the failed check, what you expected, and what happened. Low effort is a starting point for a repair this well scoped.
3. **Verify.** Rerun the same check and the normal case. If the result stays inconclusive or the next repair would be guesswork, keep the evidence and stop to review the cause.

In one trial of a historical message-delivery bug, GPT-6.1 Terra and GPT-6.2 Sol both repaired the targeted failure and preserved the normal case at fixed Low and High. Each model ran once per setting.

| Model | Low | High |
| --- | --- | --- |
| GPT-6.1 Terra | 45 s, 1,677 output tokens, 10/15 broader checks | 67 s, 2,694 output tokens, 10/15 |
| GPT-6.2 Sol | 94 s, 3,137 output tokens, 11/15 broader checks | 141 s, 5,347 output tokens, 10/15 |

**In this one repair, fixed Low took about 33% less time and used 38–41% fewer output tokens than fixed High.** Both models met the targeted check at both settings. See the [full results and limits](docs/implementation-evaluation.md) for input and cached tokens and the checks that stayed unresolved.

## Check your own project

Run the check command directly on your own tests. To hand failures to a repair agent automatically, connect your caller to [runRepairLoop](src/repair-loop.mjs). Point the check at a trusted Node.js test file:

```sh
npm run check:node -- --cwd /path/to/project --check-id regression --id before test/regression.test.mjs
```

The output leads with the check result, followed by the failing assertion and its location if available. After a repair, use the same files and check ID, plus `--id after --resolves before`.

| Exit code | Meaning |
| --- | --- |
| 0 | The check passed |
| 1 | An assertion failure was confirmed |
| 2 | The check was inconclusive or could not run |

An inconclusive check prints a reason when available. For machine-readable output, run `npm run --silent check:node -- --json` with your test arguments. Pass `observation` to `RunContext` and keep `evidence` for the repair agent. The check command makes no model calls.

For a Python project, use an interpreter with pytest installed:

```sh
npm run check:pytest -- --cwd /path/to/project --python /path/to/venv/bin/python --check-id regression --id before tests/test_regression.py
```

An assertion failure in the test body produces evidence. Collection and setup failures produce an unknown result.

To run the checker from other projects, run `npm link` in this checkout. Then run `tfl-check --help` from your project. For a Python test, use `tfl-check --runner pytest --python /path/to/venv/bin/python tests/test_regression.py`. The link also installs the optional proxy command `test-feedback-loop`.

## Share an early-check recipe

A recipe tells others **what can go wrong, when it can first be detected, and what counts as pass or fail**. The human-readable version is enough to contribute. If you have a repeatable automated version, add the runner, command, and what should be reported as inconclusive.

| Layer | Example: a saved note disappears |
| --- | --- |
| Behavior, no code needed | Create a note, save it, then reload. The saved text must still be there. Editing an existing note must still work. |
| First machine-checkable point | When the storage or API boundary exists, write a note and read it back using a fresh client. Assert the exact saved value. Add a separate UI check when the screen exists. If the runner cannot reach storage, report inconclusive, not a failed behavior check. |

[Share a recipe (no code required)](https://github.com/onoderakosen89/test-feedback-loop/issues/new?template=early-check-recipe.yml) · [Propose a runner adapter](https://github.com/onoderakosen89/test-feedback-loop/issues/new?template=check-adapter.yml) · [Contribution guide](CONTRIBUTING.md)

Use existing tools first. Node.js and pytest checkers are bundled; a recipe can use another existing tool without adding a new adapter.

## Optional effort switching

The check and repair workflow works with a fixed effort. For experiments with automatic effort switching, the repository includes a local HTTP controller and examples that call the native Codex and Claude Code interfaces. [Wire specification (Japanese)](SPEC.md)

### Run the switching demo

Use Node.js 24 or later. The demo starts a mock upstream and the controller on loopback and closes both when it finishes. It needs no dependencies, API keys, or model calls.

```sh
npm run demo
```

```text
Initial call: low
Verified failure: high
Matching check passed: low
```

The demo runs a real Node.js assertion against a temporary implementation, changes the implementation, and runs the same assertion again. The mock upstream reports the effort it received after each check.

### Use Codex without the HTTP proxy

With Codex CLI installed, run `npm run demo:codex`. This starts Codex App Server with a loopback mock and verifies that three turns in one thread send `low → high → low` upstream. It uses the same checker and policy as the HTTP demo.

To try with your existing ChatGPT sign-in, run `npm run demo:codex -- --chatgpt`. This makes three short model calls against your Codex plan in a temporary read-only workspace. Add `--model MODEL_ID` if your plan offers a different model. The example checks the account mode before starting the three turns. It creates its own App Server session. [Codex App Server](https://developers.openai.com/codex/app-server)

### Use the official Claude Code CLI

With Claude Code installed and signed in through its own sign-in flow, run `npm run demo:claude -- --use-subscription`. It makes three short calls in one Claude Code session, setting `--effort` and resuming that session for each follow-up. It uses the same independent check and policy. Claude Code handles all authentication and model calls. [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference) · [Anthropic's authentication guidance](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)

### Desktop sessions

In an open desktop conversation, you can run the project check and manually choose the next effort with the app's built-in control. The automatic examples above own their respective sessions. [Codex desktop model control](https://learn.chatgpt.com/docs/models?surface=app) · [Claude Desktop effort menu](https://code.claude.com/docs/en/desktop)

### How the controller switches

1. The caller starts a run at the configured **base effort** (default: `low`).
2. After an independent check finds a failure attributable to reasoning or generated output, the caller attaches that result to the next request. The controller uses the configured **failure effort** (default: `high`) while a classified failure remains unresolved.
3. When the same check passes, the caller references the original failure. Effort returns to the base level after all outstanding failures have been resolved.

Permission, approval, quota, and transport failures do not raise effort. The controller treats requests without valid context as passthrough. It leaves the contents of model messages, tools, and unrelated request fields intact.

```mermaid
flowchart LR
    Base["Base effort"] --> Check["Run an independent check"]
    Check -->|Verified failure| Retry["Failure effort"]
    Retry --> Recheck["Run the same check"]
    Recheck -->|Pass| Base
    Check -->|Inconclusive| Keep["Keep current effort"]
    Recheck -->|Still unresolved| Retry
```

### Connect a caller

```sh
npm start -- --upstream http://127.0.0.1:8317 --model YOUR_MODEL_ID --port 8318
```

Use `http://127.0.0.1:8318/v1` as the caller's API base URL. The upstream must be an HTTP server listening on IPv4 loopback. The controller supports OpenAI-compatible `/v1/chat/completions` and `/v1/responses` requests. The upstream must support the requested effort values.

Set the two levels at startup:

| Sequence | Options |
| --- | --- |
| High → Low → High | `--base-effort high --failure-effort low` |
| Low → XHigh → Low | `--base-effort low --failure-effort xhigh` |

Accepted values are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max` (case-insensitive). Choose levels your upstream model supports. The options change the values sent at each state while keeping the same switching conditions.

Use `RunContext` from `src/adapter.mjs` to add the `X-Effort-Context` header:

```js
import { RunContext } from './src/adapter.mjs';

const run = new RunContext();
const initialHeaders = run.next();
const repairHeaders = run.next([
  { id: 'failure-1', check_id: 'regression', outcome: 'failure', category: 'reasoning' },
]);
const recheckHeaders = run.next([
  { id: 'pass-1', check_id: 'regression', outcome: 'success', resolves: 'failure-1' },
]);
```

Send these on successive logical calls, alongside your normal request headers. Link an observation to the call that follows the check. On an HTTP retry, reuse that call's exact headers and body. Use a separate run for unrelated work and keep calls within each run in order. Give capability probes and other auxiliary requests their own context or send them without the control header.

### Bundled Node.js check

Use `runNodeTestCheck` after an edit to run an explicit set of trusted test files:

```js
import { runNodeTestCheck } from './src/checkers/node-test.mjs';

const check = { files: ['./test/regression.test.mjs'], checkId: 'regression' };
const observation = await runNodeTestCheck({ ...check, id: 'check-1' });
const nextHeaders = run.next([observation]);
```

For a recheck, use the same files and check ID, a new observation ID, and `resolves` set to the original failure ID. The adapter classifies assertion failures from structured runner events. An incomplete run or an unclassified error does not change the effort state.

## License

[MIT](LICENSE)

## Scope

- Loopback deployment for trusted callers. The context header carries control data and is not an authentication mechanism.
- In-memory decisions. HTTP retries still reach the upstream, and a restart starts a new run.
- The caller runs the checks and owns task success, escalation, or approval. The controller changes reasoning effort and logs its decisions.
- The HTTP demo and integration suite use mock models. See the [implementation evaluation](docs/implementation-evaluation.md) for a separate model trial.

```sh
npm test
npm run test:integration
```
