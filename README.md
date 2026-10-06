# Indicator

Swing-trading chart analysis app for Indian markets: Fyers (history) and Kotak Neo (live)
data, TradingView Lightweight Charts for rendering, pattern analysis in Python.

## Layout

```
backend/            FastAPI + DuckDB
  app/
    main.py         app entry, /api/health
    config.py       settings from backend/.env
    db.py           DuckDB schema (candles, instruments)
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
copy .env.example .env      # then fill in API keys

cd ..\frontend
npm install
```

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

Tests: `cd backend; .\.venv\Scripts\python -m pytest`

## Roadmap

1. Project setup ✅
2. Fyers login, instrument list, historical download (100-day chunking), live websocket
3. Chart: symbol search, timeframe switcher, indicator overlays
4. Pattern analysis: TA-Lib candlestick patterns (all / user-selected), then chart patterns
