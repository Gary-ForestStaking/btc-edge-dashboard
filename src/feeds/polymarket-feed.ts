import WebSocket from 'ws';
import { feedEvents } from '../events.js';
import {
  getCurrentWindowStart,
  getMarketSlug,
  getNextWindowStart,
  msUntilNextWindow,
  secondsUntilWindowEnd,
} from './polymarket-utils.js';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const PM_WS = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const PING_MS = 5000; // Keep WebSocket alive

interface PolymarketEvent {
  slug: string;
  markets: Array<{
    slug: string;
    endDate: string;
    eventStartTime?: string;
    outcomePrices: string;
    bestBid?: number;
    bestAsk?: number;
    clobTokenIds: string;
    outcomes?: string;
  }>;
}

interface MarketContext {
  slug: string;
  windowStart: number;
  windowEnd: number;
  upTokenId: string;
  downTokenId: string;
}

async function fetchMarket(slug: string): Promise<PolymarketEvent | null> {
  try {
    const res = await fetch(`${GAMMA_API}/events?slug=${slug}`);
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch (e) {
    console.error('[Polymarket] Fetch error:', e);
    return null;
  }
}

function parseOutcomePrices(outcomePrices: string): [number, number] {
  try {
    const arr = JSON.parse(outcomePrices) as [string, string];
    return [parseFloat(arr[0] ?? '0.5'), parseFloat(arr[1] ?? '0.5')];
  } catch {
    return [0.5, 0.5];
  }
}

function parseTokenIds(clobTokenIds: string): [string, string] {
  try {
    const arr = JSON.parse(clobTokenIds) as [string, string];
    return [arr[0] ?? '', arr[1] ?? ''];
  } catch {
    return ['', ''];
  }
}

function parseWindowTimes(event: PolymarketEvent): { start: number; end: number } {
  const m = event.markets?.[0];
  const endDate = m?.endDate ? new Date(m.endDate).getTime() / 1000 : 0;
  const startDate = m?.eventStartTime
    ? new Date(m.eventStartTime).getTime() / 1000
    : endDate - 300;
  return { start: Math.floor(startDate), end: Math.floor(endDate) };
}

function emitUpdate(
  ctx: MarketContext,
  upPrice: number,
  downPrice: number,
  bestBidUp: number,
  bestAskUp: number,
) {
  feedEvents.emit('polymarket_update', {
    type: 'polymarket_update',
    slug: ctx.slug,
    windowStart: ctx.windowStart,
    windowEnd: ctx.windowEnd,
    upPrice,
    downPrice,
    bestBidUp,
    bestAskUp,
    timestamp: Date.now(),
  });
}

export function startPolymarketFeed(): () => void {
  let nextWindowTimeout: ReturnType<typeof setTimeout> | null = null;
  let ws: WebSocket | null = null;
  let pingInterval: ReturnType<typeof setInterval> | null = null;
  let ctx: MarketContext | null = null;
  let upPrice = 0.5;
  let downPrice = 0.5;
  let bestBidUp = 0.5;
  let bestAskUp = 0.5;

  const connectWs = (upTokenId: string, downTokenId: string) => {
    if (ws) ws.close();
    ws = new WebSocket(PM_WS);

    ws.on('open', () => {
      ws!.send(JSON.stringify({
        assets_ids: [upTokenId, downTokenId],
        type: 'market',
        custom_feature_enabled: true,
      }));
      console.log('[Polymarket] WebSocket connected, subscribed to market');
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (!ctx) return;

        if (msg.event_type === 'best_bid_ask') {
          const bid = parseFloat(msg.best_bid ?? '0');
          const ask = parseFloat(msg.best_ask ?? '1');
          if (msg.asset_id === ctx.upTokenId) {
            bestBidUp = bid;
            bestAskUp = ask;
            upPrice = (bid + ask) / 2;
            downPrice = 1 - upPrice;
            emitUpdate(ctx, upPrice, downPrice, bestBidUp, bestAskUp);
          } else if (msg.asset_id === ctx.downTokenId) {
            const downMid = (bid + ask) / 2;
            upPrice = 1 - downMid;
            downPrice = downMid;
            bestBidUp = 1 - ask;
            bestAskUp = 1 - bid;
            emitUpdate(ctx, upPrice, downPrice, bestBidUp, bestAskUp);
          }
        } else if (msg.event_type === 'price_change') {
          for (const pc of msg.price_changes ?? []) {
            const bid = parseFloat(String(pc.best_bid ?? '0'));
            const ask = parseFloat(String(pc.best_ask ?? '1'));
            if (pc.asset_id === ctx.upTokenId && (bid > 0 || ask > 0)) {
              bestBidUp = bid;
              bestAskUp = ask;
              upPrice = (bid + ask) / 2;
              downPrice = 1 - upPrice;
              emitUpdate(ctx, upPrice, downPrice, bestBidUp, bestAskUp);
            } else if (pc.asset_id === ctx.downTokenId && (bid > 0 || ask > 0)) {
              const downMid = (bid + ask) / 2;
              upPrice = 1 - downMid;
              downPrice = downMid;
              bestBidUp = 1 - ask;
              bestAskUp = 1 - bid;
              emitUpdate(ctx, upPrice, downPrice, bestBidUp, bestAskUp);
            }
          }
        } else if (msg.event_type === 'book') {
          const bids = msg.bids ?? [];
          const asks = msg.asks ?? [];
          const topBid = bids.length ? parseFloat(bids[0]?.price ?? '0') : 0;
          const topAsk = asks.length ? parseFloat(asks[0]?.price ?? '1') : 1;
          if (msg.asset_id === ctx.upTokenId) {
            bestBidUp = topBid;
            bestAskUp = topAsk;
            upPrice = (topBid + topAsk) / 2;
            downPrice = 1 - upPrice;
            emitUpdate(ctx, upPrice, downPrice, bestBidUp, bestAskUp);
          } else if (msg.asset_id === ctx.downTokenId) {
            const downMid = (topBid + topAsk) / 2;
            upPrice = 1 - downMid;
            downPrice = downMid;
            bestBidUp = 1 - topAsk;
            bestAskUp = 1 - topBid;
            emitUpdate(ctx, upPrice, downPrice, bestBidUp, bestAskUp);
          }
        }
      } catch (e) {
        // ignore parse errors
      }
    });

    ws.on('close', () => {
      console.log('[Polymarket] WebSocket closed');
    });

    ws.on('error', (err) => {
      console.error('[Polymarket] WebSocket error:', err.message);
    });
  };

  /** Fetch market from Gamma when window changes - event-driven by 5-min boundary */
  const fetchAndSubscribe = async () => {
    const windowStart = getCurrentWindowStart();
    const slugsToTry = [
      getMarketSlug(windowStart),
      getMarketSlug(getNextWindowStart(windowStart)),
    ];

    for (const slug of slugsToTry) {
      const event = await fetchMarket(slug);
      if (!event) continue;

      const { start, end } = parseWindowTimes(event);
      const m = event.markets?.[0];
      if (!m) continue;

      const [upTokenId, downTokenId] = parseTokenIds(m.clobTokenIds);
      if (!upTokenId || !downTokenId) continue;

      const newCtx: MarketContext = { slug, windowStart: start, windowEnd: end, upTokenId, downTokenId };

      if (!ctx || ctx.slug !== slug) {
        ctx = newCtx;
        const [up, down] = parseOutcomePrices(m.outcomePrices);
        upPrice = up;
        downPrice = down;
        bestBidUp = m.bestBid ?? upPrice;
        bestAskUp = m.bestAsk ?? upPrice;
        emitUpdate(ctx, upPrice, downPrice, bestBidUp, bestAskUp);
        connectWs(upTokenId, downTokenId);
      }
      break;
    }
  };

  const scheduleNextWindow = () => {
    const ms = msUntilNextWindow();
    nextWindowTimeout = setTimeout(() => {
      fetchAndSubscribe();
      scheduleNextWindow();
    }, ms + 100); // +100ms to ensure we're past the boundary
  };

  fetchAndSubscribe();
  scheduleNextWindow();

  pingInterval = setInterval(() => {
    if (ws?.readyState === 1) ws.send('PING');
  }, PING_MS);

  return () => {
    if (nextWindowTimeout) clearTimeout(nextWindowTimeout);
    if (pingInterval) clearInterval(pingInterval);
    ws?.close();
  };
}

export { secondsUntilWindowEnd };
