import { feedEvents } from './events.js';
import type { MarketState, EdgeAnalysis } from './types.js';
import { secondsUntilWindowEnd } from './feeds/polymarket-utils.js';
import {
  RollingRealizedVolatility,
  impliedUpVolAdjusted,
  tauYearsFromSeconds,
} from './volatility.js';

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
const volEstimator = new RollingRealizedVolatility(60_000);

function isFallbackPolymarketUpdate(e: {
  upPrice: number;
  downPrice: number;
  bestBidUp: number;
  bestAskUp: number;
}): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  return near(e.upPrice, 0.5) && near(e.downPrice, 0.5) && near(e.bestBidUp, 0.5) && near(e.bestAskUp, 0.5);
}

function isNearHalf(v: number): boolean {
  return Math.abs(v - 0.5) < 0.02;
}

function initListeners() {
  feedEvents.on('binance_trade', (e) => {
    state.binance.lastPrice = e.price;
    state.binance.lastUpdate = e.timestamp;
    state.binance.tradeCount++;
    volEstimator.addPrice(e.price, e.timestamp);
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
    // Hold last valid odds during reconnect/fallback updates so UI doesn't flash 50/50.
    if (isFallbackPolymarketUpdate(e) && state.polymarket && !isFallbackPolymarketUpdate(state.polymarket)) {
      return;
    }
    // Also ignore transient near-50 updates if the last valid value was clearly not near 50.
    if (
      state.polymarket &&
      isNearHalf(e.upPrice) &&
      !isNearHalf(state.polymarket.upPrice)
    ) {
      return;
    }

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
      bestBidUp: e.bestBidUp,
      bestAskUp: e.bestAskUp,
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
  const oldLinearImpliedUp = impliedUpFromPrice(state.binance.lastPrice, priceAtWindowStartBinance);
  const realizedVol = volEstimator.getAnnualizedVol(Date.now());
  const tau = tauYearsFromSeconds(timeToResolution);
  const impliedUpVolAdj = impliedUpVolAdjusted(
    state.binance.lastPrice,
    priceAtWindowStartBinance,
    realizedVol,
    timeToResolution,
  );
  // Keep this key for compatibility, but now source it from vol-adjusted model.
  const impliedUpBinance = impliedUpVolAdj;
  const chainlinkPrice = state.polymarketPrice?.price ?? 0;
  const impliedUpChainlink = impliedUpFromPrice(chainlinkPrice, priceAtWindowStartChainlink);
  const polymarketUp = pm.upPrice;
  const polymarketAskUp = pm.bestAskUp > 0 && pm.bestAskUp < 1 ? pm.bestAskUp : polymarketUp;

  // Primary edge now uses volatility-adjusted Binance probability.
  const edge = impliedUpVolAdj - polymarketAskUp;
  const edgeFromChainlink = impliedUpChainlink - polymarketAskUp;
  const polymarketSpreadBps =
    pm.bestAskUp >= 0 && pm.bestBidUp >= 0
      ? (pm.bestAskUp - pm.bestBidUp) * 10000
      : undefined;

  const spread = state.binance.lastPrice > 0 && chainlinkPrice > 0
    ? state.binance.lastPrice - chainlinkPrice
    : undefined;
  const spreadBps = spread !== undefined && chainlinkPrice > 0
    ? (spread / chainlinkPrice) * 10000
    : undefined;

  return {
    impliedUpFromBinance: impliedUpBinance,
    impliedUpVolAdj,
    oldLinearImpliedUp,
    impliedUpFromChainlink: impliedUpChainlink,
    polymarketUp,
    polymarketAskUp,
    edge,
    edgeFromChainlink,
    polymarketSpreadBps,
    realizedVol,
    tau,
    timeToResolution,
    priceAtWindowStartBinance: priceAtWindowStartBinance || undefined,
    priceAtWindowStartChainlink: priceAtWindowStartChainlink || undefined,
    binanceChainlinkSpread: spread,
    binanceChainlinkSpreadBps: spreadBps,
  };
}
