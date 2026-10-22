# Phase: console records — Play app, AdMob apps/units/GDPR row, App Store Connect app

You are the **only** phase with a browser: the Playwright MCP (`mcp__playwright__browser_*`) attached to the owner's own Chrome, which is logged in as **talnirapps@gmail.com** (Google consoles use `authuser=1`; the default account is MFA-blocked). You create the records the APIs can't (AdMob `apps.create` 403s, Play has no "create app" API, ASC can't create apps by API). You don't touch app code and you don't build. Read `{{DOCS_DIR}}/BUILD-GUIDE.md` §8, §10, §11 first, then invoke the `google-play-console`, `google-admob` and `appstore-connect` skills for the UI procedures.

Values come from facts and the repo: name `{{NAME}}` (fallbacks: `alt_names` in facts), package/bundle `{{BUNDLE}}`, SKU `{{SLUG}}`, privacy URL (facts `privacy_url`), the listing answers in `store/listing.md` (content rating, data safety, target audience, category) and `store/asc-privacy.json`. The Play service account is `revenuecat@pc-api-6335927988877413122-285.iam.gserviceaccount.com` (key `~/git/TransLex/secrets/play-service-account.json`).

**Idempotent:** check before creating anything. Play: `edits.insert` with the SA for `{{BUNDLE}}` (404 = no record or no grant). AdMob: list apps via the API (`~/google/admob`, see the google-admob skill) or the Apps page — reuse an existing `{{NAME}}` app and its units instead of making duplicates. ASC: `GET /v1/apps?filter[bundleId]={{BUNDLE}}` with key TU7KTA57MK. Whatever already exists, just record its ids.

## Browser discipline

- One Chrome extension relay serves every Claude session. If tabs die with "Target page, context or browser has been closed" every minute or two, other sessions' `@playwright/mcp --extension` servers are fighting for it: find yours via the parent chain (`pgrep -P <your claude pid>`), `kill -STOP` the **others'** `node …playwright…--extension` PIDs, do the work, and **always `kill -CONT` them before you finish** (also on failure). A single "closed" error after idle: retry once.
- Open your own tab; don't close or navigate the owner's tabs.
- If a console shows a login / account chooser / 2FA prompt instead of the app, don't type passwords: stop that store, put "log Chrome in to <console> as talnirapps@gmail.com" in `needs_you`, and carry on with the others.
- Accept only what this app needs: Play's developer declarations for creating the app (the owner approved this in the plan), App content answers from `store/listing.md`. **Never** submit for review, send changes for review, publish to any track, roll out production, change pricing to paid, accept new agreements/terms beyond the create-app declarations, or touch another app.

## 1. Google Play

1. Create app: name `{{NAME}}`, default language English (Canada) – en-CA (en-US if the card says US), App, Free, tick the two declarations → Create.
2. Users and permissions → the SA → App permissions → Add app → this app → tick **Release apps to testing tracks**, **Manage store presence**, **Edit and delete draft apps** (NOT Release to production — production stays manual) → Apply → Save changes → **Yes** on the confirm dialog. Reload and verify the grant stuck (the row count updates client-side even when unsaved). Prefer doing Add app → ticks → Apply → Save → Yes in one Playwright run-code call (`browser_run_code…`) if the relay is flaky. Checkboxes need real mouse clicks; verify `.checked`.
3. App content (Policy → App content): privacy policy URL; Ads = yes; App access (all functionality available without special access, unless the app needs a login — then the reviewer demo account from facts); Content rating (IARC questionnaire, email talnirapps@gmail.com, category per listing, answers per `store/listing.md`); Target audience **18+** (unless the card says otherwise); News no; Government no; Financial features none; Health none; Data safety per `store/listing.md` (third-party ads SDK: device or other IDs, approximate location, crash logs/diagnostics — collected and shared as the listing says; encrypted in transit; no deletion request unless the app has accounts). Save each.
4. Verify by API with the SA: `edits.insert` on `{{BUNDLE}}` returns an edit id (then `edits.delete` it). Facts: `play_app_created: true`, `play_sa_grant: "testing, store presence, draft apps"`, `play_app_content: "done"` (or what's left).

## 2. AdMob

1. Apps → Add app → Android, "not listed yet", name `{{NAME}}` → app id. Ad units: Banner `{{SLUG}}-android-banner`, Interstitial `{{SLUG}}-android-interstitial`, Rewarded `{{SLUG}}-android-rewarded`. Repeat for iOS (`{{SLUG}}-ios-…`). Only the formats the app uses if the card/repo says fewer (check `src/ads/`).
2. Privacy & messaging → European regulations → the existing GDPR message → Your apps (pencil) → for each new app: fill its privacy URL cell **first** (Save), then tick it → Confirm → **Publish** → confirm Publish in the dialog. Reload and re-read the app list: both apps must be in the message. (The picker renders in the main frame, the builder in the `messagedetail` frame.) If the US-states message exists and includes the fleet's apps, add the two apps there the same way.
3. Re-read the ids from the AdMob API or the console after creation. Write them to `{{REPO}}/secrets/admob_apps.json` and `admob_units.json` (mode 0400, gitignored — check `.gitignore`). Facts: `admob_android_app_id`, `admob_android_banner`, `admob_android_interstitial`, `admob_android_rewarded`, `admob_ios_app_id`, `admob_ios_banner`, `admob_ios_interstitial`, `admob_ios_rewarded`, `admob_gdpr: "published, N apps, verified after reload"`.

## 3. App Store Connect

Apps → "+" (a menu) → New App: iOS, name `{{NAME}}` (if taken, the fallbacks in order), primary language English (Canada), bundle `{{BUNDLE}}` (already registered), SKU `{{SLUG}}`, Full access → Create. Confirm by API and record `asc_app_id`. If the ASC login blocks you, that's a `needs_you`, not a failure of the phase.

## Result

- `ok` when Play (app + SA grant) and AdMob (8 ids + GDPR row) are done and verified — Android can proceed. ASC/app-content leftovers go in `needs_you` with exact steps (the iOS/stores phases block on them later).
- `blocked` when Play or AdMob couldn't be done (logged out, relay dead, a console change you can't get past): say exactly what the owner must do, with values, and what you finished.
- Note in `summary` every record you created and every declaration you accepted, so the owner can audit it from the phone.
