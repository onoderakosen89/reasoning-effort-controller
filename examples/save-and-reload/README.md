# Check whether a note stays saved

This example has two independent checks. The storage check proves that a helper can write and read a file. The workflow check proves that the application reads back the same note after a fresh start. A passing storage check and a visible “Saved” message can both occur while the workflow loses the note.

## Try it in a browser

From the repository root, start the example in its broken mode. It listens on your computer only.

```sh
data=$(mktemp -d)
node examples/save-and-reload/app.mjs --data "$data" --port 0 --miswired
```

1. Open the URL printed by the command. Enter a note and click **Save**. The page says **Saved**.
2. Open the same URL in a fresh tab. The note is missing.
3. Stop the server with Ctrl+C, then run the same command without `--miswired`. Open the newly printed URL, enter a note, save it, and open the URL in a fresh tab. The note is present.
4. Edit the note, save it, and restart the fixed server with the same data directory. Open the new URL and check that it shows the edited text.

## Run the checks

```sh
npm run --silent check:node -- --id storage examples/save-and-reload/storage.test.mjs
TFL_DEMO_MISWIRED=1 npm run --silent check:node -- --id before examples/save-and-reload/workflow.test.mjs
npm run --silent check:node -- --id after --resolves before examples/save-and-reload/workflow.test.mjs
```

The storage check exits 0. The miswired workflow exits 1 even though the actual HTTP response says “Saved.” The fixed workflow exits 0 and covers both a new note and an edit of an existing note. Each workflow case posts to the form endpoint, starts a fresh application process using the same directory, and checks the HTML returned by GET.

If the final check cannot run, report the result as unverified. For example, running the checker against a missing workflow test returns exit 2. If the test runs and the application cannot start, the workflow raises an execution error and the checker also returns an inconclusive result.

To use this recipe in your own project, identify the entry point for saving and the entry point for reopening. Check that the reopened content exactly matches what you saved, then repeat with an existing record. Keep the low-level storage check for localizing failures and use the workflow check as evidence that the pieces work together.
