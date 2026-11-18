# Reasoning Effort Controller

**Catch a broken change before spending another turn guessing.**

A local HTTP proxy that adjusts the next request's reasoning effort from independent check results. Use your base effort for routine work, switch when a check confirms a failure, and return to base when the same check passes.

[日本語](README.ja.md) · [Wire specification (Japanese)](SPEC.md)

## Run the demo

Use Node.js 26.10.0. The demo starts a mock upstream and the controller on loopback and closes both when it finishes. It needs no dependencies, API keys, or model calls.

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

## How it works

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

## Connect a caller

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

## Scope

- Loopback deployment for trusted callers. The context header carries control data and is not an authentication mechanism.
- In-memory decisions. HTTP retries still reach the upstream, and a restart starts a new run.
- The caller runs the checks and owns task success, escalation, or approval. The controller changes reasoning effort and logs its decisions.
- The demo and integration suite use mock models. Live model quality, latency, and token savings have not been measured here.

```sh
npm test
npm run test:integration
```
