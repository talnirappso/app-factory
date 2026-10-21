#!/usr/bin/env bash
# Install + start the bridge as a systemd *user* service (survives reboots: `loginctl enable-linger $USER` must be on — it is on this host).
set -euo pipefail
cd "$(dirname "$0")/.."
test -s secrets/linear_api_key || { echo "secrets/linear_api_key missing (chmod 0400)"; exit 1; }
node bin/setup.mjs
mkdir -p ~/.config/systemd/user
cp infra/app-factory.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now app-factory.service
loginctl show-user "$USER" -p Linger | grep -q yes || echo "⚠ run: loginctl enable-linger $USER  (otherwise the service stops at logout)"
systemctl --user --no-pager status app-factory.service | head -5
