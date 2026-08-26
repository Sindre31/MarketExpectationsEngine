import type { Assumptions, Company } from './data';

export interface DcfResult {
  rows: { t: number; rev: number; ebitda: number; ebit: number; fcf: number; pv: number }[];
  pvSum: number;
  tv: number;
  tvPV: number;
  ev: number;
  eq: number;
  ps: number;
  tvShare: number;
  rev5: number;
  fcf5: number;
  ebit5: number;
  eps5: number;
  NC: number;
}

/**
 * Five-year explicit DCF off FY25A revenue, margins interpolated linearly
 * from today's level to the terminal assumption, plus a Gordon-growth
 * terminal value. All monetary figures in NOK m; `ps` in NOK per share.
 */
export function dcf(c: Company, a: Assumptions): DcfResult {
  const R0 = c.rev[3];
  const M0 = c.M0;
  const B0 = c.B0;
  const NC = c.cash[3] - c.debt;
  const SH = c.shares;
  const w = a.wacc / 100;
  let tg = a.tg / 100;
  // keep the terminal spread from collapsing when tg approaches WACC
  if (w - tg < 0.008) tg = w - 0.008;
  let prev = R0;
  let pvSum = 0;
  let f5 = 0;
  const rows: DcfResult['rows'] = [];
  for (let t = 1; t <= 5; t++) {
    const rev = R0 * Math.pow(1 + a.g / 100, t);
    const em = M0 + (a.em - M0) * (t / 5);
    const eb = B0 + (a.eb - B0) * (t / 5);
    const ebitda = (rev * em) / 100;
    const ebit = (rev * eb) / 100;
    const fcf = ebitda - (ebit * a.tax) / 100 - (rev * a.capex) / 100 - 0.02 * (rev - prev);
    const pv = fcf / Math.pow(1 + w, t);
    pvSum += pv;
    rows.push({ t, rev, ebitda, ebit, fcf, pv });
    prev = rev;
    f5 = fcf;
  }
  const tv = (f5 * (1 + tg)) / (w - tg);
  const tvPV = tv / Math.pow(1 + w, 5);
  const ev = pvSum + tvPV;
  const eq = ev + NC;
  const ps = eq / SH;
  const r5 = rows[4];
  return {
    rows, pvSum, tv, tvPV, ev, eq, ps,
    tvShare: tvPV / ev,
    rev5: r5.rev,
    fcf5: r5.fcf,
    ebit5: r5.ebit,
    eps5: (r5.ebit * (1 - a.tax / 100) * 0.985) / SH,
    NC,
  };
}

/** Bisection solve: find x in [lo, hi] with fn(x) ≈ target (fn monotone increasing). */
export function solve(fn: (x: number) => number, lo: number, hi: number, target: number): number {
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2;
    if (fn(m) < target) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
