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
- **Edge analysis**: Implied direction from each feed vs Polymarket odds
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
git clone https://github.com/yourusername/btc-edge-dashboard.git
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
    "downPrice": 0.48
  },
  "edgeAnalysis": {
    "impliedUpFromBinance": 0.55,
    "impliedUpFromChainlink": 0.54,
    "polymarketUp": 0.52,
    "edge": 0.02,
    "timeToResolution": 180,
    "binanceChainlinkSpread": 1.7,
    "binanceChainlinkSpreadBps": 2.5
  }
}
```

## How Edge Analysis Works

1. **Price to beat**: Chainlink price when the 5-minute window started (Polymarket's resolution source)
2. **Implied Up (Binance)**: Current Binance price vs window start → mapped to 0–100% probability
3. **Implied Up (Chainlink)**: Current Chainlink price vs window start → same mapping
4. **Polymarket Up**: Live market odds for "Up" outcome
5. **Edge**: `impliedUpFromChainlink - polymarketUp`. Positive = Polymarket may underpricing Up

## Disclaimer

This is for **research and exploration only**. Polymarket resolves on Chainlink; Binance may diverge. Trading involves risk. Not financial advice.

## License

MIT
