#!/usr/bin/env bash
# Pull the latest code and restart the backend. Run on the server as the
# `indicator` user's sudoer:  bash /opt/indicator/deploy/update-backend.sh
set -euo pipefail
cd /opt/indicator

sudo -u indicator git pull --ff-only
sudo -u indicator backend/.venv/bin/pip install -q -r backend/requirements.txt
# Fyers SDK without its pinned dependencies (see backend/requirements.txt).
sudo -u indicator backend/.venv/bin/pip install -q --no-deps fyers-apiv3==3.1.19
sudo systemctl restart indicator
sleep 3
systemctl --no-pager --lines=5 status indicator
curl -fsS http://127.0.0.1:8000/api/health && echo
