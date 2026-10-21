# Phase: the product — the three core features, content, polish

Build the app the concept describes, to a quality you'd pay for: the 3 core features complete and useful on day one, real data (bundled offline where the concept says so; fetched with caching where it must be live), empty states, onboarding that explains the job in one screen, settings (units, reminders, data export/reset, the release check), accessibility basics, dark mode. Pure logic in RN-free modules with tests (date maths, calculations, schedules, parsers). If the concept includes a content bank (facts, rules, questions as a secondary tab), write `docs/content-facts.md` first and pin every fact to a source (PROMPT.md §3 method; a forbidden-terms test guards the bank).

Work in small commits. Keep `npm test && npx tsc --noEmit && npx expo export` green. Don't add dependencies beyond what the concept needs (prefer Expo modules). Write `docs/testing.md`: the manual test script for the device phase (every screen, every core flow, what "correct" looks like, including specific sample inputs and expected outputs).

Finish when: every core feature works end-to-end in `expo export`'s bundle, tests cover the logic, README describes the app honestly, tree clean and pushed. Facts: `features_done` (list), `test_count`, `content_items` (if any), `manual_test_doc`.
