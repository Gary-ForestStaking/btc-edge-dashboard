import { createServer } from 'http';
import { startBinanceFeed } from './feeds/binance-feed.js';
import { startPolymarketFeed } from './feeds/polymarket-feed.js';
import { startPolymarketPriceFeed } from './feeds/polymarket-price-feed.js';
import { state, getEdgeAnalysis } from './state.js';

const PORT = 3847;

// Start all feeds
const stopBinance = startBinanceFeed();
const stopPolymarket = startPolymarketFeed();
const stopPolymarketPrice = startPolymarketPriceFeed();

// HTTP server for dashboard API
const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/api/state' && req.method === 'GET') {
    const edge = getEdgeAnalysis();
    res.end(
      JSON.stringify({
        ...state,
        edgeAnalysis: edge,
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
