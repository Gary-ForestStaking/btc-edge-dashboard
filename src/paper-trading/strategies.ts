import type { StrategyConfig } from './types.js';

export const STRATEGIES: StrategyConfig[] = [
  {
    id: 'late-anchor',
    name: 'Late Anchor',
    mode: 'late-anchor',
    minEdge: 0,
    maxTimeToResolution: 30,
    minTimeToResolution: 5,
    requireSpreadConfirm: false,
    sizeInDollars: 5,
  },
];
