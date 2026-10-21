# app-factory

A Linear board that runs a one-person app studio: nightly scouts post **idea cards**, you discuss them from your phone, and moving a card to **Implement** builds the app unattended — fresh Expo project, tests, a run on the real Android phone, iOS via the self-hosted Mac, listings, and submission to the App Store and Google Play. A second board hands bugs/features for the live apps to their nightly agents.

Zero npm dependencies. Node ≥ 22. Runs as a systemd **user** service on the home box (`infra/install.sh`), so it survives reboots.

## The boards

### `PUC` — New apps

| State | Who moves it | What happens |
|---|---|---|
| **Ideation** | the bridge (scouts) or you | Every strong/moderate finding of the Reddit pain scout, the store-gap scout and the ranked queue in `new-app-docs/IDEAS.md` becomes a card with the full template (below). Ideas you type yourself get the same treatment. Comment → Claude answers. |
| **Research** | you | A ~1 h headless research pass (both stores, demand, name/trademark, sources, the 4.3(a) concept test). Scorecard is appended to the card; it goes back to **Ideation** with the `researched` label, or to **Parked** on a kill. |
| **Implement** | you | **This is your approval to ship.** The pipeline runs: research → scaffold → features → review → assets → Android (incl. the OnePlus 6 test) → iOS → store listings → submit. Each phase posts a comment. |
| **Building** | the bridge | Pipeline running. Move a card here from **Needs you** to resume. |
| **Needs you** | the pipeline | Paused on something only you can do (console-only steps: ASC app record, Play app record + content declarations, AdMob apps/units) or decide (a kill verdict, a store rejection). Read the last comment, answer in the thread (ids, "done", "go anyway"), then move back to **Building**. |
| **Store review** | the pipeline | Submitted. Checked every 30 min; → **Live** when both stores are live, → **Needs you** on a rejection. |
| **Live** / **Parked** | | |

### `APP` — Apps & tasks

Two kinds of issue, one board (Linear's free plan allows two teams):

- **App request** — a Bug / Feature / question with an app label (`keytora`, `translex`, `mathworks`). **Inbox** → Claude replies. **Ready** → written to that app's nightly-agent `data/requests.json`; the agent (keytora 03:00, TransLex 04:00, MathWorks Sun 05:00) does it first that night with its usual gates/review/deploy and reports `requests_done` / `requests_blocked` → **Done** or **Needs you** with the agent's reason. Add the label `now` to skip the nightly path.
- **Task** — anything else ("set up a nightly workflow for Sunroll like keytora's", "audit app-ads.txt across the fleet", "write the Sunveya listing"). **Inbox** → Claude reads the relevant repos/docs (read-only) and posts a plan, risks, questions and an estimate. **Ready** → `bin/task.mjs` runs it as an unattended agent on the home box (full tools, $60 / 3 h caps, hard limits: no store submissions, no deletions, no spending) → **Done**, or **Needs you** with the exact ask; answer and move back to **Running** to resume the same session.

## The idea-card template

Proposed app name (≤30 chars, store rules) + alternates · generated logo concept · tagline · what it is · the pain · who it's for · the opportunity · demand evidence with sources · 3 core non-quiz features · competitors table (store, traction, their gap) · platforms · tech stack (Expo SDK 56 + …) · monetization + an honest revenue guess · build size · risks · open questions · verdict (`build` / `research first` / `park` / `kill`) · next step. The raw scout finding is kept in a collapsed section. Schema: `lib/card.mjs`; prompt: `prompts/enrich.md`.

## How it works

- `bin/bridge.mjs` — the loop (every 60 s): `syncIdeas` (scout state files → cards via one Claude "enrich" call + a Pollinations/monogram logo uploaded to Linear), `pollIssues` (new issues, state moves), `pollComments` (reply with Claude; actions: move, update card, set title, record facts, resume), `pollPipelines` (restart dead units, watch store review), `pollNightlyResults` (apps board).
- `bin/pipeline.mjs <issueId>` — one app: phases in `prompts/*.md`, each a headless `claude -p` (Opus 5.5, high, full tools, no prompts) in its own session with budget + timeout, a result file contract (`ok | blocked | failed | kill`, summary, facts, needs_you), deterministic gates after code phases (`npm test`, `tsc`, `expo export`, forbidden strings, clean + pushed), one fix round per failure, an independent read-only review phase. Launched as a transient unit `app-factory-puc-N` with `systemd-run`, so it outlives the bridge. State in `data/pipelines/PUC-N/`.
- Owner answers on the board become **facts** (`facts.json`) that later phases read: AdMob ids, "ASC record created", "go anyway", etc.
- Console-only steps (the APIs 403 for app-record and ad-unit creation) are posted as a checklist as soon as the name is fixed, so you can do them on your phone while the build continues; the pipeline blocks only when it actually needs their output.

## Commands

```bash
npm run setup      # make the boards' workflows/labels match config/factory.json (idempotent)
npm run dry        # one tick, no writes, no Claude
npm run once       # one real tick
npm test
node bin/store-search.mjs "ontario fishing regulations" --country=ca   # what the research phase uses
node bin/pipeline.mjs <issueId> --only=research                        # by hand
journalctl --user -u app-factory -f                                    # the bridge
journalctl --user -u app-factory-puc-7 -f                              # one build
```

## Setup

1. Personal API key in Linear (Settings → Security & access → Personal API keys) → `secrets/linear_api_key` (chmod 0400). Slack webhook (optional) → `secrets/slack_webhook_url`.
2. `config/factory.json`: team keys, states, scouts' state files, Claude model/budgets, device serial, nightly-agent data dirs.
3. `infra/install.sh` (needs `loginctl enable-linger`).

## Costs and limits

Enrich ≈ $1–4 per card; a reply ≈ $0.5–3; research ≈ $10–25; a full build $150–400 (cap in config) and several hours (local Android builds ≈ 25 min each, iOS on the Mac ≈ 30 min). Linear API: ~3 calls per tick.

## Not automated (by design or by API limits)

Creating the ASC app record, the Play app record and its content declarations, AdMob apps/units/GDPR row, and Play "Release to production" for a service account without the grant. The pipeline tells you exactly what to type and waits.
