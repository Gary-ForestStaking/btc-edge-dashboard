export type Side = 'Up' | 'Down';

export type StrategyMode =
  | 'default'
  | 'early-edge'
  | 'agreement'
  | 'no-trade-zone'
  | 'window-phase'
  | 'consensus';

export interface StrategyConfig {
  id: string;
  name: string;
  mode?: StrategyMode;       // default | early-edge | agreement
  minEdge: number;           // e.g. 0.08 = 8%
  maxTimeToResolution: number;  // seconds, e.g. 90
  minTimeToResolution?: number; // optional: don't trade in last N seconds
  requireSpreadConfirm?: boolean;  // Binance-Chainlink spread must agree
  maxSpreadBps?: number;     // max abs spread to allow (avoid divergence)
  size?: number;             // shares per trade (legacy)
  sizeInDollars?: number;    // dollars per trade (e.g. 5)
}

export interface PaperPosition {
  id: string;
  strategyId: string;
  windowSlug: string;
  side: Side;
  entryPrice: number;
  size: number;
  entryTime: number;
  timeToResolutionAtEntry: number;
  edgeAtEntry: number;
  impliedUpAtEntry: number;
  priceAtWindowStartChainlink: number;  // for resolution
}

export interface PaperTrade {
  positionId: string;
  strategyId: string;
  windowSlug: string;
  side: Side;
  entryPrice: number;
  size: number;
  exitPrice: number;   // 1 if won, 0 if lost
  pnl: number;
  resolvedAt: number;
  outcome: 'win' | 'loss';
}

export interface PaperTradingState {
  positions: PaperPosition[];
  trades: PaperTrade[];
  totalPnl: number;
  wins: number;
  losses: number;
}
