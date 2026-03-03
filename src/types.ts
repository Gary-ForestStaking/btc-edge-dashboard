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
  upPrice: number;     // Probability of Up (0-1)
  downPrice: number;   // Probability of Down (0-1)
  bestBid: number;
  bestAsk: number;
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
    lastUpdate: number;
  } | null;
}

/** Edge analysis result */
export interface EdgeAnalysis {
  impliedUpFromBinance: number;
  impliedUpFromChainlink: number;
  polymarketUp: number;
  edge: number;
  timeToResolution: number;
  priceAtWindowStartBinance?: number;
  priceAtWindowStartChainlink?: number;
  binanceChainlinkSpread?: number;
  binanceChainlinkSpreadBps?: number;
}
