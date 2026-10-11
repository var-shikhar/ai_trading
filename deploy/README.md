# Deploying to a VPS (one domain, Caddy)

Everything runs on the VPS behind the Caddy you already have:

```
browser ──https://trade.example.in──> Caddy
                                        ├─ /api/*  (+ /api/live WebSocket) → backend 127.0.0.1:8000 (systemd)
                                        └─ everything else → /var/www/indicator (built frontend)
```

Replace `trade.example.in` with your domain and `deploy@SERVER` with your SSH
login everywhere below. Written for Ubuntu 22.04/24.04 with Caddy installed.

## One-time setup (on the server)

**1. Swap** (safety net for memory peaks on a 1 GB server):

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/deploy/setup-swap.sh)"
# or after cloning (step 3): sudo bash /opt/indicator/deploy/setup-swap.sh
```

**2. Packages.** The backend needs **Python 3.11+** (Ubuntu 24.04 ships 3.12;
on 22.04 install `python3.12` from the deadsnakes PPA and use it below).

```bash
sudo apt update && sudo apt install -y git python3-venv python3-pip curl
python3 --version
```

**3. App user and code.** A dedicated `indicator` user runs the backend.

```bash
sudo useradd --system --home-dir /opt/indicator --shell /usr/sbin/nologin indicator
sudo git clone https://github.com/<you>/<repo>.git /opt/indicator
sudo chown -R indicator:indicator /opt/indicator
```

(Private repo: use a GitHub deploy key or a fine-grained token for the clone.)

**4. Python environment.**

```bash
cd /opt/indicator/backend
sudo -u indicator python3 -m venv .venv
sudo -u indicator .venv/bin/pip install -r requirements.txt
sudo -u indicator .venv/bin/pip install --no-deps fyers-apiv3==3.1.19
sudo -u indicator mkdir -p data
```

**5. Settings.** Copy the example and edit it:

```bash
sudo -u indicator cp .env.example .env
sudo -u indicator nano .env
```

Set at least:

```
HOST=127.0.0.1
PORT=8000
COOKIE_SECURE=true
TRUST_PROXY=true
CORS_ORIGINS=["https://trade.example.in"]
FRONTEND_URL=https://trade.example.in
FYERS_APP_ID=...
FYERS_SECRET_KEY=...
FYERS_REDIRECT_URI=https://trade.example.in/api/auth/fyers/callback
DB_MEMORY_LIMIT=256MB
```

plus `TELEGRAM_*` / `SMTP_*` if you want alerts outside the app. Keep the
file private: `sudo chmod 600 .env`.

**6. First admin account** (the service isn't running yet, so the database is free):

```bash
sudo -u indicator .venv/bin/python -m app.cli create-user <your-name>
```

Other users are added later in the app (account menu → Manage users).

**7. Backend service.** If a backend is already running some other way
(tmux, screen, an older service), stop it first: only one may run.

```bash
sudo cp /opt/indicator/deploy/indicator.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now indicator
curl -s http://127.0.0.1:8000/api/health     # {"status":"ok",...}
journalctl -u indicator -f                    # logs (Ctrl+C to leave)
```

**8. Frontend folder**, writable by your SSH user (for uploads):

```bash
sudo mkdir -p /var/www/indicator
sudo chown "$USER" /var/www/indicator
```

**9. Caddy.** Add the site block from `deploy/Caddyfile` to `/etc/caddy/Caddyfile`
(with your domain). Your existing `tradeapi.` block is no longer needed:
remove it or turn it into the redirect shown at the bottom of the file.

```bash
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

Ports 80 and 443 must be open (`sudo ufw allow 80,443/tcp` if you use ufw).
Port 8000 must **not** be open to the internet.

## DNS and Vercel

1. In Vercel: Project → Settings → Domains → remove `trade.example.in`
   (otherwise Vercel keeps answering for it).
2. At your DNS provider: set `trade.example.in` to an **A record** with the
   VPS's IP (replace the CNAME/A that pointed to Vercel).
3. Caddy fetches the HTTPS certificate on its own once the DNS points to it
   (can take a few minutes after the DNS change spreads).

## Fyers

In the Fyers API dashboard set the app's redirect URL to exactly
`https://trade.example.in/api/auth/fyers/callback` (same as in `.env`).

## Upload the frontend (from your PC)

```powershell
.\deploy\deploy-frontend.ps1 -Server deploy@SERVER
```

It builds on your PC (building on a 1 GB server can run out of memory),
uploads `frontend/dist`, and swaps it into `/var/www/indicator`.

Open `https://trade.example.in`, sign in, click **Connect Fyers**.

## Updating later

- Code pushed to GitHub → on the server: `bash /opt/indicator/deploy/update-backend.sh`
- Frontend changes → on your PC: `.\deploy\deploy-frontend.ps1 -Server deploy@SERVER`

## If something's wrong

| Symptom | Check |
|---|---|
| `/api/...` 404 | DNS still points to Vercel (`nslookup trade.example.in`), or the Caddy `handle /api/*` block is missing |
| 502 Bad Gateway | Backend down: `systemctl status indicator`, `journalctl -u indicator -n 50` |
| After Fyers login you land on localhost | `FRONTEND_URL` in `.env`, then `sudo systemctl restart indicator` |
| Fyers says redirect mismatch | Dashboard redirect URL ≠ `FYERS_REDIRECT_URI` |
| Login works but you're signed out on every request | `COOKIE_SECURE=true` needs HTTPS: open the `https://` address |
| No live prices / alert pop-ups | WebSocket path `/api/live` must go through Caddy (it does with this block); check the browser console |
| Memory | `free -h`; `systemctl status indicator` shows the service's memory |
| "IO Error: ... being used by another process" | Two backends running: stop the extra one (`ps aux | grep app.serve`) |
