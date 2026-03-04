// Use proxy when running via Vite dev server
const API_URL = '/api/state';
const POLL_MS = 500;
const ORDERBOOK_HISTORY_MS = 60_000;
const ORDERBOOK_POINTS_MAX = 120;
const COLLAPSE_BID_THRESHOLD = 0.08;

interface ObPoint {
  ts: number;
  bid: number;
  ask: number;
}

const orderbookHistory: ObPoint[] = [];
let lastOrderbookTs = 0;
const renderCache: Record<string, string> = {};
let lastTradesSignature = '';

interface ApiState {
  binance: { lastPrice: number; lastUpdate: number; tradeCount: number };
  polymarketPrice: { price: number; lastUpdate: number } | null;
  polymarket: {
    slug: string;
    windowStart: number;
    windowEnd: number;
    upPrice: number;
    downPrice: number;
    bestBidUp: number;
    bestAskUp: number;
    lastUpdate: number;
  } | null;
  edgeAnalysis: {
    impliedUpFromBinance: number;
    impliedUpVolAdj: number;
    oldLinearImpliedUp: number;
    impliedUpFromChainlink: number;
    polymarketUp: number;
    polymarketAskUp: number;
    edge: number;
    edgeFromChainlink?: number;
    polymarketSpreadBps?: number;
    realizedVol?: number;
    tau?: number;
    timeToResolution: number;
    priceAtWindowStartBinance?: number;
    priceAtWindowStartChainlink?: number;
    binanceChainlinkSpread?: number;
    binanceChainlinkSpreadBps?: number;
  } | null;
  paperTrading?: {
    balance: number;
    initialBalance: number;
    lockedInPositions: number;
    byStrategy?: Record<string, {
      name: string;
      pnl: number;
      wins: number;
      losses: number;
      avgWin: number;
      avgLoss: number;
      profitFactor: number;
    }>;
    positions: Array<{ strategyId: string; side: string; entryPrice: number; size: number; timeToResolutionAtEntry: number }>;
    trades: Array<{
      positionId: string;
      strategyId: string;
      side: string;
      outcome: string;
      pnl: number;
      entryPrice: number;
      timeToResolutionAtEntry: number;
      collapseType: 'up-side' | 'down-side';
    }>;
    recentTrades?: Array<{
      positionId: string;
      strategyId: string;
      side: string;
      outcome: string;
      pnl: number;
      entryPrice: number;
      timeToResolutionAtEntry: number;
      collapseType: 'up-side' | 'down-side';
    }>;
    totalTrades: number;
    totalPnl: number;
    wins: number;
    losses: number;
    winRate: number;
  };
  serverTime: number;
}

function formatPrice(n: number): string {
  return n > 0 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
}

function formatPct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

function formatVol(n?: number): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function formatTau(n?: number): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return n.toExponential(3);
}

function getUseVolAdjustedModel(): boolean {
  const raw = localStorage.getItem('use-vol-adjusted-model');
  return raw !== '0';
}

function setUseVolAdjustedModel(v: boolean): void {
  localStorage.setItem('use-vol-adjusted-model', v ? '1' : '0');
}

function formatTime(sec: number): string {
  if (sec <= 0) return 'Resolving';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatWindow(start: number): string {
  const d = new Date(start * 1000);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/New_York',
  }) + ' ET';
}

async function fetchState(): Promise<ApiState | null> {
  try {
    const res = await fetch(API_URL);
    return await res.json();
  } catch {
    return null;
  }
}

function formatSpread(spread: number, bps?: number): string {
  const sign = spread >= 0 ? '+' : '';
  const bpsStr = bps !== undefined ? ` (${sign}${bps.toFixed(1)} bps)` : '';
  return `${sign}$${spread.toFixed(2)}${bpsStr}`;
}

function setBarWidth(el: HTMLElement | null, prob: number): void {
  if (!el || !Number.isFinite(prob)) return;
  const pct = Math.max(0, Math.min(100, prob * 100));
  const next = `${pct}%`;
  if (el.style.width !== next) el.style.width = next;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function pushOrderbookPoint(ts: number, bid: number, ask: number): void {
  if (!Number.isFinite(ts) || ts <= 0 || ts === lastOrderbookTs) return;
  lastOrderbookTs = ts;
  orderbookHistory.push({ ts, bid: clamp01(bid), ask: clamp01(ask) });
  const cutoff = ts - ORDERBOOK_HISTORY_MS;
  while (orderbookHistory.length && orderbookHistory[0].ts < cutoff) {
    orderbookHistory.shift();
  }
  if (orderbookHistory.length > ORDERBOOK_POINTS_MAX) {
    orderbookHistory.splice(0, orderbookHistory.length - ORDERBOOK_POINTS_MAX);
  }
}

function linePath(points: ObPoint[], width: number, height: number, key: 'bid' | 'ask'): string {
  if (points.length < 2) return '';
  const minTs = points[0].ts;
  const maxTs = points[points.length - 1].ts;
  const span = Math.max(1, maxTs - minTs);
  return points.map((p, i) => {
    const x = ((p.ts - minTs) / span) * width;
    const y = (1 - clamp01(p[key])) * height;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

function spreadBandPath(points: ObPoint[], width: number, height: number): string {
  if (points.length < 2) return '';
  const minTs = points[0].ts;
  const maxTs = points[points.length - 1].ts;
  const span = Math.max(1, maxTs - minTs);
  const top = points.map((p) => {
    const x = ((p.ts - minTs) / span) * width;
    const y = (1 - clamp01(p.ask)) * height;
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  const bottom = points.slice().reverse().map((p) => {
    const x = ((p.ts - minTs) / span) * width;
    const y = (1 - clamp01(p.bid)) * height;
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  return `M${top[0]} L${top.slice(1).join(' L')} L${bottom.join(' L')} Z`;
}

function formatMoney(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}$${n.toFixed(2)}`;
}

function setTextCached(key: string, el: HTMLElement | null, value: string): void {
  if (!el) return;
  if (renderCache[key] === value) return;
  renderCache[key] = value;
  el.textContent = value;
}

function setHtmlCached(key: string, el: HTMLElement | null, value: string): void {
  if (!el) return;
  if (renderCache[key] === value) return;
  renderCache[key] = value;
  el.innerHTML = value;
}

function setAttrCached(key: string, el: Element | null, attr: string, value: string): void {
  if (!el) return;
  if (renderCache[key] === value) return;
  renderCache[key] = value;
  el.setAttribute(attr, value);
}

function computeHealthMetrics(trades: Array<{ pnl: number; outcome: string }>) {
  if (!trades.length) return null;

  const wins = trades.filter((t) => t.outcome === 'win').map((t) => t.pnl);
  const losses = trades.filter((t) => t.outcome === 'loss').map((t) => t.pnl);
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const expectancy = totalPnl / trades.length;

  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLossMag = losses.length
    ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length)
    : 0;
  const winLossRatio = avgLossMag > 0 ? avgWin / avgLossMag : null;

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const t of trades) {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const last50 = trades.slice(-50);
  const last50Pnl = last50.reduce((sum, t) => sum + t.pnl, 0);
  const last50Wins = last50.filter((t) => t.outcome === 'win').length;
  const last50WinRate = last50.length ? (last50Wins / last50.length) * 100 : 0;

  return {
    expectancy,
    avgWin,
    avgLossMag,
    winLossRatio,
    maxDrawdown,
    last50Pnl,
    last50WinRate,
    sampleSize: trades.length,
    last50Count: last50.length,
  };
}

type SegmentTrade = {
  pnl: number;
  outcome: string;
  entryPrice: number;
  timeToResolutionAtEntry: number;
  collapseType: 'up-side' | 'down-side';
};

function bucketBy<T extends string>(items: SegmentTrade[], fn: (t: SegmentTrade) => T): Record<T, SegmentTrade[]> {
  return items.reduce((acc, item) => {
    const k = fn(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {} as Record<T, SegmentTrade[]>);
}

function summarizeSegment(rows: Record<string, SegmentTrade[]>): string {
  const keys = Object.keys(rows);
  if (!keys.length) return 'No trades yet';
  const body = keys.map((k) => {
    const arr = rows[k];
    const pnl = arr.reduce((s, t) => s + t.pnl, 0);
    const wins = arr.filter((t) => t.outcome === 'win').length;
    const wr = arr.length ? (wins / arr.length) * 100 : 0;
    const exp = arr.length ? pnl / arr.length : 0;
    const pnlClass = pnl >= 0 ? 'positive' : 'negative';
    return `<div class="paper-segment-row"><span>${k}</span><strong class="${pnlClass}">${formatMoney(pnl)}</strong><span>${arr.length}t · ${wr.toFixed(1)}% · exp ${formatMoney(exp)}</span></div>`;
  }).join('');
  return `<div class="paper-segment-table">${body}</div>`;
}

function render(state: ApiState | null) {
  const statusEl = document.getElementById('status')!;
  const binancePrice = document.getElementById('binance-price')!;
  const chainlinkPrice = document.getElementById('chainlink-price')!;
  const spreadRow = document.getElementById('spread-row')!;
  const spreadValue = document.getElementById('spread-value')!;
  const pmWindow = document.getElementById('pm-window')!;
  const pmUp = document.getElementById('pm-up')!;
  const pmDown = document.getElementById('pm-down')!;
  const pmMeta = document.getElementById('pm-meta')!;
  const obUpBid = document.getElementById('ob-up-bid');
  const obUpAsk = document.getElementById('ob-up-ask');
  const obDownBid = document.getElementById('ob-down-bid');
  const obDownAsk = document.getElementById('ob-down-ask');
  const obUpBidBar = document.getElementById('ob-up-bid-bar') as HTMLElement | null;
  const obUpAskBar = document.getElementById('ob-up-ask-bar') as HTMLElement | null;
  const obDownBidBar = document.getElementById('ob-down-bid-bar') as HTMLElement | null;
  const obDownAskBar = document.getElementById('ob-down-ask-bar') as HTMLElement | null;
  const obSpreadBps = document.getElementById('ob-spread-bps');
  const obMid = document.getElementById('ob-mid');
  const obRegime = document.getElementById('ob-regime');
  const obImbalanceFill = document.getElementById('ob-imbalance-fill') as HTMLElement | null;
  const obBidLine = document.getElementById('ob-bid-line');
  const obAskLine = document.getElementById('ob-ask-line');
  const obSpreadBand = document.getElementById('ob-spread-band');
  const priceToBeat = document.getElementById('price-to-beat')!;
  const impliedUpBinance = document.getElementById('implied-up-binance')!;
  const impliedUpVol = document.getElementById('implied-up-vol')!;
  const impliedUpLinear = document.getElementById('implied-up-linear')!;
  const realizedVolEl = document.getElementById('realized-vol')!;
  const tauYearsEl = document.getElementById('tau-years')!;
  const impliedUpChainlink = document.getElementById('implied-up-chainlink')!;
  const polymarketUp = document.getElementById('polymarket-up')!;
  const polymarketAskEl = document.getElementById('polymarket-ask');
  const edgeWrap = document.getElementById('edge-value-wrap')!;
  const edgeValue = document.getElementById('edge-value')!;
  const edgeLabel = edgeWrap.querySelector('.edge-label');
  const edgeChainlinkEl = document.getElementById('edge-chainlink');
  const timeToRes = document.getElementById('time-to-res')!;
  const paperBalance = document.getElementById('paper-balance')!;
  const paperPnl = document.getElementById('paper-pnl')!;
  const paperTrades = document.getElementById('paper-trades')!;
  const paperWinrate = document.getElementById('paper-winrate')!;
  const paperByStrategyList = document.getElementById('paper-by-strategy-list');
  const paperHealthGrid = document.getElementById('paper-health-grid');
  const paperSegmentPrice = document.getElementById('paper-segment-price');
  const paperSegmentTtr = document.getElementById('paper-segment-ttr');
  const paperSegmentCollapse = document.getElementById('paper-segment-collapse');
  const paperPositionsList = document.getElementById('paper-positions-list')!;
  const paperTradesContent = document.getElementById('paper-trades-content')!;

  if (!state) {
    statusEl.textContent = 'Disconnected';
    statusEl.classList.remove('live');
    return;
  }

  statusEl.textContent = 'Live';
  statusEl.classList.add('live');

  setTextCached('binancePrice', binancePrice, formatPrice(state.binance.lastPrice));
  setTextCached('chainlinkPrice', chainlinkPrice, state.polymarketPrice ? formatPrice(state.polymarketPrice.price) : '—');

  if (state.edgeAnalysis?.binanceChainlinkSpread !== undefined) {
    const { binanceChainlinkSpread, binanceChainlinkSpreadBps } = state.edgeAnalysis;
    setTextCached('spreadValue', spreadValue, formatSpread(binanceChainlinkSpread, binanceChainlinkSpreadBps));
    spreadRow.classList.toggle('positive', (binanceChainlinkSpread ?? 0) > 0);
    spreadRow.classList.toggle('negative', (binanceChainlinkSpread ?? 0) < 0);
  } else {
    setTextCached('spreadValue', spreadValue, '—');
    spreadRow.classList.remove('positive', 'negative');
  }

  if (state.polymarket) {
    const pm = state.polymarket;
    setTextCached('pmWindow', pmWindow, formatWindow(pm.windowStart) + ' – ' + formatWindow(pm.windowEnd));
    setTextCached('pmUp', pmUp, formatPct(pm.upPrice));
    setTextCached('pmDown', pmDown, formatPct(pm.downPrice));
    setTextCached('pmMeta', pmMeta, pm.slug);

    const upBid = pm.bestBidUp;
    const upAsk = pm.bestAskUp;
    const downBid = 1 - upAsk;
    const downAsk = 1 - upBid;
    const mid = (upBid + upAsk) / 2;
    const spreadBps = (upAsk - upBid) * 10000;
    const downSideCollapsed = downBid <= COLLAPSE_BID_THRESHOLD || upAsk >= 0.96;
    const upSideCollapsed = upBid <= COLLAPSE_BID_THRESHOLD || downAsk >= 0.96;
    const regime = downSideCollapsed && upSideCollapsed
      ? 'Both sides thin'
      : downSideCollapsed
        ? 'Down collapsed'
        : upSideCollapsed
          ? 'Up collapsed'
          : 'Balanced';
    const imbalance = Math.max(-1, Math.min(1, upBid + upAsk - 1));

    setTextCached('obUpBid', obUpBid, formatPct(upBid));
    setTextCached('obUpAsk', obUpAsk, formatPct(upAsk));
    setTextCached('obDownBid', obDownBid, formatPct(downBid));
    setTextCached('obDownAsk', obDownAsk, formatPct(downAsk));
    setTextCached('obSpreadBps', obSpreadBps, `${spreadBps.toFixed(1)} bps`);
    setTextCached('obMid', obMid, formatPct(mid));
    setTextCached('obRegime', obRegime, regime);

    setBarWidth(obUpBidBar, upBid);
    setBarWidth(obUpAskBar, upAsk);
    setBarWidth(obDownBidBar, downBid);
    setBarWidth(obDownAskBar, downAsk);

    if (obImbalanceFill) {
      const widthPct = Math.abs(imbalance) * 100;
      const nextWidth = `${widthPct / 2}%`;
      const nextLeft = imbalance >= 0 ? '50%' : `${50 - (widthPct / 2)}%`;
      if (obImbalanceFill.style.width !== nextWidth) obImbalanceFill.style.width = nextWidth;
      if (obImbalanceFill.style.left !== nextLeft) obImbalanceFill.style.left = nextLeft;
      obImbalanceFill.classList.toggle('negative', imbalance < 0);
    }

    pushOrderbookPoint(pm.lastUpdate || Date.now(), upBid, upAsk);
    if (obBidLine && obAskLine && obSpreadBand) {
      const width = 640;
      const height = 170;
      setAttrCached('obBidLineD', obBidLine, 'd', linePath(orderbookHistory, width, height, 'bid'));
      setAttrCached('obAskLineD', obAskLine, 'd', linePath(orderbookHistory, width, height, 'ask'));
      setAttrCached('obSpreadBandD', obSpreadBand, 'd', spreadBandPath(orderbookHistory, width, height));
    }
  } else {
    setTextCached('pmWindow', pmWindow, '—');
    setTextCached('pmUp', pmUp, '—');
    setTextCached('pmDown', pmDown, '—');
    setTextCached('pmMeta', pmMeta, 'Waiting for market...');
    setTextCached('obUpBid', obUpBid, '—');
    setTextCached('obUpAsk', obUpAsk, '—');
    setTextCached('obDownBid', obDownBid, '—');
    setTextCached('obDownAsk', obDownAsk, '—');
    setTextCached('obSpreadBps', obSpreadBps, '—');
    setTextCached('obMid', obMid, '—');
    setTextCached('obRegime', obRegime, '—');
    setBarWidth(obUpBidBar, 0);
    setBarWidth(obUpAskBar, 0);
    setBarWidth(obDownBidBar, 0);
    setBarWidth(obDownAskBar, 0);
    if (obImbalanceFill) {
      obImbalanceFill.style.width = '0%';
      obImbalanceFill.style.left = '50%';
      obImbalanceFill.classList.remove('negative');
    }
    setAttrCached('obBidLineD', obBidLine, 'd', '');
    setAttrCached('obAskLineD', obAskLine, 'd', '');
    setAttrCached('obSpreadBandD', obSpreadBand, 'd', '');
    orderbookHistory.length = 0;
    lastOrderbookTs = 0;
  }

  if (state.edgeAnalysis) {
    const ea = state.edgeAnalysis;
    const useVolModel = getUseVolAdjustedModel();
    const linearEdge = (ea.oldLinearImpliedUp ?? ea.impliedUpFromBinance) - ea.polymarketAskUp;
    const selectedImpliedUp = useVolModel ? ea.impliedUpVolAdj : (ea.oldLinearImpliedUp ?? ea.impliedUpFromBinance);
    const selectedEdge = useVolModel ? ea.edge : linearEdge;

    setTextCached('priceToBeat', priceToBeat, ea.priceAtWindowStartChainlink && ea.priceAtWindowStartChainlink > 0
      ? formatPrice(ea.priceAtWindowStartChainlink)
      : '—');
    setTextCached('impliedUpBinance', impliedUpBinance, formatPct(selectedImpliedUp));
    setTextCached('impliedUpVol', impliedUpVol, formatPct(ea.impliedUpVolAdj));
    setTextCached('impliedUpLinear', impliedUpLinear, formatPct(ea.oldLinearImpliedUp ?? ea.impliedUpFromBinance));
    setTextCached('realizedVol', realizedVolEl, formatVol(ea.realizedVol));
    setTextCached('tauYears', tauYearsEl, formatTau(ea.tau));
    setTextCached('impliedUpChainlink', impliedUpChainlink, formatPct(ea.impliedUpFromChainlink));
    if (polymarketAskEl) {
      setTextCached('polymarketAsk', polymarketAskEl, formatPct(ea.polymarketAskUp ?? ea.polymarketUp));
    }
    setTextCached('edgeValue', edgeValue, (selectedEdge >= 0 ? '+' : '') + formatPct(selectedEdge));
    if (edgeLabel) {
      edgeLabel.textContent = useVolModel
        ? 'Edge (Vol-Adjusted implied − Up ask)'
        : 'Edge (Linear implied − Up ask)';
    }
    if (ea.polymarketSpreadBps !== undefined && ea.polymarketSpreadBps > 1000) {
      edgeValue.textContent += ' ⚠ wide spread';
    }
    if (edgeChainlinkEl && ea.edgeFromChainlink !== undefined) {
      setTextCached('edgeChainlink', edgeChainlinkEl, (ea.edgeFromChainlink >= 0 ? '+' : '') + formatPct(ea.edgeFromChainlink));
    }
    edgeWrap.classList.toggle('positive', selectedEdge > 0.01);
    edgeWrap.classList.toggle('negative', selectedEdge < -0.01);
    setTextCached('timeToRes', timeToRes, formatTime(ea.timeToResolution));
    const pmMidEl = document.getElementById('polymarket-up');
    if (pmMidEl) setTextCached('pmMid', pmMidEl, 'Polymarket mid: ' + formatPct(ea.polymarketUp));
  } else {
    setTextCached('priceToBeat', priceToBeat, '—');
    setTextCached('impliedUpBinance', impliedUpBinance, '—');
    setTextCached('impliedUpVol', impliedUpVol, '—');
    setTextCached('impliedUpLinear', impliedUpLinear, '—');
    setTextCached('realizedVol', realizedVolEl, '—');
    setTextCached('tauYears', tauYearsEl, '—');
    setTextCached('impliedUpChainlink', impliedUpChainlink, '—');
    const pmMidEl = document.getElementById('polymarket-up');
    if (pmMidEl) setTextCached('pmMid', pmMidEl, 'Polymarket mid: —');
    setTextCached('edgeValue', edgeValue, '—');
    if (edgeChainlinkEl) setTextCached('edgeChainlink', edgeChainlinkEl, '—');
    edgeWrap.classList.remove('positive', 'negative');
    setTextCached('timeToRes', timeToRes, '—');
  }

  if (state.paperTrading) {
    const pt = state.paperTrading;
    const bal = pt.balance;
    const initial = pt.initialBalance ?? 100;
    setTextCached('paperBalance', paperBalance, typeof bal === 'number' ? `$${bal.toFixed(2)}` : '—');
    paperBalance.className = 'paper-stat-value ' + (typeof bal === 'number' && bal >= initial ? 'positive' : 'negative');
    setTextCached('paperPnl', paperPnl, `$${pt.totalPnl.toFixed(2)}`);
    paperPnl.className = 'paper-stat-value ' + (pt.totalPnl >= 0 ? 'positive' : 'negative');
    setTextCached('paperTrades', paperTrades, `${pt.totalTrades} (${pt.wins}W / ${pt.losses}L)`);
    setTextCached('paperWinrate', paperWinrate, pt.totalTrades > 0 ? `${pt.winRate.toFixed(1)}%` : '—');

    if (paperByStrategyList && pt.byStrategy && Object.keys(pt.byStrategy).length > 0) {
      const sorted = Object.entries(pt.byStrategy)
        .sort(([, a], [, b]) => b.pnl - a.pnl);
      setHtmlCached('paperByStrategyList', paperByStrategyList, sorted
        .map(([, s]) => {
          const total = s.wins + s.losses;
          const wr = total > 0 ? ((s.wins / total) * 100).toFixed(1) : '—';
          const pnlClass = s.pnl >= 0 ? 'positive' : 'negative';
          const pf = Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : 'inf';
          return `<div class="paper-strategy-row"><span>${s.name}</span><span class="${pnlClass}">$${s.pnl.toFixed(2)}</span><span>${s.wins}W/${s.losses}L (${wr}%) PF:${pf}</span></div>`;
        })
        .join(''));
    } else if (paperByStrategyList) {
      setTextCached('paperByStrategyList', paperByStrategyList, 'No trades yet');
    }

    setTextCached('paperPositionsList', paperPositionsList, pt.positions.length
      ? pt.positions.map((p) => `${p.strategyId} ${p.side} @ ${(p.entryPrice * 100).toFixed(1)}% (${p.timeToResolutionAtEntry}s left)`).join('\n')
      : 'None');

    const allTrades = pt.trades ?? [];
    const visibleTrades = pt.recentTrades ?? allTrades.slice(-50);
    const tradesSignature = allTrades.map((t) => `${t.positionId}:${t.outcome}:${t.pnl.toFixed(4)}`).join('|');
    const health = computeHealthMetrics(allTrades);
    if (paperHealthGrid) {
      if (health) {
        const ratioText = health.winLossRatio !== null ? health.winLossRatio.toFixed(2) : '—';
        setHtmlCached('paperHealthGrid', paperHealthGrid, [
          `<div class="health-cell"><span>Expectancy / trade</span><strong class="${health.expectancy >= 0 ? 'positive' : 'negative'}">${formatMoney(health.expectancy)}</strong></div>`,
          `<div class="health-cell"><span>Avg win</span><strong class="positive">${formatMoney(health.avgWin)}</strong></div>`,
          `<div class="health-cell"><span>Avg loss (abs)</span><strong class="negative">$${health.avgLossMag.toFixed(2)}</strong></div>`,
          `<div class="health-cell"><span>Win/Loss ratio</span><strong>${ratioText}</strong></div>`,
          `<div class="health-cell"><span>Max drawdown</span><strong class="negative">$${health.maxDrawdown.toFixed(2)}</strong></div>`,
          `<div class="health-cell"><span>Rolling 50 PnL</span><strong class="${health.last50Pnl >= 0 ? 'positive' : 'negative'}">${formatMoney(health.last50Pnl)}</strong></div>`,
          `<div class="health-cell"><span>Rolling 50 win rate</span><strong>${health.last50WinRate.toFixed(1)}% (${health.last50Count})</strong></div>`,
          `<div class="health-cell"><span>Sample size</span><strong>${health.sampleSize}</strong></div>`,
        ].join(''));
      } else {
        setTextCached('paperHealthGrid', paperHealthGrid, 'No trades yet');
      }
    }

    if (tradesSignature !== lastTradesSignature) {
      lastTradesSignature = tradesSignature;
      const priceBuckets = bucketBy(allTrades as SegmentTrade[], (t) => {
        if (t.entryPrice < 0.8) return '<0.80';
        if (t.entryPrice < 0.9) return '0.80-0.90';
        if (t.entryPrice < 0.95) return '0.90-0.95';
        return '0.95-1.00';
      });
      const ttrBuckets = bucketBy(allTrades as SegmentTrade[], (t) => {
        const s = t.timeToResolutionAtEntry ?? 0;
        if (s < 10) return '<10s';
        if (s < 20) return '10-20s';
        if (s < 40) return '20-40s';
        return '40s+';
      });
      const collapseBuckets = bucketBy(allTrades as SegmentTrade[], (t) => t.collapseType);

      setHtmlCached('paperSegmentPrice', paperSegmentPrice, summarizeSegment(priceBuckets));
      setHtmlCached('paperSegmentTtr', paperSegmentTtr, summarizeSegment(ttrBuckets));
      setHtmlCached('paperSegmentCollapse', paperSegmentCollapse, summarizeSegment(collapseBuckets));

      const strategyNames: Record<string, string> = {};
      if (pt.byStrategy) {
        for (const [id, s] of Object.entries(pt.byStrategy)) strategyNames[id] = s.name;
      }
      setHtmlCached('paperTradesContent', paperTradesContent, visibleTrades.length
        ? visibleTrades.slice().reverse().map((t) =>
            `<div class="paper-trade-row ${t.outcome}"><span>${strategyNames[t.strategyId] ?? t.strategyId} ${t.side} ${t.outcome}</span><span>$${t.pnl.toFixed(2)}</span></div>`
          ).join('')
        : 'None yet');
    }

  } else {
    setTextCached('paperBalance', paperBalance, '—');
    setTextCached('paperPnl', paperPnl, '—');
    setTextCached('paperTrades', paperTrades, '—');
    setTextCached('paperWinrate', paperWinrate, '—');
    if (paperByStrategyList) setTextCached('paperByStrategyList', paperByStrategyList, '—');
    if (paperHealthGrid) setTextCached('paperHealthGrid', paperHealthGrid, '—');
    if (paperSegmentPrice) setTextCached('paperSegmentPrice', paperSegmentPrice, '—');
    if (paperSegmentTtr) setTextCached('paperSegmentTtr', paperSegmentTtr, '—');
    if (paperSegmentCollapse) setTextCached('paperSegmentCollapse', paperSegmentCollapse, '—');
    setTextCached('paperPositionsList', paperPositionsList, '—');
    setTextCached('paperTradesContent', paperTradesContent, '—');
    lastTradesSignature = '';
  }
}

async function poll() {
  const state = await fetchState();
  render(state);
}

poll();
setInterval(poll, POLL_MS);

async function doReset() {
  const urls = ['/api/paper/clear', 'http://localhost:3847/api/paper/clear'];
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'POST' });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (res.ok && (data.ok || data.cleared)) {
        const state = await fetchState();
        render(state);
        return;
      }
    } catch {
      continue;
    }
  }
  console.error('Reset failed - try restarting the server');
}

const modelToggle = document.getElementById('model-toggle') as HTMLInputElement | null;
if (modelToggle) {
  modelToggle.checked = getUseVolAdjustedModel();
  modelToggle.addEventListener('change', () => {
    setUseVolAdjustedModel(modelToggle.checked);
  });
}

document.getElementById('paper-clear-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('paper-clear-btn');
  if (btn) btn.disabled = true;
  try {
    await doReset();
  } finally {
    if (btn) btn.disabled = false;
  }
});
