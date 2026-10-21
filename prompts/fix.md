# Fix round (same session as the phase)

A deterministic gate or a fresh reviewer found problems with your phase's work. Fix every item below properly (no `--no-verify`, no skipped tests, no deleting the failing test), re-run the gates until green, commit and push, then rewrite `{{RESULT_FILE}}` with the updated summary (status `ok` only if everything is truly fixed, otherwise `failed` and why). Don't start anything new.
