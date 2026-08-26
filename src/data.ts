export interface Assumptions {
  g: number;
  tg: number;
  em: number;
  eb: number;
  tax: number;
  capex: number;
  wacc: number;
}

export type ScenarioId = 'bear' | 'base' | 'bull';

export interface Kpi {
  l: string;
  latest: string;
  est: string;
  vals: number[];
  good: 0 | 1;
  st: 'ON TRACK' | 'WATCH' | 'AT RISK';
}

export interface Company {
  ticker: string;
  name: string;
  meta: string;
  price: number;
  chg: string;
  chgPos: boolean;
  /** Shares outstanding, millions */
  shares: number;
  /** Interest-bearing debt, NOK m */
  debt: number;
  /** Current EBITDA margin, % */
  M0: number;
  /** Current EBIT margin, % */
  B0: number;
  /** EBITDA − EBIT margin gap (≈ D&A % of revenue) */
  daGap: number;
  /** Analyst consensus revenue CAGR, % */
  consG: number;
  /** Revenue FY22A–FY29E, NOK m */
  rev: number[];
  gm: number[];
  em: number[];
  capexP: number[];
  cash: number[];
  roic: number[];
  rnd: number[];
  buyback: (i: number) => number;
  divRate: number;
  /** Quarterly share price history, 20 quarters */
  priceHist: number[];
  defA: Assumptions;
  scDef: Record<ScenarioId, Assumptions>;
  hist: { pe: number; eve: number; evs: number; fcfy: number; peg: number };
  wk52: [number, number];
  peBand: [number, number];
  eveBand: [number, number];
  evsBand: [number, number];
  rating: string;
  buyBelow: number;
  segs: [string, (r: number, i: number) => number][];
  bull: string[];
  bear: string[];
  debate: string;
  thesis: { n: string; h: string; t: string }[];
  catalysts: { t: string; when: string }[];
  risks: { t: string; sev: 'HIGH' | 'MED' }[];
  variantBody: string;
  kpis: Kpi[];
  valFootTail: string;
  /** Reporting currency, e.g. 'NOK', 'USD' */
  ccy: string;
  /** Latest actual fiscal year (the "FY0" of the 8-year arrays), e.g. 2025 */
  fy0: number;
  /** True when the profile was fetched from the live-data API */
  live?: boolean;
  /** Display string for when the data was last refreshed */
  updated: string;
}

export const CO: Record<string, Company> = {
  NDLS: {
    ticker: 'NDLS', name: 'Nordlys Semiconductor ASA', meta: 'Oslo Børs · Semiconductors',
    price: 187.4, chg: '+2.10 (+1.13%)', chgPos: true, shares: 760, debt: 6200,
    M0: 28.4, B0: 22.9, daGap: 5.5, consG: 9.0,
    rev: [18412, 21086, 24594, 27912, 31580, 35410, 39310, 43240],
    gm: [52.4, 53.1, 54.0, 54.6, 55.0, 55.4, 55.8, 56.0],
    em: [25.8, 26.9, 27.9, 28.4, 29.2, 30.0, 30.7, 31.2],
    capexP: [8.2, 7.9, 7.6, 7.0, 7.0, 6.9, 6.8, 6.7],
    cash: [5200, 6100, 7600, 10400, 12300, 14600, 17200, 20100],
    roic: [14.2, 15.8, 17.1, 17.9, 18.8, 19.7, 20.4, 21.0],
    rnd: [11.8, 11.6, 11.4, 11.3, 11.1, 11.0, 10.9, 10.8],
    buyback: i => (i >= 2 ? -1000 : 0), divRate: 0.35,
    priceHist: [96, 103, 99, 108, 118, 112, 98, 91, 104, 117, 126, 138, 133, 146, 158, 152, 168, 175, 182, 187.4],
    defA: { g: 9, tg: 2.5, em: 31, eb: 25.5, tax: 22, capex: 7, wacc: 8.5 },
    scDef: {
      bear: { g: 5, em: 28, eb: 22.5, wacc: 9.5, tg: 1.5, tax: 22, capex: 7.5 },
      base: { g: 9, em: 31, eb: 25.5, wacc: 8.5, tg: 2.5, tax: 22, capex: 7 },
      bull: { g: 13, em: 33.5, eb: 28, wacc: 8, tg: 3, tax: 22, capex: 6.5 },
    },
    hist: { pe: 21.3, eve: 12.8, evs: 3.8, fcfy: 3.8, peg: 1.7 },
    wk52: [128, 196], peBand: [20, 26], eveBand: [12, 16.5], evsBand: [3.6, 4.8],
    rating: 'HOLD · TARGET NOK 168', buyBelow: 155,
    segs: [
      ['Power Solutions', (r, i) => r * (0.44 + i * 0.008)],
      ['Sensing & Analog', (r, i) => r * (0.35 - i * 0.004)],
      ['Foundry Services', (r, i) => r * (0.21 - i * 0.004)],
    ],
    bull: [
      'Power-semi content per EV rises 2.3x by 2030; NDLS is #2 in European SiC modules with 46 design wins secured.',
      'Structural margin runway: mix shift to modules plus the 300mm ramp adds ~400bps of EBITDA margin by FY29.',
      'Net cash balance sheet and ~3% FCF yield fund buybacks without constraining fab investment.',
    ],
    bear: [
      'Auto is 58% of revenue and channel inventories sit at 9.4 weeks vs 8.0 normal — a correction hits FY27 estimates.',
      'Chinese SiC entrants are compressing module ASPs 8–10% per year; the pricing umbrella may not hold.',
      'At 24x forward earnings the reverse DCF shows the price already embeds near-flawless execution.',
    ],
    debate:
      'Investors agree on the electrification volume story; they disagree on whether the margin expansion is structural (mix shift to SiC modules, 300mm scale) or a cyclical pricing umbrella that Chinese entrants will collapse. The answer determines whether 24x forward earnings is cheap or expensive.',
    thesis: [
      { n: '01', h: 'The volume story is real; the price story is not.', t: 'Electrification drives 9–11% structural revenue growth — but the market-implied path is much steeper with FY30 margins above 33%. Quality compounder, demanding entry price.' },
      { n: '02', h: 'Margin expansion is part structural, part umbrella.', t: 'We credit ~250bps from mix and 300mm scale, not the full 400–600bps consensus extrapolates. Chinese SiC pricing is the swing factor.' },
      { n: '03', h: 'Balance sheet optionality is underused but not free.', t: 'NOK 4.2bn net cash funds buybacks or M&A, worth ~NOK 8–10/share of option value — insufficient to close the gap to market-implied expectations.' },
    ],
    catalysts: [
      { t: 'Q3 earnings — margin print vs 54.2% GM est.', when: 'OCT 26' },
      { t: '300mm fab phase-2 ramp decision', when: 'Q4 26' },
      { t: 'EU auto OEM platform award (SiC)', when: 'H1 27' },
      { t: 'Market share vs Chinese entrants — teardown data', when: 'ONGOING' },
      { t: 'Capital-allocation update / buyback extension', when: 'CMD MAR 27' },
    ],
    risks: [
      { t: 'Auto channel inventory correction', sev: 'HIGH' },
      { t: 'SiC module price compression >10%/yr', sev: 'HIGH' },
      { t: 'Competitive intensity in sensing', sev: 'MED' },
      { t: 'Multiple compression to peer median', sev: 'MED' },
    ],
    variantBody:
      'The gap is not the volume outlook — it is margin durability. If Chinese SiC capacity forces module pricing down faster than mix improves, FY28–30 margins flatten near 29% and fair value falls toward the bear case (NOK {bear}). Conversely, if the 300mm cost curve lands as management guides, the bull case (NOK {bull}) is reachable without heroic growth. We would turn buyers below NOK {buy}, where the market-implied growth drops to consensus.',
    kpis: [
      { l: 'SiC module design wins (cumulative)', latest: '46', est: '41', vals: [18, 22, 26, 29, 33, 38, 42, 46], good: 1, st: 'ON TRACK' },
      { l: 'Gross margin', latest: '54.6%', est: '54.2%', vals: [52.8, 53.0, 53.4, 53.6, 54.0, 54.1, 54.4, 54.6], good: 1, st: 'ON TRACK' },
      { l: 'Foundry utilisation', latest: '84%', est: '88%', vals: [91, 90, 89, 88, 87, 86, 85, 84], good: 0, st: 'WATCH' },
      { l: 'Book-to-bill', latest: '1.08x', est: '1.05x', vals: [0.94, 0.97, 1.01, 0.99, 1.03, 1.05, 1.06, 1.08], good: 1, st: 'ON TRACK' },
      { l: 'Auto channel inventory (weeks)', latest: '9.4', est: '8.0', vals: [6.8, 7.0, 7.4, 7.9, 8.3, 8.8, 9.1, 9.4], good: 0, st: 'AT RISK' },
    ],
    valFootTail: 'trading at a premium to its own history on every multiple.',
    ccy: 'NOK',
    fy0: 2025,
    updated: '26 Aug 2026 · 16:25 CET',
  },
  VSTM: {
    ticker: 'VSTM', name: 'Vestbo Micro ASA', meta: 'Oslo Børs · Industrial & Medtech Sensors',
    price: 412.0, chg: '−3.40 (−0.82%)', chgPos: false, shares: 529, debt: 16600,
    M0: 31.2, B0: 25.2, daGap: 6.0, consG: 8.0,
    rev: [31240, 33810, 36420, 39120, 42250, 45640, 49200, 52900],
    gm: [57.8, 58.1, 58.5, 58.9, 59.1, 59.3, 59.5, 59.7],
    em: [29.6, 30.2, 30.7, 31.2, 31.6, 32.0, 32.4, 32.8],
    capexP: [5.8, 5.6, 5.5, 5.4, 5.4, 5.3, 5.2, 5.1],
    cash: [4800, 5600, 6900, 8200, 9800, 11600, 13600, 15800],
    roic: [16.8, 17.6, 18.4, 19.5, 20.1, 20.8, 21.4, 22.0],
    rnd: [8.9, 8.8, 8.7, 8.6, 8.6, 8.5, 8.5, 8.4],
    buyback: () => 0, divRate: 0.45,
    priceHist: [252, 266, 258, 274, 290, 281, 262, 255, 278, 296, 310, 330, 322, 344, 366, 358, 382, 395, 404, 412],
    defA: { g: 8, tg: 2.5, em: 32.8, eb: 26.8, tax: 22, capex: 5.3, wacc: 8 },
    scDef: {
      bear: { g: 4, em: 30, eb: 24, wacc: 9, tg: 1.5, tax: 22, capex: 5.8 },
      base: { g: 8, em: 32.8, eb: 26.8, wacc: 8, tg: 2.5, tax: 22, capex: 5.3 },
      bull: { g: 11, em: 35, eb: 29, wacc: 7.5, tg: 3, tax: 22, capex: 5 },
    },
    hist: { pe: 23.5, eve: 14.2, evs: 4.3, fcfy: 3.5, peg: 2.4 },
    wk52: [248, 418], peBand: [21, 27], eveBand: [13.5, 18], evsBand: [4.2, 6.0],
    rating: 'HOLD · TARGET NOK 385', buyBelow: 340,
    segs: [
      ['Industrial Sensing', (r, i) => r * (0.44 - i * 0.006)],
      ['Medtech Sensors', (r, i) => r * (0.33 + i * 0.004)],
      ['Service & Calibration', (r, i) => r * (0.23 + i * 0.002)],
    ],
    bull: [
      'Recurring service & calibration revenue is now 23% of sales and climbing, lifting group margins ~40bps a year.',
      'Medtech sensor franchise grows 14% with regulatory moats and 10-year design lives.',
      'A 25-year record of margin discipline through cycles; ROIC crossed 19% and keeps compounding.',
    ],
    bear: [
      'Short-cycle industrial exposure (44% of sales) is rolling over; PMIs point to a soft FY27.',
      'Net debt of NOK 8.4bn (0.7x EBITDA) limits buyback capacity versus net-cash peers.',
      'At ~26x forward earnings the multiple assumes medtech growth never decelerates.',
    ],
    debate:
      'Bulls treat Vestbo as a medtech compounder deserving a healthcare multiple; bears see an industrial cyclical with a medtech veneer. Which label wins decides whether 26x is justified — the reverse DCF quantifies the gap.',
    thesis: [
      { n: '01', h: 'Mix shift does the heavy lifting.', t: 'Medtech and service mix reaches 55%+ of sales by FY29, adding ~120bps to group EBITDA margin without heroic pricing.' },
      { n: '02', h: 'The cycle is the entry point, not the thesis.', t: 'Short-cycle industrial softness in FY27 likely gives a better entry; structural growth is 7–9%, below what the price implies.' },
      { n: '03', h: 'Leverage caps optionality.', t: '0.7x net debt is manageable but rules out the aggressive buybacks net-cash peers can fund; capital returns stay dividend-led.' },
    ],
    catalysts: [
      { t: 'Q3 industrial order intake print', when: 'OCT 26' },
      { t: 'Medtech FDA clearance — CGM sensor line', when: 'Q4 26' },
      { t: 'Service attach-rate disclosure at CMD', when: 'MAR 27' },
      { t: 'Deleveraging below 0.5x EBITDA', when: 'FY27' },
      { t: 'Industrial PMI inflection', when: 'ONGOING' },
    ],
    risks: [
      { t: 'Industrial downturn deeper than one year', sev: 'HIGH' },
      { t: 'De-rating to industrial-peer multiples', sev: 'HIGH' },
      { t: 'Medtech reimbursement pressure', sev: 'MED' },
      { t: 'NOK strength vs EUR revenue base', sev: 'MED' },
    ],
    variantBody:
      'The gap is classification, not forecasting: the stock is priced as pure medtech, but 44% of revenue is short-cycle industrial. If the industrial book contracts in FY27, group growth halves and fair value falls toward the bear case (NOK {bear}). If medtech sustains mid-teens growth while service mix compounds, the bull case (NOK {bull}) needs no multiple expansion. We would add below NOK {buy}, where implied growth meets our structural estimate.',
    kpis: [
      { l: 'Medtech revenue growth (YoY)', latest: '14.2%', est: '13.5%', vals: [11.8, 12.2, 12.6, 13.1, 13.4, 13.8, 14.0, 14.2], good: 1, st: 'ON TRACK' },
      { l: 'Service attach rate', latest: '31%', est: '30%', vals: [26, 27, 27.5, 28, 29, 29.5, 30, 31], good: 1, st: 'ON TRACK' },
      { l: 'Industrial book-to-bill', latest: '0.93x', est: '0.98x', vals: [1.06, 1.04, 1.02, 1.0, 0.99, 0.97, 0.95, 0.93], good: 0, st: 'AT RISK' },
      { l: 'Net debt / EBITDA', latest: '0.69x', est: '0.75x', vals: [1.1, 1.05, 0.98, 0.92, 0.86, 0.8, 0.74, 0.69], good: 1, st: 'ON TRACK' },
      { l: 'Gross margin', latest: '58.9%', est: '58.6%', vals: [57.9, 58.0, 58.2, 58.3, 58.5, 58.6, 58.7, 58.9], good: 1, st: 'ON TRACK' },
    ],
    valFootTail: 'priced closer to medtech than to its industrial peer set.',
    ccy: 'NOK',
    fy0: 2025,
    updated: '26 Aug 2026 · 16:25 CET',
  },
};

/**
 * [ticker, name, mktCap bn, revGrowth %, EBITDA m %, EBIT m %, ROIC %,
 *  P/E x, EV/EBITDA x, EV/Sales x, FCF yield %]
 */
export type PeerRow = [string, string, number, number, number, number, number, number, number, number, number];

export const PEERS: PeerRow[] = [
  ['NDLS', 'Nordlys Semiconductor', 142.4, 12.4, 28.4, 22.9, 17.9, 24.4, 15.0, 4.4, 3.1],
  ['VSTM', 'Vestbo Micro', 218, 8.0, 31.6, 25.6, 20.1, 25.8, 17.0, 5.4, 4.0],
  ['ALDP', 'Aldra Power Semi', 96, 7.1, 24.5, 18.9, 12.8, 19.8, 11.9, 2.9, 4.4],
  ['KVTK', 'Kvantek', 61, 15.6, 22.1, 16.4, 11.2, 31.5, 17.8, 3.9, 1.9],
  ['HELS', 'Helios Sensor', 174, 8.9, 29.8, 23.6, 16.4, 22.3, 13.8, 4.1, 3.6],
  ['BRND', 'Bornholm Devices', 44, 5.2, 20.3, 14.8, 9.6, 16.9, 9.8, 2.1, 5.2],
  ['SRKM', 'Sarek Micro', 128, 11.2, 26.7, 21.0, 15.1, 23.1, 14.1, 3.8, 3.0],
];
