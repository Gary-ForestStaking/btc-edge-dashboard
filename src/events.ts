import { EventEmitter } from 'eventemitter3';
import type { BinanceTradeEvent, PolymarketUpdateEvent, PolymarketPriceEvent } from './types.js';

export type FeedEventType = 'binance_trade' | 'polymarket_update' | 'polymarket_price';

export interface FeedEvents {
  binance_trade: (event: BinanceTradeEvent) => void;
  polymarket_update: (event: PolymarketUpdateEvent) => void;
  polymarket_price: (event: PolymarketPriceEvent) => void;
}

/** Central event bus - non-monolithic, each feed emits independently */
export const feedEvents = new EventEmitter<FeedEvents>();
