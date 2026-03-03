# BTC Edge Dashboard

Event-driven dashboard comparing **Binance Futures** and **Polymarket** price feeds to analyze edge in 5-minute Bitcoin Up/Down prediction markets.

## Overview

Polymarket's 5-minute BTC Up/Down markets resolve using **Chainlink BTC/USD**. This project streams both Binance Futures and the Chainlink feed (via Polymarket RTDS) side-by-side to:

- Compare price feeds in real time
- Track the spread between Binance and Chainlink
- Analyze whether Polymarket odds diverge from price-based implied probabilities

## Features

- **Dual price feeds**: Binance Futures (BTC/USDT) + Polymarket/Chainlink (BTC/USD)
- **Spread tracking**: Dollar and basis-point difference between feeds
- **5-minute market odds**: Live Up/Down probabilities from Polymarket
- **Edge analysis**: Volatility-adjusted Binance probability vs Polymarket tradeable ask
- **Model toggle**: Vol-adjusted vs legacy linear implied model on dashboard
- **Paper trading**: Five strategy variants with per-strategy PnL
- **Event-driven architecture**: WebSockets throughout, no polling

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Binance Futures │     │ Polymarket RTDS │     │ Polymarket CLOB │
│ WebSocket       │     │ (Chainlink)     │     │ WebSocket       │
│ btcusdt@trade   │     │ crypto_prices_  │     │ market channel  │
└────────┬────────┘     │ chainlink       │     └────────┬────────┘
         │              └────────┬────────┘              │
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                         ┌───────▼───────┐
                         │  Event Bus    │
                         │  (Emitter)    │
                         └───────┬───────┘
                                 │
                         ┌───────▼───────┐
                         │  State + API  │
                         │  :3847        │
                         └───────┬───────┘
                                 │
                         ┌───────▼───────┐
                         │  Dashboard    │
                         │  :5173        │
                         └───────────────┘
```

| Component | Source | Event-driven |
|-----------|--------|--------------|
| Binance price | `wss://fstream.binance.com/ws/btcusdt@trade` | ✅ |
| Chainlink price | `wss://ws-live-data.polymarket.com` (crypto_prices_chainlink) | ✅ |
| Market discovery | Gamma API (on 5-min boundary) | ✅ |
| Market odds | `wss://ws-subscriptions-clob.polymarket.com/ws/market` | ✅ |

## Requirements

- Node.js 18+
- npm

## Quick Start

```bash
git clone https://github.com/Gary-ForestStaking/btc-edge-dashboard.git
cd btc-edge-dashboard
npm install
npm run start
```

Open **http://localhost:5173** in your browser.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run start` | Run feed server + dashboard (recommended) |
| `npm run feed` | Run feed server only (API at http://localhost:3847) |
| `npm run dashboard` | Run dashboard only (http://localhost:5173) |

## API

**GET** `http://localhost:3847/api/state`

**POST/GET** `http://localhost:3847/api/paper/clear`

Returns current state:

```json
{
  "binance": { "lastPrice": 67950.2, "lastUpdate": 1234567890, "tradeCount": 1234 },
  "polymarketPrice": { "price": 67948.5, "lastUpdate": 1234567890 },
  "polymarket": {
    "slug": "btc-updown-5m-1772556600",
    "windowStart": 1772556600,
    "windowEnd": 1772556900,
    "upPrice": 0.52,
    "downPrice": 0.48,
    "bestBidUp": 0.51,
    "bestAskUp": 0.53
  },
  "edgeAnalysis": {
    "impliedUpFromBinance": 0.55,
    "impliedUpVolAdj": 0.55,
    "oldLinearImpliedUp": 0.51,
    "impliedUpFromChainlink": 0.54,
    "polymarketUp": 0.52,
    "polymarketAskUp": 0.53,
    "edge": 0.02,
    "edgeFromChainlink": 0.01,
    "polymarketSpreadBps": 200,
    "realizedVol": 0.72,
    "tau": 0.0000057,
    "timeToResolution": 180,
    "binanceChainlinkSpread": 1.7,
    "binanceChainlinkSpreadBps": 2.5
  },
  "paperTrading": {
    "balance": 100,
    "initialBalance": 100,
    "totalTrades": 0,
    "totalPnl": 0,
    "byStrategy": {}
  }
}
```

## How Edge Analysis Works

1. **Price to beat**: Chainlink price when the 5-minute window started (Polymarket's resolution source)
2. **Rolling volatility**: 60-second realized volatility from Binance log returns, annualized
3. **Time to resolution**: `tau = timeToResolutionSeconds / secondsPerYear` (epsilon clamped)
4. **Vol-adjusted implied up**:
   `P(Up) = Φ( ln(S/S0) / (sigma * sqrt(tau)) )`
5. **Tradeable price**: Up uses `bestAskUp` (not midpoint) to avoid fake edge
6. **Edge (primary)**: `impliedUpVolAdj - polymarketAskUp`
7. **Comparison model**: `oldLinearImpliedUp` is still exposed for side-by-side dashboard comparison

## Paper Trading

Five strategies run automatically in paper mode (no real money):

| Strategy | Mode | Key Gate | Size |
|----------|------|----------|------|
| Early Edge | `early-edge` | Chainlink near 50%, spread direction confirm | ~$5/trade |
| Agreement | `agreement` | Binance + Chainlink agree on direction | ~$5/trade |
| No-Trade Zone | `no-trade-zone` | Skip extreme asks / wide PM spread | ~$5/trade |
| Window Phase | `window-phase` | Dynamic threshold by time-to-resolution | ~$5/trade |
| Consensus Score | `consensus` | Weighted score (Binance, Chainlink, spread) | ~$5/trade |

- **TTR** = time to resolution (seconds)
- **Spread confirm**: Binance-Chainlink spread must agree with edge direction
- Each strategy takes at most one position per 5-min window
- Reset button/API clears trades, open positions, and resets balance to initial

Results appear in the dashboard Paper Trading section.

## Disclaimer

This is for **research and exploration only**. Polymarket resolves on Chainlink; Binance may diverge. Trading involves risk. Not financial advice.

## License

MIT
