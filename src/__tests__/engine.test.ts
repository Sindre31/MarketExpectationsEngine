import { describe, it, expect } from 'vitest';
import { dcf, solve } from '../engine';
import { CO } from '../data';
import type { Assumptions } from '../data';

const c = CO.NDLS;
const base: Assumptions = { ...c.defA };

describe('dcf', () => {
  it('discounts to a positive per-share value on the mock base case', () => {
    const d = dcf(c, base);
    expect(d.ps).toBeGreaterThan(0);
    expect(d.rows).toHaveLength(5);
  });

  it('adds up: PV of forecast + PV of terminal = enterprise value', () => {
    const d = dcf(c, base);
    expect(d.ev).toBeCloseTo(d.pvSum + d.tvPV, 6);
    expect(d.tvShare).toBeCloseTo(d.tvPV / d.ev, 10);
  });

  it('bridges enterprise value to equity with the net cash position', () => {
    const d = dcf(c, base);
    expect(d.eq).toBeCloseTo(d.ev + d.NC, 6);
    expect(d.ps).toBeCloseTo(d.eq / c.shares, 10);
  });

  it('is monotone: more growth is worth more, a higher discount rate is worth less', () => {
    const lo = dcf(c, { ...base, g: base.g - 3 }).ps;
    const hi = dcf(c, { ...base, g: base.g + 3 }).ps;
    expect(hi).toBeGreaterThan(lo);
    const cheap = dcf(c, { ...base, wacc: base.wacc - 1 }).ps;
    const dear = dcf(c, { ...base, wacc: base.wacc + 1 }).ps;
    expect(cheap).toBeGreaterThan(dear);
  });

  it('holds the terminal spread open when growth is set at or above the discount rate', () => {
    // g∞ >= WACC would divide by zero or flip the sign of the terminal value
    const d = dcf(c, { ...base, wacc: 8, tg: 12 });
    expect(Number.isFinite(d.ps)).toBe(true);
    expect(d.ps).toBeGreaterThan(0);
    expect(d.tv).toBeGreaterThan(0);
  });

  it('interpolates margins from today to the terminal assumption', () => {
    const d = dcf(c, base);
    const m1 = d.rows[0].ebitda / d.rows[0].rev * 100;
    const m5 = d.rows[4].ebitda / d.rows[4].rev * 100;
    expect(m1).toBeGreaterThan(c.M0);          // already stepping up in year 1
    expect(m5).toBeCloseTo(base.em, 6);        // and lands exactly on the terminal margin
  });
});

describe('solve', () => {
  it('finds the growth rate that reproduces a target value', () => {
    const target = dcf(c, { ...base, g: 11 }).ps;
    const found = solve(g => dcf(c, { ...base, g }).ps, 0, 40, target);
    expect(found).toBeCloseTo(11, 2);
  });

  it('stays inside the bracket when the target is unreachable', () => {
    const found = solve(g => dcf(c, { ...base, g }).ps, 0, 40, 1e12);
    expect(found).toBeGreaterThanOrEqual(0);
    expect(found).toBeLessThanOrEqual(40);
  });
});
