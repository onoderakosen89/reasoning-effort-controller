---
name: test-feedback-loop
description: Run fast independent checks for bounded implementation work. Use when handing a Codex or Claude Code repair to a smaller or low-effort model with concrete failure evidence and a repeatable recheck.
---

# Test Feedback Loop

Use a project-owned regression test. Choose a stable check ID and use the same test files and check ID to verify the repair. Before running it, confirm that the project and its test code are trusted.

Use Node.js 26.10.0. From a checkout of [the controller](https://github.com/onoderakosen89/reasoning-effort-controller), run:

```sh
npm run check:node -- --cwd /path/to/project --check-id regression --id before path/to/regression.test.mjs
# For an existing pytest suite, use the project's interpreter.
npm run check:pytest -- --cwd /path/to/project --python /path/to/venv/bin/python --check-id regression --id before tests/test_regression.py
```

- Exit 1 means a confirmed assertion failure. Give the repair agent the test name, location, expectation, and observed result. Start with low effort when the repair is well scoped.
- Exit 0 means a complete passing check. After repair, run the same command with a new observation ID and `--resolves before`. Include a passing control when the repair could affect nearby behavior.
- Exit 2 means the run did not establish a result. Investigate the check before asking for another code change.

For a scripted caller, use `npm run --silent check:node -- --json` with the same test arguments. Keep `evidence` available for the next repair turn. If you use the optional effort controller, pass the `observation` field to `RunContext`. Stop and review the evidence before another repair if the next change would be a guess.
