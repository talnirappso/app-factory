#!/usr/bin/env bash
# Store the Apple ID the console phase / keepalive use to sign Chrome in to App Store Connect.
# Run it yourself in a terminal (the password is read silently and never printed).
set -euo pipefail
f="$(dirname "$0")/../secrets/apple_login.json"
read -rp "Apple ID (email): " id
read -rsp "Password: " pw; echo
umask 077; rm -f "$f"
node -e 'process.stdout.write(JSON.stringify({ apple_id: process.argv[1], password: process.argv[2] }))' "$id" "$pw" > "$f"
chmod 0400 "$f"; echo "saved $f (0400)"
