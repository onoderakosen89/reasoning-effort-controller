# Contribute an independent check

Share checks that catch a specific broken behavior and can verify the repair with the same input. A small reproducible example is enough to start a discussion.

1. [Propose a check](https://github.com/onoderakosen89/reasoning-effort-controller/issues/new?template=check-adapter.yml). Show the runner and how it reports an assertion failure, a pass, and an incomplete or ambiguous run.
2. For an adapter PR, keep execution and classification on the caller side. Follow the [observation contract](SPEC.md) and use the existing [Node.js adapter](src/checkers/node-test.mjs) as a reference.
3. Add fixtures for a failing check, a matching successful recheck, and a run that fails to establish a result. Use the runner's structured output when available. An ambiguous result should leave the effort state unchanged.

Run `npm test`, `npm run test:integration`, and `npm run demo` with Node.js 26.10.0. For changes to the pytest adapter, also run `npm run test:pytest` with pytest 9 installed in `python3`. Use local or synthetic examples that other contributors can run without a model account.
