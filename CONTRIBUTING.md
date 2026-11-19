# Contribute to Test Feedback Loop

## Share an early-check recipe

[Open a recipe issue](https://github.com/onoderakosen89/test-feedback-loop/issues/new?template=early-check-recipe.yml). No test code or new tool is required. Describe the wrong behavior, the earliest point it could be checked, and what you would observe on pass or fail. If you don't know where to automate it, share what you can reproduce by hand.

For a machine-checkable version, use an existing tool where possible. Include the command or check, a failing example, a known-good control, and what makes the check inconclusive. Use synthetic data; don't include private logs, credentials, or customer information.

## Add a runner adapter

1. [Propose a check](https://github.com/onoderakosen89/test-feedback-loop/issues/new?template=check-adapter.yml). Show the runner and how it reports an assertion failure, a pass, and an incomplete or ambiguous run.
2. For an adapter PR, keep execution and classification on the caller side. Follow the [observation contract](SPEC.md) and use the existing [Node.js adapter](src/checkers/node-test.mjs) as a reference.
3. Add fixtures for a failing check, a matching successful recheck, and a run that fails to establish a result. Use the runner's structured output when available. An ambiguous result should leave the effort state unchanged.

Run `npm test`, `npm run test:integration`, and `npm run demo` with Node.js 24 or later. For changes to the pytest adapter, also run `npm run test:pytest` with pytest 9 installed in `python3`. Use local or synthetic examples that other contributors can run without a model account.
