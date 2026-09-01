/**
 * Small statistics used by the peer comparison. Kept apart from the DCF so both
 * the median columns and the football-field bars share one definition — they
 * were separately implemented before, which is how two of them drifted apart.
 */

/** Median of the values given. Averages the middle pair on an even count. */
export function median(values: number[]): number | null {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * First and third quartiles — the middle half of the group.
 *
 * Uses the inclusive, linearly interpolated definition (the one Excel's
 * PERCENTILE.INC and R's default type 7 use), so a five-name group resolves to
 * the second and fourth values and simply drops the extremes.
 *
 * Null below four values: a "middle half" of three points is barely narrower
 * than the full spread, and presenting it as an interquartile range would
 * overstate what the group supports.
 */
export function quartiles(values: number[]): { q1: number; q3: number } | null {
  const s = [...values].sort((a, b) => a - b);
  if (s.length < 4) return null;
  const at = (p: number) => {
    const idx = p * (s.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
  };
  return { q1: at(0.25), q3: at(0.75) };
}
