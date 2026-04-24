# Project-Specific Rules

## Harness deployment — MANDATORY after every edit to runner/ files

The `runner/` directory holds the **source**. The app at runtime executes the **installed copies** at `~/.mongomacapp/runner/`. Editing source files has no effect on the running app until you deploy them.

**After any change to a `runner/*.js` file, immediately run:**

```bash
cp runner/harness.js ~/.mongomacapp/runner/harness.js
cp runner/query-classifier.js ~/.mongomacapp/runner/query-classifier.js
```

(Copy whichever files you changed — they all live alongside `harness.js` in the installed dir.)

Never claim a harness fix is complete without running this command. Verify with the CLI runner (`runner/cli.js`) before testing in the UI.
