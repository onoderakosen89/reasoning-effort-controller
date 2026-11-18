---
name: test-feedback-loop
description: Run a named Node.js regression check for a Codex or Claude Code repair. Use when you need evidence of what broke, a repeatable test before repair, or a check-driven change in reasoning effort.
---

# Test Feedback Loop

Use a project-owned regression test. Choose a stable check ID and use the same test files and check ID to verify the repair. Before running it, confirm that the project and its test code are trusted.

Use Node.js 26.10.0. From a checkout of [the controller](https://github.com/onoderakosen89/reasoning-effort-controller), run:

```sh
npm run check:node -- --cwd /path/to/project --check-id regression --id before path/to/regression.test.mjs
```

- Exit 1 means a confirmed assertion failure. Give the repair agent the test name, location, expectation, and observed result. Use the configured failure effort if another reasoning turn is needed.
- Exit 0 means a complete passing check. After repair, run the same command with a new observation ID and `--resolves before`. Return to base effort once all outstanding checks have been resolved.
- Exit 2 means the run did not establish a result. Diagnose why the check could not run before changing effort.

For a scripted caller, use `npm run --silent check:node -- --json` with the same test arguments and pass the record's `observation` field to `RunContext`. Keep `evidence` available for the next repair turn. To see the same loop with a separate native Codex or Claude Code session, use the project's README. In an already open desktop conversation, apply the effort through the app's built-in control.
