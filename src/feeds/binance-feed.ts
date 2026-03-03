import WebSocket from 'ws';
import { feedEvents } from '../events.js';

const BINANCE_WS = 'wss://fstream.binance.com/ws/btcusdt@trade';

export function startBinanceFeed(): () => void {
  let ws: WebSocket | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    ws = new WebSocket(BINANCE_WS);

    ws.on('open', () => {
      console.log('[Binance] Connected to BTC/USDT perpetual');
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.e === 'trade') {
          feedEvents.emit('binance_trade', {
            type: 'binance_trade',
            symbol: msg.s ?? 'btcusdt',
            price: parseFloat(msg.p),
            quantity: parseFloat(msg.q),
            timestamp: msg.T,
            tradeId: String(msg.t),
          });
        }
      } catch (e) {
        console.error('[Binance] Parse error:', e);
      }
    });

    ws.on('close', () => {
      console.log('[Binance] Disconnected, reconnecting in 3s...');
      reconnectTimeout = setTimeout(connect, 3000);
    });

    ws.on('error', (err) => {
      console.error('[Binance] Error:', err.message);
    });
  };

  connect();

  return () => {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    ws?.close();
  };
}
