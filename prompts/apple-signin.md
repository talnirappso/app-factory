# Signing Chrome in to App Store Connect (Apple ID)

Use this when appstoreconnect.apple.com shows Apple's sign-in page instead of the app list. The owner approved the agent signing in by itself (2026-10-22).

1. Credentials: `node -e 'const j=require(process.env.HOME+"/git/app-factory/secrets/apple_login.json");console.log(j.apple_id)'` for the Apple ID; read the password the same way **only inside the tool call that types it** — never print it, write it to a file, log it, or put it in a summary, comment or result. If the file is missing: stop and report "run `~/git/app-factory/bin/set-apple-login.sh` once" as `needs_you`.
2. The form is in Apple's iframe (`#aid-auth-widget-iFrame`, `idmsa.apple.com`). Type the Apple ID → Continue (→) → choose "Continue with Password" if offered → type the password → Sign In. Never tick or untick anything else; never click "Forgot", "Create", "Use passkey" or anything that changes the account.
3. **Two-factor code:** if Apple asks for a 6-digit code, run `node ~/git/app-factory/bin/apple-2fa-code.mjs {{CODE_ISSUE_ARG}}` (it posts to Slack + Linear and waits up to 15 min for the owner to reply with the code; prints it on stdout, exit 1 on timeout). Type the code into the six boxes. On timeout: `needs_you` "reply with the Apple code next time, or sign Chrome in to App Store Connect", and stop.
4. **Trust this browser:** if asked "Trust this browser?", click **Trust** — that's what keeps the session ~30 days without new codes.
5. Done when the ASC Apps page loads. If Apple shows anything else (account locked, password wrong, "verify your identity" by other means, new terms to accept), don't try to get past it: stop and report it word for word in `needs_you`.
