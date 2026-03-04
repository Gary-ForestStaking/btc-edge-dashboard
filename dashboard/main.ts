// Use proxy when running via Vite dev server
const API_URL = '/api/state';
const POLL_MS = 500;

interface ApiState {
  binance: { lastPrice: number; lastUpdate: number; tradeCount: number };
  polymarketPrice: { price: number; lastUpdate: number } | null;
  polymarket: {
    slug: string;
    windowStart: number;
    windowEnd: number;
    upPrice: number;
    downPrice: number;
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
    trades: Array<{ strategyId: string; side: string; outcome: string; pnl: number }>;
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
  const paperPositionsList = document.getElementById('paper-positions-list')!;
  const paperTradesContent = document.getElementById('paper-trades-content')!;

  if (!state) {
    statusEl.textContent = 'Disconnected';
    statusEl.classList.remove('live');
    return;
  }

  statusEl.textContent = 'Live';
  statusEl.classList.add('live');

  binancePrice.textContent = formatPrice(state.binance.lastPrice);
  chainlinkPrice.textContent = state.polymarketPrice
    ? formatPrice(state.polymarketPrice.price)
    : '—';

  if (state.edgeAnalysis?.binanceChainlinkSpread !== undefined) {
    const { binanceChainlinkSpread, binanceChainlinkSpreadBps } = state.edgeAnalysis;
    spreadValue.textContent = formatSpread(binanceChainlinkSpread, binanceChainlinkSpreadBps);
    spreadRow.classList.toggle('positive', (binanceChainlinkSpread ?? 0) > 0);
    spreadRow.classList.toggle('negative', (binanceChainlinkSpread ?? 0) < 0);
  } else {
    spreadValue.textContent = '—';
    spreadRow.classList.remove('positive', 'negative');
  }

  if (state.polymarket) {
    const pm = state.polymarket;
    pmWindow.textContent = formatWindow(pm.windowStart) + ' – ' + formatWindow(pm.windowEnd);
    pmUp.textContent = formatPct(pm.upPrice);
    pmDown.textContent = formatPct(pm.downPrice);
    pmMeta.textContent = pm.slug;
  } else {
    pmWindow.textContent = '—';
    pmUp.textContent = '—';
    pmDown.textContent = '—';
    pmMeta.textContent = 'Waiting for market...';
  }

  if (state.edgeAnalysis) {
    const ea = state.edgeAnalysis;
    const useVolModel = getUseVolAdjustedModel();
    const linearEdge = (ea.oldLinearImpliedUp ?? ea.impliedUpFromBinance) - ea.polymarketAskUp;
    const selectedImpliedUp = useVolModel ? ea.impliedUpVolAdj : (ea.oldLinearImpliedUp ?? ea.impliedUpFromBinance);
    const selectedEdge = useVolModel ? ea.edge : linearEdge;

    priceToBeat.textContent = ea.priceAtWindowStartChainlink && ea.priceAtWindowStartChainlink > 0
      ? formatPrice(ea.priceAtWindowStartChainlink)
      : '—';
    impliedUpBinance.textContent = formatPct(selectedImpliedUp);
    impliedUpVol.textContent = formatPct(ea.impliedUpVolAdj);
    impliedUpLinear.textContent = formatPct(ea.oldLinearImpliedUp ?? ea.impliedUpFromBinance);
    realizedVolEl.textContent = formatVol(ea.realizedVol);
    tauYearsEl.textContent = formatTau(ea.tau);
    impliedUpChainlink.textContent = formatPct(ea.impliedUpFromChainlink);
    if (polymarketAskEl) {
      polymarketAskEl.textContent = formatPct(ea.polymarketAskUp ?? ea.polymarketUp);
    }
    edgeValue.textContent = (selectedEdge >= 0 ? '+' : '') + formatPct(selectedEdge);
    if (edgeLabel) {
      edgeLabel.textContent = useVolModel
        ? 'Edge (Vol-Adjusted implied − Up ask)'
        : 'Edge (Linear implied − Up ask)';
    }
    if (ea.polymarketSpreadBps !== undefined && ea.polymarketSpreadBps > 1000) {
      edgeValue.textContent += ' ⚠ wide spread';
    }
    if (edgeChainlinkEl && ea.edgeFromChainlink !== undefined) {
      edgeChainlinkEl.textContent = (ea.edgeFromChainlink >= 0 ? '+' : '') + formatPct(ea.edgeFromChainlink);
    }
    edgeWrap.classList.toggle('positive', selectedEdge > 0.01);
    edgeWrap.classList.toggle('negative', selectedEdge < -0.01);
    timeToRes.textContent = formatTime(ea.timeToResolution);
    const pmMidEl = document.getElementById('polymarket-up');
    if (pmMidEl) pmMidEl.textContent = 'Polymarket mid: ' + formatPct(ea.polymarketUp);
  } else {
    priceToBeat.textContent = '—';
    impliedUpBinance.textContent = '—';
    impliedUpVol.textContent = '—';
    impliedUpLinear.textContent = '—';
    realizedVolEl.textContent = '—';
    tauYearsEl.textContent = '—';
    impliedUpChainlink.textContent = '—';
    const pmMidEl = document.getElementById('polymarket-up');
    if (pmMidEl) pmMidEl.textContent = 'Polymarket mid: —';
    edgeValue.textContent = '—';
    if (edgeChainlinkEl) edgeChainlinkEl.textContent = '—';
    edgeWrap.classList.remove('positive', 'negative');
    timeToRes.textContent = '—';
    const pmMidEl2 = document.getElementById('polymarket-up');
    if (pmMidEl2) pmMidEl2.textContent = 'Polymarket mid: —';
  }

  if (state.paperTrading) {
    const pt = state.paperTrading;
    const bal = pt.balance;
    const initial = pt.initialBalance ?? 100;
    paperBalance.textContent = typeof bal === 'number' ? `$${bal.toFixed(2)}` : '—';
    paperBalance.className = 'paper-stat-value ' + (typeof bal === 'number' && bal >= initial ? 'positive' : 'negative');
    paperPnl.textContent = `$${pt.totalPnl.toFixed(2)}`;
    paperPnl.className = 'paper-stat-value ' + (pt.totalPnl >= 0 ? 'positive' : 'negative');
    paperTrades.textContent = `${pt.totalTrades} (${pt.wins}W / ${pt.losses}L)`;
    paperWinrate.textContent = pt.totalTrades > 0 ? `${pt.winRate.toFixed(1)}%` : '—';

    if (paperByStrategyList && pt.byStrategy && Object.keys(pt.byStrategy).length > 0) {
      const sorted = Object.entries(pt.byStrategy)
        .sort(([, a], [, b]) => b.pnl - a.pnl);
      paperByStrategyList.innerHTML = sorted
        .map(([, s]) => {
          const total = s.wins + s.losses;
          const wr = total > 0 ? ((s.wins / total) * 100).toFixed(1) : '—';
          const pnlClass = s.pnl >= 0 ? 'positive' : 'negative';
          const pf = Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : 'inf';
          return `<div class="paper-strategy-row"><span>${s.name}</span><span class="${pnlClass}">$${s.pnl.toFixed(2)}</span><span>${s.wins}W/${s.losses}L (${wr}%) PF:${pf}</span></div>`;
        })
        .join('');
    } else if (paperByStrategyList) {
      paperByStrategyList.textContent = 'No trades yet';
    }

    paperPositionsList.textContent = pt.positions.length
      ? pt.positions.map((p) => `${p.strategyId} ${p.side} @ ${(p.entryPrice * 100).toFixed(1)}% (${p.timeToResolutionAtEntry}s left)`).join('\n')
      : 'None';

    const visibleTrades = pt.trades ?? [];

    const strategyNames: Record<string, string> = {};
    if (pt.byStrategy) {
      for (const [id, s] of Object.entries(pt.byStrategy)) strategyNames[id] = s.name;
    }
    paperTradesContent.innerHTML = visibleTrades.length
      ? visibleTrades.slice().reverse().map((t) =>
          `<div class="paper-trade-row ${t.outcome}"><span>${strategyNames[t.strategyId] ?? t.strategyId} ${t.side} ${t.outcome}</span><span>$${t.pnl.toFixed(2)}</span></div>`
        ).join('')
      : 'None yet';
  } else {
    paperBalance.textContent = '—';
    paperPnl.textContent = '—';
    paperTrades.textContent = '—';
    paperWinrate.textContent = '—';
    if (paperByStrategyList) paperByStrategyList.textContent = '—';
    paperPositionsList.textContent = '—';
    paperTradesContent.textContent = '—';
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
