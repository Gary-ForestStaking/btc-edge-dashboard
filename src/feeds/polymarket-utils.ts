/** 5-minute window in seconds */
const WINDOW_SEC = 300;

/**
 * Get Unix timestamp for the start of the current 5-min window (UTC-aligned).
 * Polymarket slugs use this format: btc-updown-5m-{timestamp}
 */
export function getCurrentWindowStart(): number {
  return Math.floor(Date.now() / 1000 / WINDOW_SEC) * WINDOW_SEC;
}

/**
 * Get the slug for the active (current or next) 5-min market.
 * If we're in the last 30s of a window, we may want the next one for trading.
 */
export function getMarketSlug(windowStart: number): string {
  return `btc-updown-5m-${windowStart}`;
}

/**
 * Get the next window start (current + 5 min)
 */
export function getNextWindowStart(current: number): number {
  return current + WINDOW_SEC;
}

/**
 * Seconds until the given window ends
 */
export function secondsUntilWindowEnd(windowStart: number): number {
  const end = windowStart + WINDOW_SEC;
  return Math.max(0, end - Math.floor(Date.now() / 1000));
}

/**
 * Milliseconds until the next 5-min window boundary (when current window ends)
 */
export function msUntilNextWindow(): number {
  const now = Date.now();
  const currentEnd = (Math.floor(now / 1000 / WINDOW_SEC) + 1) * WINDOW_SEC * 1000;
  return Math.max(0, currentEnd - now);
}
