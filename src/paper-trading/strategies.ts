import type { StrategyConfig } from './types.js';

export const STRATEGIES: StrategyConfig[] = [
  {
    id: 'early-edge',
    name: 'Early Edge',
    mode: 'early-edge',
    minEdge: 0.08,
    maxTimeToResolution: 110,
    minTimeToResolution: 30,
    requireSpreadConfirm: true,
    sizeInDollars: 5,
  },
  {
    id: 'no-trade-zone',
    name: 'No-Trade Zone',
    mode: 'no-trade-zone',
    minEdge: 0.09,
    maxTimeToResolution: 110,
    minTimeToResolution: 30,
    requireSpreadConfirm: true,
    sizeInDollars: 5,
  },
  {
    id: 'window-phase',
    name: 'Window Phase',
    mode: 'window-phase',
    minEdge: 0.08,
    maxTimeToResolution: 160,
    minTimeToResolution: 30,
    requireSpreadConfirm: true,
    sizeInDollars: 5,
  },
  {
    id: 'agreement',
    name: 'Agreement',
    mode: 'agreement',
    minEdge: 0.07,
    maxTimeToResolution: 110,
    minTimeToResolution: 25,
    requireSpreadConfirm: true,
    sizeInDollars: 5,
  },
];
