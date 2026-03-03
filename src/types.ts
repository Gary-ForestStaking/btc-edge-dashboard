/** Binance Futures trade event */
export interface BinanceTradeEvent {
  type: 'binance_trade';
  symbol: string;
  price: number;
  quantity: number;
  timestamp: number;
  tradeId: string;
}

/** Polymarket 5-min market update */
export interface PolymarketUpdateEvent {
  type: 'polymarket_update';
  slug: string;
  windowStart: number;  // Unix seconds
  windowEnd: number;
  upPrice: number;     // Midpoint (bid+ask)/2 for Up
  downPrice: number;   // Probability of Down (0-1)
  bestBidUp: number;   // Best bid for Up token
  bestAskUp: number;   // Best ask for Up token (price to buy Up)
  timestamp: number;
}

/** Polymarket Chainlink price (resolution source for 5m markets) */
export interface PolymarketPriceEvent {
  type: 'polymarket_price';
  symbol: string;
  price: number;
  timestamp: number;
}

/** Combined feed event for edge analysis */
export interface FeedEvent {
  type: 'binance_trade' | 'polymarket_update';
  payload: BinanceTradeEvent | PolymarketUpdateEvent;
  receivedAt: number;
}

/** Current market state for dashboard */
export interface MarketState {
  binance: {
    lastPrice: number;
    lastUpdate: number;
    tradeCount: number;
  };
  polymarketPrice: {
    price: number;       // Chainlink BTC/USD - Polymarket's resolution source
    lastUpdate: number;
  } | null;
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
}

/** Edge analysis result */
export interface EdgeAnalysis {
  impliedUpFromBinance: number;
  impliedUpVolAdj: number;
  oldLinearImpliedUp: number;
  impliedUpFromChainlink: number;
  polymarketUp: number;           // Midpoint (display)
  polymarketAskUp: number;        // Price to buy Up (used for edge)
  edge: number;                   // Binance implied − polymarketAskUp (leading indicator)
  edgeFromChainlink?: number;     // Chainlink implied − polymarketAskUp (for comparison)
  polymarketSpreadBps?: number;    // (ask - bid) in bps, for illiquidity check
  realizedVol?: number;
  tau?: number;
  timeToResolution: number;
  priceAtWindowStartBinance?: number;
  priceAtWindowStartChainlink?: number;
  binanceChainlinkSpread?: number;
  binanceChainlinkSpreadBps?: number;
}
