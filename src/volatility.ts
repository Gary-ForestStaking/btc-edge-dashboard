const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
const MIN_SIGMA = 1e-6;
const MIN_TAU = 1e-12;

interface ReturnPoint {
  tsMs: number;
  value: number;
}

/** Rolling realized volatility from log returns over a fixed window. */
export class RollingRealizedVolatility {
  private readonly windowMs: number;
  private readonly returns: ReturnPoint[] = [];
  private sum = 0;
  private sumSq = 0;
  private lastPrice = 0;

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  addPrice(price: number, tsMs: number): void {
    if (price <= 0) return;

    if (this.lastPrice > 0) {
      const r = Math.log(price / this.lastPrice);
      this.returns.push({ tsMs, value: r });
      this.sum += r;
      this.sumSq += r * r;
    }

    this.lastPrice = price;
    this.prune(tsMs);
  }

  getAnnualizedVol(tsMs: number): number {
    this.prune(tsMs);
    const n = this.returns.length;
    if (n < 2) return 0;

    const mean = this.sum / n;
    const variance = Math.max(0, (this.sumSq / n) - (mean * mean));
    const stdDev = Math.sqrt(variance);
    return stdDev * Math.sqrt(SECONDS_PER_YEAR);
  }

  private prune(tsMs: number): void {
    const minTs = tsMs - this.windowMs;
    while (this.returns.length > 0 && this.returns[0].tsMs < minTs) {
      const old = this.returns.shift();
      if (!old) break;
      this.sum -= old.value;
      this.sumSq -= old.value * old.value;
    }
  }
}

/** Fast normal CDF approximation with stable tails. */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  if (z <= -10) return 0;
  if (z >= 10) return 1;

  // Abramowitz-Stegun erf approximation.
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const poly = (((((a5 * t) + a4) * t + a3) * t + a2) * t + a1) * t;
  const erf = 1 - (poly * Math.exp(-x * x));
  const sign = z < 0 ? -1 : 1;
  const cdf = 0.5 * (1 + sign * erf);
  return Math.min(1, Math.max(0, cdf));
}

export function tauYearsFromSeconds(timeToResolutionSeconds: number): number {
  return Math.max(MIN_TAU, timeToResolutionSeconds / SECONDS_PER_YEAR);
}

export function impliedUpVolAdjusted(
  currentPrice: number,
  startPrice: number,
  annualizedVol: number,
  timeToResolutionSeconds: number,
): number {
  if (currentPrice <= 0 || startPrice <= 0) return 0.5;
  const tau = tauYearsFromSeconds(timeToResolutionSeconds);
  const sigma = Math.max(MIN_SIGMA, annualizedVol);
  const z = Math.log(currentPrice / startPrice) / (sigma * Math.sqrt(tau));
  return normalCdf(z);
}

export { SECONDS_PER_YEAR };
