import { feedEvents } from '../events.js';
import { state, getEdgeAnalysis } from '../state.js';
import type { CollapseType, StrategyConfig, PaperPosition, PaperTrade, Side } from './types.js';
import { STRATEGIES } from './strategies.js';

const INITIAL_BALANCE = 100;

let balance = INITIAL_BALANCE;
let positions: PaperPosition[] = [];
let trades: PaperTrade[] = [];
let lastWindowSlug = '';
let positionIdCounter = 0;
let blockedWindowSlug: string | null = null;
let pendingSignals: Record<string, { side: Side; firstSeenMs: number; lastSeenMs: number }> = {};
let orderbookHistory: Array<{ ts: number; slug: string; bidUp: number; askUp: number }> = [];

function resetState() {
  balance = INITIAL_BALANCE;
  positions = [];
  trades = [];
  positionIdCounter = 0;
  blockedWindowSlug = state.polymarket?.slug ?? null;
  pendingSignals = {};
  orderbookHistory = [];
}

function genId(): string {
  return `pos_${++positionIdCounter}_${Date.now()}`;
}

const MIN_SIGNAL_PERSIST_MS = 1500;
const LATE_ANCHOR_MAX_TTR_SEC = 60;
const LATE_ANCHOR_MIN_TTR_SEC = 3;
const LATE_ANCHOR_MAX_ASK = 0.95;
const COLLAPSE_BID_THRESHOLD = 0.08;
const IMPULSE_MIN = 0.05;
const MAX_SPREAD_BPS = 1200;

function shouldEnter(
  _config: StrategyConfig,
  _edge: number,
  _impliedUpBinance: number,
  _impliedUpChainlink: number,
  _polymarketAskUp: number,
  timeToResolution: number,
  _currentBinancePrice: number,
  _startBinancePrice: number,
  windowSlug: string,
  bestBidUp: number,
  bestAskUp: number,
  _spreadBps?: number,
  _polymarketSpreadBps?: number
): { side: Side; price: number; collapseType: CollapseType } | null {
  if (bestBidUp < 0 || bestBidUp > 1 || bestAskUp < 0 || bestAskUp > 1) return null;
  if (bestAskUp < bestBidUp) return null;
  if (timeToResolution > LATE_ANCHOR_MAX_TTR_SEC || timeToResolution < LATE_ANCHOR_MIN_TTR_SEC) return null;

  const askUp = bestAskUp;
  const askDown = 1 - bestBidUp;
  const bidDown = 1 - bestAskUp;
  const spreadBps = (bestAskUp - bestBidUp) * 10000;
  if (spreadBps > MAX_SPREAD_BPS) return null;

  const now = Date.now();
  const recent = orderbookHistory.filter((h) => h.slug === windowSlug && now - h.ts <= 8000);
  const minBidUp = recent.length > 0 ? Math.min(...recent.map((h) => h.bidUp)) : bestBidUp;
  const maxBidUp = recent.length > 0 ? Math.max(...recent.map((h) => h.bidUp)) : bestBidUp;
  const bidImpulseUp = bestBidUp - minBidUp;
  const bidImpulseDown = maxBidUp - bestBidUp;

  const downSideCollapsed = bidDown <= COLLAPSE_BID_THRESHOLD || bestAskUp >= 0.96;
  const upSideCollapsed = bestBidUp <= COLLAPSE_BID_THRESHOLD || askDown >= 0.96;

  if (downSideCollapsed && bidImpulseUp >= IMPULSE_MIN && askUp > 0 && askUp < LATE_ANCHOR_MAX_ASK) {
    return { side: 'Up', price: askUp, collapseType: 'down-side' };
  }
  if (upSideCollapsed && bidImpulseDown >= IMPULSE_MIN && askDown > 0 && askDown < LATE_ANCHOR_MAX_ASK) {
    return { side: 'Down', price: askDown, collapseType: 'up-side' };
  }
  return null;
}

function applyEntrySlippage(entryPrice: number, polymarketSpreadBps?: number): number {
  const spreadComponent = ((polymarketSpreadBps ?? 0) / 10000) * 0.25;
  const slippage = Math.min(0.02, 0.0015 + Math.max(0, spreadComponent));
  return Math.min(0.999, entryPrice + slippage);
}

function resolvePosition(pos: PaperPosition, resolutionPrice: number, startPrice: number): PaperTrade {
  const resolvedUp = resolutionPrice >= startPrice;
  const won = (pos.side === 'Up' && resolvedUp) || (pos.side === 'Down' && !resolvedUp);
  const exitPrice = won ? 1 : 0;
  const pnl = (exitPrice - pos.entryPrice) * pos.size;

  const trade: PaperTrade = {
    positionId: pos.id,
    strategyId: pos.strategyId,
    windowSlug: pos.windowSlug,
    side: pos.side,
    entryPrice: pos.entryPrice,
    size: pos.size,
    exitPrice,
    pnl,
    resolvedAt: Date.now(),
    outcome: won ? 'win' : 'loss',
    timeToResolutionAtEntry: pos.timeToResolutionAtEntry,
    collapseType: pos.collapseType,
  };

  trades.push(trade);
  return trade;
}

function runStrategies() {
  const ea = getEdgeAnalysis();
  if (!ea || !state.polymarket) return;

  const {
    edge,
    impliedUpFromBinance,
    impliedUpFromChainlink,
    polymarketAskUp,
    priceAtWindowStartBinance,
    polymarketSpreadBps,
    timeToResolution,
    binanceChainlinkSpreadBps,
  } = ea;
  const pm = state.polymarket;
  orderbookHistory.push({
    ts: Date.now(),
    slug: pm.slug,
    bidUp: pm.bestBidUp,
    askUp: pm.bestAskUp,
  });
  orderbookHistory = orderbookHistory.filter((h) => h.slug === pm.slug ? (Date.now() - h.ts) <= 15000 : false);

  const startChainlink = ea.priceAtWindowStartChainlink ?? 0;
  if (startChainlink <= 0) return;

  for (const config of STRATEGIES) {
    const alreadyHavePosition = positions.some(
      (p) => p.strategyId === config.id && p.windowSlug === pm.slug
    );
    if (alreadyHavePosition) continue;

    const signal = shouldEnter(
      config,
      edge,
      impliedUpFromBinance,
      impliedUpFromChainlink,
      polymarketAskUp,
      timeToResolution,
      state.binance.lastPrice,
      priceAtWindowStartBinance ?? 0,
      pm.slug,
      pm.bestBidUp,
      pm.bestAskUp,
      binanceChainlinkSpreadBps,
      polymarketSpreadBps
    );

    if (signal) {
      const pendingKey = `${config.id}:${pm.slug}`;
      const nowMs = Date.now();
      const pending = pendingSignals[pendingKey];
      if (!pending || pending.side !== signal.side) {
        pendingSignals[pendingKey] = { side: signal.side, firstSeenMs: nowMs, lastSeenMs: nowMs };
        continue;
      }
      pending.lastSeenMs = nowMs;
      if ((nowMs - pending.firstSeenMs) < MIN_SIGNAL_PERSIST_MS) continue;
      delete pendingSignals[pendingKey];

      if (signal.price <= 0 || signal.price >= 1) continue;
      const dollars = config.sizeInDollars ?? 5;
      const filledPrice = applyEntrySlippage(signal.price, polymarketSpreadBps);
      const size = Math.max(1, Math.floor(dollars / filledPrice));
      const cost = size * filledPrice;
      if (balance < cost) continue;

      const startChainlink = ea.priceAtWindowStartChainlink ?? 0;
      balance -= cost;
      const pos: PaperPosition = {
        id: genId(),
        strategyId: config.id,
        windowSlug: pm.slug,
        side: signal.side,
        entryPrice: filledPrice,
        size,
        entryTime: Date.now(),
        timeToResolutionAtEntry: timeToResolution,
        edgeAtEntry: edge,
        impliedUpAtEntry: impliedUpFromBinance,
        priceAtWindowStartChainlink: startChainlink,
        collapseType: signal.collapseType,
      };
      positions.push(pos);
      console.log(`[Paper] ${config.name} ENTER ${signal.side} @ ${(filledPrice * 100).toFixed(1)}% edge=${(edge * 100).toFixed(1)}% ttr=${timeToResolution}s`);
    } else {
      delete pendingSignals[`${config.id}:${pm.slug}`];
    }
  }
}

function resolveWindow(prevSlug: string, resolutionPrice: number) {
  const toResolve = positions.filter((p) => p.windowSlug === prevSlug);
  for (const pos of toResolve) {
    const trade = resolvePosition(pos, resolutionPrice, pos.priceAtWindowStartChainlink);
    balance += trade.exitPrice * pos.size;
    console.log(`[Paper] ${pos.strategyId} RESOLVE ${pos.side} ${trade.outcome} pnl=$${trade.pnl.toFixed(2)} bal=$${balance.toFixed(2)}`);
  }
  positions = positions.filter((p) => p.windowSlug !== prevSlug);
  for (const key of Object.keys(pendingSignals)) {
    if (key.endsWith(`:${prevSlug}`)) delete pendingSignals[key];
  }
  orderbookHistory = orderbookHistory.filter((h) => h.slug !== prevSlug);
}

function initListeners() {
  feedEvents.on('polymarket_update', (e) => {
    if (lastWindowSlug && e.slug !== lastWindowSlug) {
      const resolutionPrice = state.polymarketPrice?.price ?? 0;
      if (resolutionPrice > 0) {
        resolveWindow(lastWindowSlug, resolutionPrice);
      }
    }
    if (blockedWindowSlug && e.slug !== blockedWindowSlug) {
      blockedWindowSlug = null;
    }
    lastWindowSlug = e.slug;
    if (blockedWindowSlug && e.slug === blockedWindowSlug) return;
    runStrategies();
  });
}

initListeners();

export function clearPaperTrading(): void {
  resetState();
  console.log('[Paper] Cleared all trades and positions');
}

export function getPaperTradingState() {
  const activeIds = new Set(STRATEGIES.map((s) => s.id));
  const activeTrades = trades.filter((t) => activeIds.has(t.strategyId));
  const activePositions = positions.filter((p) => activeIds.has(p.strategyId));

  const totalPnl = activeTrades.reduce((s, t) => s + t.pnl, 0);
  const wins = activeTrades.filter((t) => t.outcome === 'win').length;
  const losses = activeTrades.filter((t) => t.outcome === 'loss').length;

  const lockedInPositions = activePositions.reduce((s, p) => s + p.entryPrice * p.size, 0);

  const byStrategy = activeTrades.reduce<Record<string, {
    name: string;
    pnl: number;
    wins: number;
    losses: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
  }>>((acc, t) => {
    if (!acc[t.strategyId]) {
      const cfg = STRATEGIES.find((s) => s.id === t.strategyId);
      acc[t.strategyId] = { name: cfg?.name ?? t.strategyId, pnl: 0, wins: 0, losses: 0, avgWin: 0, avgLoss: 0, profitFactor: 0 };
    }
    acc[t.strategyId].pnl += t.pnl;
    if (t.outcome === 'win') acc[t.strategyId].wins++;
    else acc[t.strategyId].losses++;
    return acc;
  }, {});

  for (const [strategyId, stats] of Object.entries(byStrategy)) {
    const strategyTrades = activeTrades.filter((t) => t.strategyId === strategyId);
    const winPnls = strategyTrades.filter((t) => t.pnl > 0).map((t) => t.pnl);
    const lossPnls = strategyTrades.filter((t) => t.pnl < 0).map((t) => Math.abs(t.pnl));
    const grossWin = winPnls.reduce((s, v) => s + v, 0);
    const grossLoss = lossPnls.reduce((s, v) => s + v, 0);
    stats.avgWin = winPnls.length > 0 ? grossWin / winPnls.length : 0;
    stats.avgLoss = lossPnls.length > 0 ? grossLoss / lossPnls.length : 0;
    stats.profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Number.POSITIVE_INFINITY : 0);
  }

  return {
    balance,
    initialBalance: INITIAL_BALANCE,
    lockedInPositions,
    positions: activePositions,
    trades: activeTrades,
    recentTrades: activeTrades.slice(-50),
    totalTrades: activeTrades.length,
    totalPnl,
    wins,
    losses,
    winRate: activeTrades.length > 0 ? (wins / activeTrades.length) * 100 : 0,
    byStrategy,
  };
}
