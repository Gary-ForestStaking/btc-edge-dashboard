import { createServer } from 'http';
import { startBinanceFeed } from './feeds/binance-feed.js';
import { startPolymarketFeed } from './feeds/polymarket-feed.js';
import { startPolymarketPriceFeed } from './feeds/polymarket-price-feed.js';
import { state, getEdgeAnalysis } from './state.js';
import { getPaperTradingState, clearPaperTrading } from './paper-trading/engine.js';

const PORT = 3847;

// Start all feeds
const stopBinance = startBinanceFeed();
const stopPolymarket = startPolymarketFeed();
const stopPolymarketPrice = startPolymarketPriceFeed();

// HTTP server for dashboard API
const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const path = req.url?.split('?')[0] ?? '';
  if ((path === '/api/paper/clear' || path === '/api/paper/clear/') && (req.method === 'POST' || req.method === 'GET')) {
    clearPaperTrading();
    res.end(JSON.stringify({ ok: true, cleared: true }));
    return;
  }

  if (path === '/api/state' && req.method === 'GET') {
    const edge = getEdgeAnalysis();
    const paper = getPaperTradingState();
    res.end(
      JSON.stringify({
        ...state,
        edgeAnalysis: edge,
        paperTrading: paper,
        serverTime: Date.now(),
      })
    );
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`Feed server + API running at http://localhost:${PORT}`);
  console.log(`API: GET http://localhost:${PORT}/api/state`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  stopBinance();
  stopPolymarket();
  stopPolymarketPrice();
  server.close();
  process.exit(0);
});
