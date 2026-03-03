import WebSocket from 'ws';
import { feedEvents } from '../events.js';

const PM_RTDS = 'wss://ws-live-data.polymarket.com';
const PING_MS = 5000;

/** Polymarket uses Chainlink BTC/USD for resolution - this is that feed */
export function startPolymarketPriceFeed(): () => void {
  let ws: WebSocket | null = null;
  let pingInterval: ReturnType<typeof setInterval> | null = null;

  const connect = () => {
    ws = new WebSocket(PM_RTDS);

    ws.on('open', () => {
      ws!.send(JSON.stringify({
        action: 'subscribe',
        subscriptions: [{
          topic: 'crypto_prices_chainlink',
          type: '*',
          filters: '',
        }],
      }));
      console.log('[Polymarket] Chainlink price feed connected');
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        const payload = msg.payload ?? msg;
        const symbol = (payload.symbol ?? '').toLowerCase();
        const value = typeof payload.value === 'number' ? payload.value : parseFloat(payload.value);
        if ((symbol === 'btc/usd' || symbol === 'btcusd') && !isNaN(value) && value > 0) {
          feedEvents.emit('polymarket_price', {
            type: 'polymarket_price',
            symbol: 'btc/usd',
            price: value,
            timestamp: payload.timestamp ?? msg.timestamp ?? Date.now(),
          });
        }
      } catch {
        // ignore
      }
    });

    ws.on('close', () => {
      console.log('[Polymarket] Price feed disconnected, reconnecting in 3s...');
      setTimeout(connect, 3000);
    });

    ws.on('error', (err) => {
      console.error('[Polymarket] Price feed error:', err.message);
    });
  };

  connect();
  pingInterval = setInterval(() => {
    if (ws?.readyState === 1) ws.send('PING');
  }, PING_MS);

  return () => {
    if (pingInterval) clearInterval(pingInterval);
    ws?.close();
  };
}
