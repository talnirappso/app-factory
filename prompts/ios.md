# Phase: iOS — credentials, TestFlight build, ad-id verification

1. EAS iOS credentials on fleet cert TA6WLT74FK via the `eas-ios-credentials-headless` skill (if the scaffold phase already did it, verify). Register the bundle id if needed.
2. Check the ASC app record: `GET /v1/apps?filter[bundleId]={{BUNDLE}}` with the key at `~/apple/TU7KTA57MK` (foodprep's `scripts/asc.py` pattern). Missing → `blocked`, `blocked_on` = "Create the ASC record: name `{{NAME}}` …, bundle `{{BUNDLE}}`, SKU `{{SLUG}}`" (the altool upload needs it). Record `asc_app_id`.
3. Put the iOS AdMob app id in app.json and the 3 iOS unit ids in the repo secrets `EXPO_PUBLIC_IOS_{BANNER,INTERSTITIAL,REWARDED}_AD_ID` (`gh secret set`) and the EAS env. Commit, push.
4. `gh workflow run ios-deploy.yml -R talnirappso/{{SLUG}} -f submit=true` (self-hosted Mac). Poll `gh run list/watch` (≈20–40 min). Download the ipa artifact, `~/git/common/scripts/verify-ad-ids.sh <ipa> 3` must pass. Then wait for the build to be VALID in ASC (`asc.py wait-build` in `~/git/common/nightly-agent/scripts/`, `--version 1.0.0`); add it to the Internal beta group; `usesNonExemptEncryption` pre-declared via app.json.
5. Sweep the prebuilt Info.plist (from the workflow logs or `npx expo prebuild --platform ios --no-install` locally into /tmp) for `UIBackgroundModes` and the ATT string.

Facts: `asc_app_id`, `ios_build` (number), `ios_version` (`1.0.0`), `testflight` (ready/not), `ipa_ad_ids_verified`.
