import { describe, it, expect } from 'vitest';
import { median, quartiles } from '../stats';

describe('median', () => {
  it('takes the middle value on an odd count', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it('averages the middle pair on an even count', () => {
    expect(median([12.7, 14.7])).toBeCloseTo(13.7, 10);
  });
  it('is null with nothing to average', () => {
    expect(median([])).toBeNull();
  });
  it('does not mutate its input', () => {
    const v = [3, 1, 2];
    median(v);
    expect(v).toEqual([3, 1, 2]);
  });
});

describe('quartiles', () => {
  it('drops the extremes of a five-name group', () => {
    // IBM's peer P/Es: DXC 4.2 and INFY 14.7 are the outliers that widened the bar
    const q = quartiles([12.7, 14.7, 11.2, 4.2, 8.5])!;
    expect(q.q1).toBeCloseTo(8.5, 10);
    expect(q.q3).toBeCloseTo(12.7, 10);
  });

  it('interpolates when the quartile falls between two values', () => {
    const q = quartiles([1, 2, 3, 4])!;   // idx 0.75 and 2.25
    expect(q.q1).toBeCloseTo(1.75, 10);
    expect(q.q3).toBeCloseTo(3.25, 10);
  });

  it('is always narrower than or equal to the full spread', () => {
    const v = [0.3, 0.9, 1.4, 1.5, 2.2];
    const q = quartiles(v)!;
    expect(q.q1).toBeGreaterThanOrEqual(Math.min(...v));
    expect(q.q3).toBeLessThanOrEqual(Math.max(...v));
    expect(q.q3 - q.q1).toBeLessThan(Math.max(...v) - Math.min(...v));
  });

  it('refuses a group too small for a meaningful middle half', () => {
    expect(quartiles([1, 2, 3])).toBeNull();
    expect(quartiles([5])).toBeNull();
    expect(quartiles([])).toBeNull();
  });
});
