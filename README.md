# Indicator

Chart analysis app for Indian markets: Fyers (history + live) and Kotak Neo (live) data,
TradingView Lightweight Charts for rendering, pattern analysis in Python.

## Layout

```
backend/            FastAPI + DuckDB
  app/
    main.py         app entry, /api/health
    config.py       settings from backend/.env
    db.py           DuckDB schema (candles, instruments)
    api/candles.py  /api/candles - resamples 1m candles to 3m..4h on read
    providers/      MarketDataProvider interface; Fyers/Kotak adapters go here
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

## Run

```powershell
.\dev.ps1
```

Opens two windows: backend at http://127.0.0.1:8000 (docs at /docs) and the
frontend at http://localhost:5173.

## Roadmap

1. Project setup ✅
2. Fyers login, instrument list, historical download (100-day chunking), live websocket
3. Chart: symbol search, timeframe switcher, indicator overlays
4. Pattern analysis: TA-Lib candlestick patterns (all / user-selected), then chart patterns
