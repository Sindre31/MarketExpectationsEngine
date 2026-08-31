import React from 'react';

export interface Palette {
  grid: string;
  txt: string;
  s1: string;
  s2: string;
  s3: string;
  neg: string;
  bar: string;
  barE: string;
  ink: string;
  bg: string;
}

export const LIGHT: Palette = {
  grid: '#e6e3db', txt: '#8b887f', s1: '#33527d', s2: '#8a6d2f', s3: '#1a7f4e',
  neg: '#b3382f', bar: '#b7c4d6', barE: '#dde4ec', ink: '#191b20', bg: '#fdfdfb',
};

export const DARK: Palette = {
  grid: '#262a30', txt: '#8f9299', s1: '#8fb0da', s2: '#cfa64e', s3: '#46b881',
  neg: '#e0655c', bar: '#33414f', barE: '#242e39', ink: '#e6e4df', bg: '#16181c',
};

export interface TipLine {
  t: string;
}

/** Returns mouse handlers that show/hide the shared crosshair tooltip. */
export type TipFn = (title: string, lines: TipLine[]) => {
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
};

const MONO = 'IBM Plex Mono';
const SANS = 'IBM Plex Sans';

export interface LineSeries {
  v: (number | null)[];
  c: string;
  wd?: number;
  dash?: string;
  dots?: boolean;
  n?: string;
}

export interface LineChartCfg {
  w?: number;
  h?: number;
  pl?: number;
  pr?: number;
  pt?: number;
  pb?: number;
  series: LineSeries[];
  labels: string[];
  tipLabels?: string[];
  fmt?: (v: number) => string;
  tipFmt?: (v: number) => string;
  zero?: boolean;
  C: Palette;
}

export function lineChart(cfg: LineChartCfg, tt: TipFn) {
  const { w = 520, h = 180, pl = 42, pr = 10, pt = 10, pb = 20, series, labels, fmt = v => v.toFixed(0), tipFmt, C } = cfg;
  const tf = tipFmt || fmt;
  const vals: number[] = [];
  series.forEach(s => s.v.forEach(v => { if (v != null) vals.push(v); }));
  let mn = Math.min(...vals);
  let mx = Math.max(...vals);
  if (cfg.zero) mn = Math.min(0, mn);
  const pd = (mx - mn) * 0.09 || 1;
  mn -= pd;
  mx += pd;
  const n = labels.length;
  const X = (i: number) => pl + (w - pl - pr) * (n > 1 ? i / (n - 1) : 0.5);
  const Y = (v: number) => pt + (h - pt - pb) * (1 - (v - mn) / (mx - mn));
  const k: React.ReactNode[] = [];
  for (let i = 0; i < 4; i++) {
    const y = pt + ((h - pt - pb) * i) / 3;
    const vv = mn + (mx - mn) * (1 - i / 3);
    k.push(<line key={'g' + i} x1={pl} x2={w - pr} y1={y} y2={y} stroke={C.grid} />);
    k.push(<text key={'t' + i} x={pl - 5} y={y + 3} fontSize={9} fill={C.txt} textAnchor="end" fontFamily={MONO}>{fmt(vv)}</text>);
  }
  labels.forEach((l, i) => {
    if (l) k.push(<text key={'x' + i} x={X(i)} y={h - 6} fontSize={9} fill={C.txt} textAnchor="middle" fontFamily={MONO}>{l}</text>);
  });
  series.forEach((s, si) => {
    let d = '';
    let on = false;
    s.v.forEach((v, i) => {
      if (v == null) return;
      d += (on ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
      on = true;
    });
    k.push(<path key={'p' + si} d={d} fill="none" stroke={s.c} strokeWidth={s.wd || 1.8} strokeDasharray={s.dash} />);
    s.v.forEach((v, i) => {
      if (v == null) return;
      if (s.dots) k.push(<circle key={'d' + si + '-' + i} cx={X(i)} cy={Y(v)} r={2.3} fill={s.c} />);
      k.push(
        <circle
          key={'h' + si + '-' + i}
          cx={X(i)} cy={Y(v)} r={9} fill="transparent" style={{ cursor: 'crosshair' }}
          {...tt(cfg.tipLabels ? cfg.tipLabels[i] : labels[i] || '', [{ t: (s.n ? s.n + ': ' : '') + tf(v) }])}
        />,
      );
    });
  });
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block' }}>{k}</svg>;
}

export interface ComboCfg {
  w?: number;
  h?: number;
  pl?: number;
  pr?: number;
  pt?: number;
  pb?: number;
  bars: number[];
  /** index of first estimate bar (shaded + dashed outline) */
  estFrom?: number;
  line?: number[];
  labels: string[];
  fmt?: (v: number) => string;
  barName?: string;
  lineName?: string;
  barFmt?: (v: number) => string;
  C: Palette;
}

export function comboChart(cfg: ComboCfg, tt: TipFn) {
  const { w = 400, h = 180, pl = 38, pr = 34, pt = 10, pb = 20, bars, estFrom = 99, line, labels, fmt = v => v.toFixed(0), barName = '', lineName = '', barFmt, C } = cfg;
  const bf = barFmt || ((v: number) => v.toFixed(1));
  const mx = Math.max(...bars) * 1.1;
  const n = labels.length;
  const bw = ((w - pl - pr) / n) * 0.62;
  const X = (i: number) => pl + ((w - pl - pr) * (i + 0.5)) / n;
  const Y = (v: number) => pt + (h - pt - pb) * (1 - v / mx);
  const k: React.ReactNode[] = [];
  for (let i = 0; i < 4; i++) {
    const y = pt + ((h - pt - pb) * i) / 3;
    const vv = mx * (1 - i / 3);
    k.push(<line key={'g' + i} x1={pl} x2={w - pr} y1={y} y2={y} stroke={C.grid} />);
    k.push(<text key={'t' + i} x={pl - 5} y={y + 3} fontSize={9} fill={C.txt} textAnchor="end" fontFamily={MONO}>{fmt(vv)}</text>);
  }
  bars.forEach((v, i) => {
    const lines: TipLine[] = [{ t: barName + ': ' + bf(v) }];
    if (line) lines.push({ t: lineName + ': ' + line[i].toFixed(1) + '%' });
    k.push(
      <rect
        key={'b' + i}
        x={X(i) - bw / 2} y={Y(v)} width={bw} height={h - pb - Y(v)}
        fill={i >= estFrom ? C.barE : C.bar}
        stroke={i >= estFrom ? C.s1 : 'none'}
        strokeDasharray={i >= estFrom ? '2 2' : 'none'}
        strokeWidth={0.8}
        style={{ cursor: 'crosshair' }}
        {...tt(labels[i] + (i >= estFrom ? ' (est.)' : ''), lines)}
      />,
    );
    k.push(<text key={'xl' + i} x={X(i)} y={h - 6} fontSize={8.5} fill={C.txt} textAnchor="middle" fontFamily={MONO}>{labels[i]}</text>);
  });
  if (line) {
    const lmn = Math.min(...line) * 0.96;
    const lmx = Math.max(...line) * 1.04;
    const LY = (v: number) => pt + (h - pt - pb) * (1 - (v - lmn) / (lmx - lmn));
    let d = '';
    line.forEach((v, i) => { d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + LY(v).toFixed(1); });
    k.push(<path key="ln" d={d} fill="none" stroke={C.s2} strokeWidth={1.8} />);
    line.forEach((v, i) => k.push(<circle key={'lc' + i} cx={X(i)} cy={LY(v)} r={2} fill={C.s2} />));
    k.push(<text key="r0" x={w - 2} y={LY(lmx) + 8} fontSize={9} fill={C.s2} textAnchor="end" fontFamily={MONO}>{lmx.toFixed(0) + '%'}</text>);
    k.push(<text key="r1" x={w - 2} y={LY(lmn) - 2} fontSize={9} fill={C.s2} textAnchor="end" fontFamily={MONO}>{lmn.toFixed(0) + '%'}</text>);
  }
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block' }}>{k}</svg>;
}

export interface RangeItem {
  label: string;
  lo: number;
  hi: number;
  mid?: number | null;
  c?: string;
}

export function rangeChart(items: RangeItem[], marker: number, C: Palette, tt: TipFn, height?: number, ccy = 'NOK') {
  const w = 620;
  const pl = 186; // fits the longest bar label ("EV/EBITDA 5.7–10.6x · peers")
  const pr = 44;
  const rh = 30;
  const h = height || items.length * rh + 34;
  let lo = marker;
  let hi = marker;
  items.forEach(it => { lo = Math.min(lo, it.lo); hi = Math.max(hi, it.hi); });
  const pd = (hi - lo) * 0.08;
  lo -= pd;
  hi += pd;
  const X = (v: number) => pl + ((w - pl - pr) * (v - lo)) / (hi - lo);
  const k: React.ReactNode[] = [];
  items.forEach((it, i) => {
    const y = 14 + i * rh;
    k.push(<text key={'l' + i} x={pl - 8} y={y + 12} fontSize={10.5} fill={C.ink} textAnchor="end" fontFamily={SANS}>{it.label}</text>);
    k.push(
      <rect
        key={'r' + i}
        x={X(it.lo)} y={y + 3} width={Math.max(2, X(it.hi) - X(it.lo))} height={12} rx={2}
        fill={it.c || C.bar} opacity={0.85} style={{ cursor: 'crosshair' }}
        {...tt(it.label, [{ t: ccy + ' ' + it.lo.toFixed(0) + ' – ' + it.hi.toFixed(0) + (it.mid != null ? ' · mid ' + it.mid.toFixed(0) : '') }])}
      />,
    );
    k.push(<text key={'lo' + i} x={X(it.lo) - 4} y={y + 12} fontSize={9} fill={C.txt} textAnchor="end" fontFamily={MONO}>{it.lo.toFixed(0)}</text>);
    k.push(<text key={'hi' + i} x={X(it.hi) + 4} y={y + 12} fontSize={9} fill={C.txt} fontFamily={MONO}>{it.hi.toFixed(0)}</text>);
    if (it.mid != null) k.push(<line key={'m' + i} x1={X(it.mid)} x2={X(it.mid)} y1={y + 1} y2={y + 17} stroke={C.ink} strokeWidth={1.6} />);
  });
  const mh = 14 + items.length * rh;
  k.push(<line key="mk" x1={X(marker)} x2={X(marker)} y1={6} y2={mh} stroke={C.neg} strokeWidth={1.4} strokeDasharray="4 3" />);
  k.push(<text key="mkt" x={X(marker)} y={mh + 12} fontSize={9.5} fill={C.neg} textAnchor="middle" fontFamily={MONO}>{marker.toFixed(0)}</text>);
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block' }}>{k}</svg>;
}

export interface ScatterPt {
  t: string;
  x: number;
  y: number;
  /** bubble size — market cap, NOK bn */
  m: number;
  hl?: boolean;
}

export interface ScatterCfg {
  pts: ScatterPt[];
  xl: string;
  yl: string;
  fx?: (v: number) => string | number;
  fy?: (v: number) => string | number;
  C: Palette;
  ccy?: string;
}

export function scatterChart(cfg: ScatterCfg, tt: TipFn) {
  const { pts, xl, yl, fx = v => v, fy = v => v, C, ccy = 'NOK' } = cfg;
  const w = 480;
  const h = 250;
  const pl = 46;
  const pr = 14;
  const pt = 26; // leaves the y-axis caption clear of the top gridline label
  const pb = 34;
  let xmn = 1e9, xmx = -1e9, ymn = 1e9, ymx = -1e9;
  pts.forEach(p => {
    xmn = Math.min(xmn, p.x); xmx = Math.max(xmx, p.x);
    ymn = Math.min(ymn, p.y); ymx = Math.max(ymx, p.y);
  });
  const xpd = (xmx - xmn) * 0.16;
  const ypd = (ymx - ymn) * 0.18;
  xmn -= xpd; xmx += xpd; ymn -= ypd; ymx += ypd;
  const X = (v: number) => pl + ((w - pl - pr) * (v - xmn)) / (xmx - xmn);
  const Y = (v: number) => pt + (h - pt - pb) * (1 - (v - ymn) / (ymx - ymn));
  const k: React.ReactNode[] = [];
  for (let i = 0; i < 4; i++) {
    const y = pt + ((h - pt - pb) * i) / 3;
    const vv = ymn + (ymx - ymn) * (1 - i / 3);
    k.push(<line key={'g' + i} x1={pl} x2={w - pr} y1={y} y2={y} stroke={C.grid} />);
    k.push(<text key={'gy' + i} x={pl - 5} y={y + 3} fontSize={9} fill={C.txt} textAnchor="end" fontFamily={MONO}>{fy(vv)}</text>);
    const x = pl + ((w - pl - pr) * i) / 3;
    const xv = xmn + ((xmx - xmn) * i) / 3;
    k.push(<text key={'gx' + i} x={x} y={h - 20} fontSize={9} fill={C.txt} textAnchor="middle" fontFamily={MONO}>{fx(xv)}</text>);
  }
  k.push(<text key="xl" x={(pl + w - pr) / 2} y={h - 4} fontSize={9.5} fill={C.txt} textAnchor="middle" fontFamily={SANS}>{xl}</text>);
  k.push(<text key="yl" x={10} y={11} fontSize={9.5} fill={C.txt} fontFamily={SANS}>{yl}</text>);
  pts.forEach((p, i) => {
    const r = 4 + Math.sqrt(p.m) / 2.2;
    k.push(
      <circle
        key={'c' + i}
        cx={X(p.x)} cy={Y(p.y)} r={r}
        fill={p.hl ? C.s1 : C.bar} opacity={p.hl ? 0.95 : 0.75}
        stroke={p.hl ? C.ink : 'none'} strokeWidth={1}
        style={{ cursor: 'crosshair' }}
        {...tt(p.t, [{ t: xl + ': ' + fx(p.x) }, { t: yl + ': ' + fy(p.y) }, { t: 'Mkt cap: ' + ccy + ' ' + p.m.toFixed(0) + 'bn' }])}
      />,
    );
    k.push(<text key={'ct' + i} x={X(p.x) + r + 3} y={Y(p.y) + 3} fontSize={9} fill={p.hl ? C.ink : C.txt} fontFamily={MONO} fontWeight={p.hl ? 600 : 400}>{p.t}</text>);
  });
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block' }}>{k}</svg>;
}

export interface WaterfallItem {
  l: string;
  v: number;
  isTotal?: boolean;
}

export function waterfallChart(items: WaterfallItem[], C: Palette, tt: TipFn, ccy = 'NOK') {
  const w = 460;
  const h = 215;
  const pl = 38;
  const pr = 8;
  const pt = 16;
  const pb = 34;
  let cum = 0;
  const bars = items.map(it => {
    if (it.isTotal) {
      const b = { lo: 0, hi: it.v };
      cum = it.v;
      return b;
    }
    const b = { lo: Math.min(cum, cum + it.v), hi: Math.max(cum, cum + it.v) };
    cum += it.v;
    return b;
  });
  const mx = Math.max(...bars.map(b => b.hi)) * 1.14;
  const n = items.length;
  const bw = ((w - pl - pr) / n) * 0.62;
  const X = (i: number) => pl + ((w - pl - pr) * (i + 0.5)) / n;
  const Y = (v: number) => pt + (h - pt - pb) * (1 - v / mx);
  const k: React.ReactNode[] = [];
  for (let i = 0; i < 4; i++) {
    const y = pt + ((h - pt - pb) * i) / 3;
    const vv = mx * (1 - i / 3);
    k.push(<line key={'g' + i} x1={pl} x2={w - pr} y1={y} y2={y} stroke={C.grid} />);
    k.push(<text key={'t' + i} x={pl - 5} y={y + 3} fontSize={9} fill={C.txt} textAnchor="end" fontFamily={MONO}>{vv.toFixed(0)}</text>);
  }
  items.forEach((it, i) => {
    const b = bars[i];
    const fill = it.isTotal ? C.s1 : it.v >= 0 ? C.s3 : C.neg;
    k.push(
      <rect
        key={'b' + i}
        x={X(i) - bw / 2} y={Y(b.hi)} width={bw} height={Math.max(1.5, Y(b.lo) - Y(b.hi))}
        fill={fill} opacity={it.isTotal ? 0.9 : 0.8} style={{ cursor: 'crosshair' }}
        {...tt(it.l, [{ t: (it.isTotal ? '' : it.v >= 0 ? '+' : '') + it.v.toFixed(2) + ' ' + ccy }])}
      />,
    );
    k.push(<text key={'v' + i} x={X(i)} y={Y(b.hi) - 4} fontSize={9} fill={C.ink} textAnchor="middle" fontFamily={MONO}>{(it.isTotal ? '' : it.v >= 0 ? '+' : '') + it.v.toFixed(2)}</text>);
    k.push(<text key={'x' + i} x={X(i)} y={h - 18} fontSize={8.5} fill={C.txt} textAnchor="middle" fontFamily={MONO}>{it.l}</text>);
    if (i < n - 1) {
      const cy = it.isTotal ? Y(b.hi) : it.v >= 0 ? Y(b.hi) : Y(b.lo);
      k.push(<line key={'cn' + i} x1={X(i) + bw / 2} x2={X(i + 1) - bw / 2} y1={cy} y2={cy} stroke={C.txt} strokeDasharray="2 2" strokeWidth={0.8} />);
    }
  });
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block' }}>{k}</svg>;
}

/**
 * `estFrom` marks where reported history stops and forecast begins; the
 * forecast leg is drawn dashed so a trend line is never half-invented without
 * saying so.
 */
export function sparkline(vals: number[], good: boolean, C: Palette, estFrom?: number) {
  const w = 84;
  const h = 24;
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const sp = mx - mn || 1;
  const X = (i: number) => 3 + ((w - 6) * i) / (vals.length - 1);
  const Y = (v: number) => h - 3 - ((h - 7) * (v - mn)) / sp;
  const seg = (from: number, to: number) =>
    vals.slice(from, to + 1).map((v, k) => (k ? 'L' : 'M') + X(from + k).toFixed(1) + ' ' + Y(v).toFixed(1)).join('');
  const split = estFrom != null && estFrom > 0 && estFrom < vals.length - 1 ? estFrom : null;
  const stroke = good ? C.s3 : C.neg;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: 'block' }}>
      <path d={seg(0, split ?? vals.length - 1)} fill="none" stroke={stroke} strokeWidth={1.5} />
      {split != null && (
        <path d={seg(split, vals.length - 1)} fill="none" stroke={stroke} strokeWidth={1.5} strokeDasharray="2 2" opacity={0.75} />
      )}
    </svg>
  );
}
