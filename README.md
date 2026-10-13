# Indicator

Swing-trading chart analysis app for Indian markets: Fyers (history) and Kotak Neo (live)
data, TradingView Lightweight Charts for rendering, pattern analysis in Python.

## Layout

```
backend/            FastAPI
  app/
    main.py         app entry, login middleware (cookie or API key), /api/health
    config.py       settings from backend/.env
    store.py        app database (Postgres/Neon): users, invites, watchlists,
                    drawings, alerts, strategies, backtests, signals, API keys
    db.py           market-data cache (DuckDB): candles, instruments, index lists
    deps.py         provider / service singletons
    api/            routes: auth (Fyers OAuth), instruments, candles
    providers/      MarketDataProvider interface + Fyers adapter
    services/       candle lookup (hybrid), instruments, tokens, rate limiter
  tests/            pytest (fake provider + mocked Fyers HTTP)
  data/             market.duckdb (git-ignored)
frontend/           React + TypeScript + Vite + lightweight-charts
  src/api/client.ts typed API client (dev server proxies /api -> :8000)
```

## First-time setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\pip install --no-deps fyers-apiv3==3.1.19   # live prices (see requirements.txt)
copy .env.example .env      # then fill in API keys

cd ..\frontend
npm install
copy .env.example .env      # optional: backend address / dev port
```

`frontend/.env` only configures the dev server (where `/api` is forwarded,
which port to use). It holds no secrets and nothing in it reaches the
browser; Fyers keys stay in `backend/.env`.

## Databases

- **App database** (`DATABASE_URL`, e.g. Neon Postgres): everything that belongs
  to a person. Back this up (Neon does it for you). Empty `DATABASE_URL` uses a
  local SQLite file for development.
- **Market-data cache** (`DB_PATH`, DuckDB): candles and instruments. Rebuilt from
  Fyers as needed and trimmed daily (daily candles kept; 15m after
  `INTRADAY_BASE_DAYS`; other intraday after 60 days). No backup needed.

Upgrading from a version that kept users in DuckDB: the first start with
`DATABASE_URL` set imports users, watchlists, drawings, alerts and backtests
once (shared data goes to the first admin). Run that first start **on the
server**, whose DuckDB holds the real data.

## Accounts

Sign-up is **invite only**. Create the **first admin** from `backend`:

```powershell
.\.venv\Scripts\python -m app.cli create-user <name>            # admin
.\.venv\Scripts\python -m app.cli create-user <name> --user     # normal user
.\.venv\Scripts\python -m app.cli set-password <name>
.\.venv\Scripts\python -m app.cli list-users
```

Or set `ADMIN_USERNAME` / `ADMIN_PASSWORD` (and optionally `ADMIN_EMAIL`) in
`backend/.env`: that admin is created on startup if no user exists yet.

After that, admins manage everyone from the app: account menu (top right)
-> **Manage users**: **invite a friend** (one-time link, optional email lock,
expires in 1-30 days), create accounts directly, set roles and emails, reset
passwords, disable or delete. Each user has their own watchlists, drawings,
alerts, strategies, backtests and signals; market data and the Fyers
connection are shared (only admins connect Fyers). Everyone can **Change
password** and set **Profile, notifications & API keys** there.

**API keys** (for scripts/agents): `Authorization: Bearer ik_...` works on the
same `/api` routes as the app, as that user. E.g. agents post trade ideas to
`POST /api/signals`; they show up in Alerts -> Signals.
Disabling, deleting or resetting a password signs that person out; the last
admin can't be removed or demoted.

When hosted over HTTPS set `COOKIE_SECURE=true` (and `TRUST_PROXY=true`
behind Caddy/Nginx).

## Connect Fyers

1. Create an app at https://myapi.fyers.in with redirect URL
   `http://127.0.0.1:8000/api/auth/fyers/callback`.
2. Put the App ID and Secret in `backend/.env` (`FYERS_APP_ID`, `FYERS_SECRET_KEY`).
3. Start the app and click **Connect Fyers**. The token lasts until end of day,
   so you log in once per day.

## How candles are fetched

Data is fetched lazily, only for symbols you open, and only the missing range.

| Timeframe | Source |
|---|---|
| 1D, 1W, 1M | resampled from stored daily candles |
| 15m, 30m, 1h, 2h, 4h | resampled from stored 15m candles (last `INTRADAY_BASE_DAYS`); older ranges fetched natively from Fyers |
| 1m, 5m | fetched natively on demand |

Intraday buckets align to the 09:15 session open. Today's candles refresh at most
every `REFRESH_SECONDS`.

## Run

```powershell
.\dev.ps1
```

Opens two windows: backend at http://127.0.0.1:8000 (docs at /docs) and the
frontend at http://localhost:5173.

Or start them separately:

```powershell
cd backend
.\.venv\Scripts\python -m app.serve --dev    # auto-reload while developing
.\.venv\Scripts\python -m app.serve          # production: one process, no reload

cd frontend
npm run dev
```

`app.serve` listens on `HOST`/`PORT` from `backend/.env` (default
`127.0.0.1:8000`). It always runs a single process (the database, live
price socket and alert engine must not run twice). Keep `HOST=127.0.0.1`
behind Caddy/Nginx; if you change `PORT`, also set `BACKEND_URL` in
`frontend/.env`.

Tests: `cd backend; .\.venv\Scripts\python -m pytest`

## Roadmap

1. Project setup ✅
2. Fyers login, instrument list, historical download (100-day chunking), live websocket
3. Chart: symbol search, timeframe switcher, indicator overlays
4. Pattern analysis: TA-Lib candlestick patterns (all / user-selected), then chart patterns
