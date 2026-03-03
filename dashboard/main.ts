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
    impliedUpFromChainlink: number;
    polymarketUp: number;
    edge: number;
    timeToResolution: number;
    priceAtWindowStartBinance?: number;
    priceAtWindowStartChainlink?: number;
    binanceChainlinkSpread?: number;
    binanceChainlinkSpreadBps?: number;
  } | null;
  serverTime: number;
}

function formatPrice(n: number): string {
  return n > 0 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
}

function formatPct(n: number): string {
  return (n * 100).toFixed(1) + '%';
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
  const impliedUpChainlink = document.getElementById('implied-up-chainlink')!;
  const polymarketUp = document.getElementById('polymarket-up')!;
  const edgeValue = document.getElementById('edge-value')!;
  const edgeWrap = document.getElementById('edge-value-wrap')!;
  const timeToRes = document.getElementById('time-to-res')!;

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
    priceToBeat.textContent = ea.priceAtWindowStartChainlink && ea.priceAtWindowStartChainlink > 0
      ? formatPrice(ea.priceAtWindowStartChainlink)
      : '—';
    impliedUpBinance.textContent = formatPct(ea.impliedUpFromBinance);
    impliedUpChainlink.textContent = formatPct(ea.impliedUpFromChainlink);
    polymarketUp.textContent = formatPct(ea.polymarketUp);
    edgeValue.textContent = (ea.edge >= 0 ? '+' : '') + formatPct(ea.edge);
    edgeWrap.classList.toggle('positive', ea.edge > 0.01);
    edgeWrap.classList.toggle('negative', ea.edge < -0.01);
    timeToRes.textContent = formatTime(ea.timeToResolution);
  } else {
    priceToBeat.textContent = '—';
    impliedUpBinance.textContent = '—';
    impliedUpChainlink.textContent = '—';
    polymarketUp.textContent = '—';
    edgeValue.textContent = '—';
    edgeWrap.classList.remove('positive', 'negative');
    timeToRes.textContent = '—';
  }
}

async function poll() {
  const state = await fetchState();
  render(state);
}

poll();
setInterval(poll, POLL_MS);
