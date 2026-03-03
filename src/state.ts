import { feedEvents } from './events.js';
import type { MarketState, EdgeAnalysis } from './types.js';
import { secondsUntilWindowEnd } from './feeds/polymarket-utils.js';

/** In-memory state for dashboard - updated by event handlers */
export const state: MarketState = {
  binance: {
    lastPrice: 0,
    lastUpdate: 0,
    tradeCount: 0,
  },
  polymarketPrice: null,
  polymarket: null,
};

/** Prices at window start - captured when Polymarket window changes */
let priceAtWindowStartBinance = 0;
let priceAtWindowStartChainlink = 0;
let currentWindowSlug = '';

function initListeners() {
  feedEvents.on('binance_trade', (e) => {
    state.binance.lastPrice = e.price;
    state.binance.lastUpdate = e.timestamp;
    state.binance.tradeCount++;
    if (currentWindowSlug && priceAtWindowStartBinance <= 0 && e.price > 0) {
      priceAtWindowStartBinance = e.price;
    }
  });

  feedEvents.on('polymarket_price', (e) => {
    state.polymarketPrice = { price: e.price, lastUpdate: e.timestamp };
    if (currentWindowSlug && priceAtWindowStartChainlink <= 0 && e.price > 0) {
      priceAtWindowStartChainlink = e.price;
    }
  });

  feedEvents.on('polymarket_update', (e) => {
    if (e.slug !== currentWindowSlug) {
      currentWindowSlug = e.slug;
      priceAtWindowStartBinance = state.binance.lastPrice > 0 ? state.binance.lastPrice : 0;
      priceAtWindowStartChainlink = (state.polymarketPrice?.price ?? 0) > 0 ? state.polymarketPrice!.price : 0;
    }
    state.polymarket = {
      slug: e.slug,
      windowStart: e.windowStart,
      windowEnd: e.windowEnd,
      upPrice: e.upPrice,
      downPrice: e.downPrice,
      lastUpdate: e.timestamp,
    };
  });
}

initListeners();

function impliedUpFromPrice(current: number, start: number): number {
  if (current <= 0 || start <= 0) return 0.5;
  const pctMove = (current - start) / start;
  const implied = 0.5 + Math.tanh(pctMove * 25) * 0.45;
  return Math.max(0.05, Math.min(0.95, implied));
}

export function getEdgeAnalysis(): EdgeAnalysis | null {
  if (!state.polymarket) return null;

  const pm = state.polymarket;
  const timeToResolution = secondsUntilWindowEnd(pm.windowStart);
  const impliedUpBinance = impliedUpFromPrice(state.binance.lastPrice, priceAtWindowStartBinance);
  const chainlinkPrice = state.polymarketPrice?.price ?? 0;
  const impliedUpChainlink = impliedUpFromPrice(chainlinkPrice, priceAtWindowStartChainlink);
  const polymarketUp = pm.upPrice;

  // Use Chainlink for edge - Polymarket resolves on Chainlink
  const edge = impliedUpChainlink - polymarketUp;

  const spread = state.binance.lastPrice > 0 && chainlinkPrice > 0
    ? state.binance.lastPrice - chainlinkPrice
    : undefined;
  const spreadBps = spread !== undefined && chainlinkPrice > 0
    ? (spread / chainlinkPrice) * 10000
    : undefined;

  return {
    impliedUpFromBinance: impliedUpBinance,
    impliedUpFromChainlink: impliedUpChainlink,
    polymarketUp,
    edge,
    timeToResolution,
    priceAtWindowStartBinance: priceAtWindowStartBinance || undefined,
    priceAtWindowStartChainlink: priceAtWindowStartChainlink || undefined,
    binanceChainlinkSpread: spread,
    binanceChainlinkSpreadBps: spreadBps,
  };
}
