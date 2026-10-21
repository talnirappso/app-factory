#!/usr/bin/env bash
set -euo pipefail
systemctl --user disable --now app-factory.service || true
rm -f ~/.config/systemd/user/app-factory.service
systemctl --user daemon-reload
echo "removed (data/ and secrets/ kept)"
