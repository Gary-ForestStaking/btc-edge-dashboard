import { feedEvents } from '../events.js';
import { state, getEdgeAnalysis } from '../state.js';
import type { StrategyConfig, PaperPosition, PaperTrade, Side } from './types.js';
import { STRATEGIES } from './strategies.js';

const INITIAL_BALANCE = 100;

let balance = INITIAL_BALANCE;
let positions: PaperPosition[] = [];
let trades: PaperTrade[] = [];
let lastWindowSlug = '';
let positionIdCounter = 0;
let blockedWindowSlug: string | null = null;
let pendingSignals: Record<string, { side: Side; firstSeenMs: number; lastSeenMs: number }> = {};

function resetState() {
  balance = INITIAL_BALANCE;
  positions = [];
  trades = [];
  positionIdCounter = 0;
  blockedWindowSlug = state.polymarket?.slug ?? null;
  pendingSignals = {};
}

function genId(): string {
  return `pos_${++positionIdCounter}_${Date.now()}`;
}

const AGREEMENT_THRESHOLD = 0.52;
const EARLY_EDGE_CHAINLINK_NEUTRAL = 0.08;
const NO_TRADE_ZONE_ASK_FLOOR = 0.05;
const NO_TRADE_ZONE_ASK_CEIL = 0.95;
const NO_TRADE_ZONE_MAX_PM_SPREAD_BPS = 800;
const GLOBAL_MIN_TIME_TO_RESOLUTION = 60;
const GLOBAL_MIN_ABS_SPREAD_BPS = 8;
const GLOBAL_MAX_PM_SPREAD_BPS = 600;
const MIN_SIGNAL_PERSIST_MS = 2500;
const QUALITY_MIN_SCORE = 0.10;

function shouldEnter(
  config: StrategyConfig,
  edge: number,
  impliedUpBinance: number,
  impliedUpChainlink: number,
  polymarketAskUp: number,
  timeToResolution: number,
  spreadBps?: number,
  polymarketSpreadBps?: number
): { side: Side; price: number } | null {
  const mode = config.mode ?? 'default';

  if (Math.abs(edge) < config.minEdge) return null;
  if (timeToResolution > config.maxTimeToResolution) return null;
  if (config.minTimeToResolution && timeToResolution < config.minTimeToResolution) return null;
  if (timeToResolution < GLOBAL_MIN_TIME_TO_RESOLUTION) return null;

  if (spreadBps === undefined || Math.abs(spreadBps) < GLOBAL_MIN_ABS_SPREAD_BPS) return null;
  if (polymarketSpreadBps === undefined || polymarketSpreadBps > GLOBAL_MAX_PM_SPREAD_BPS) return null;
  if (polymarketAskUp <= NO_TRADE_ZONE_ASK_FLOOR || polymarketAskUp >= NO_TRADE_ZONE_ASK_CEIL) return null;

  const spreadSignal = Math.max(-1, Math.min(1, spreadBps / 100));
  const binanceSignal = impliedUpBinance - 0.5;
  const chainlinkSignal = impliedUpChainlink - 0.5;
  const qualityScore = Math.abs((binanceSignal * 0.45) + (chainlinkSignal * 0.35) + (spreadSignal * 0.20));
  if (qualityScore < QUALITY_MIN_SCORE) return null;

  if (mode === 'early-edge') {
    if (spreadBps === undefined) return null;
    const chainlinkNearStart = Math.abs(impliedUpChainlink - 0.5) < EARLY_EDGE_CHAINLINK_NEUTRAL;
    if (!chainlinkNearStart) return null;
    if (edge > 0 && spreadBps <= 0) return null;
    if (edge < 0 && spreadBps >= 0) return null;
  } else if (mode === 'agreement') {
    const bothUp = impliedUpBinance > AGREEMENT_THRESHOLD && impliedUpChainlink > AGREEMENT_THRESHOLD;
    const bothDown = impliedUpBinance < (1 - AGREEMENT_THRESHOLD) && impliedUpChainlink < (1 - AGREEMENT_THRESHOLD);
    if (!bothUp && !bothDown) return null;
    if (config.requireSpreadConfirm && spreadBps !== undefined) {
      if (edge > 0 && spreadBps < 0) return null;
      if (edge < 0 && spreadBps > 0) return null;
    }
  } else if (mode === 'no-trade-zone') {
    if (polymarketAskUp <= NO_TRADE_ZONE_ASK_FLOOR || polymarketAskUp >= NO_TRADE_ZONE_ASK_CEIL) return null;
    if (polymarketSpreadBps === undefined || polymarketSpreadBps > NO_TRADE_ZONE_MAX_PM_SPREAD_BPS) return null;
    if (config.requireSpreadConfirm) {
      if (spreadBps === undefined) return null;
      if (edge > 0 && spreadBps < 0) return null;
      if (edge < 0 && spreadBps > 0) return null;
    }
  } else if (mode === 'window-phase') {
    // Last minute is typically too noisy/illiquid for this setup.
    if (timeToResolution < 60) return null;
    // Earlier in the window we require stronger signal.
    const dynamicMinEdge = timeToResolution > 180 ? 0.09 : 0.06;
    if (Math.abs(edge) < dynamicMinEdge) return null;
    if (config.requireSpreadConfirm) {
      if (spreadBps === undefined) return null;
      if (edge > 0 && spreadBps < 0) return null;
      if (edge < 0 && spreadBps > 0) return null;
    }
  } else if (config.requireSpreadConfirm) {
    if (spreadBps === undefined) return null;
    if (edge > 0 && spreadBps < 0) return null;
    if (edge < 0 && spreadBps > 0) return null;
  }

  if (config.maxSpreadBps !== undefined && spreadBps !== undefined) {
    if (Math.abs(spreadBps) > config.maxSpreadBps) return null;
  }

  const pm = state.polymarket;
  if (!pm) return null;

  if (edge > 0) {
    const price = pm.bestAskUp > 0 && pm.bestAskUp < 1 ? pm.bestAskUp : pm.upPrice;
    if (price <= 0 || price >= 1) return null;
    return { side: 'Up', price };
  } else {
    const askDown = pm.bestBidUp >= 0 && pm.bestBidUp <= 1 ? 1 - pm.bestBidUp : pm.downPrice;
    if (askDown <= 0 || askDown >= 1) return null;
    return { side: 'Down', price: askDown };
  }
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
    polymarketSpreadBps,
    timeToResolution,
    binanceChainlinkSpreadBps,
  } = ea;
  const pm = state.polymarket;

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
    trades: activeTrades.slice(-50),
    totalTrades: activeTrades.length,
    totalPnl,
    wins,
    losses,
    winRate: activeTrades.length > 0 ? (wins / activeTrades.length) * 100 : 0,
    byStrategy,
  };
}
