import type { Assumptions, Company, Kpi } from './data';
import { peerFromOverview } from './marketRow';

/**
 * Live-data adapter: fetches a real company from the Alpha Vantage REST API
 * (https://www.alphavantage.co — free API key, CORS-enabled) and maps it into
 * the same `Company` shape the mock dataset uses, so the whole terminal —
 * reverse DCF included — runs unchanged on live data.
 *
 * One company load = 6 requests (overview, quote, income statement, balance
 * sheet, cash flow, monthly prices). The free tier allows 25 requests/day.
 */

const BASE = 'https://www.alphavantage.co/query';

export class LiveDataError extends Error {}

function num(x: unknown, fallback = NaN): number {
  const v = typeof x === 'string' ? parseFloat(x) : typeof x === 'number' ? x : NaN;
  return isNaN(v) ? fallback : v;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * With a personal key, call Alpha Vantage directly from the browser.
 * Without one, go through the site's /api/av serverless proxy, which holds a
 * shared key server-side (and answers 503 if none is configured there).
 */
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

/** A burst limit we can wait out, as opposed to the daily quota being spent. */
const isBurstLimit = (msg: string) => /per second|spreading out/i.test(msg) && !/per day/i.test(msg);

async function avOnce(params: Record<string, string>, apiKey: string): Promise<any> {
  const qs = new URLSearchParams(params);
  const url = apiKey ? `${BASE}?${qs}&apikey=${encodeURIComponent(apiKey)}` : `/api/av?${qs}`;
  const res = await fetch(url);
  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new LiveDataError(`Market-data request failed (HTTP ${res.status})`);
  }
  if (json['error']) throw new LiveDataError(json['error']); // proxy error / upstream notice
  if (!res.ok) throw new LiveDataError(`Market-data request failed (HTTP ${res.status})`);
  if (json['Error Message']) throw new LiveDataError(json['Error Message']);
  if (json['Information']) throw new LiveDataError(json['Information']); // rate limit / premium notice
  if (json['Note']) throw new LiveDataError(json['Note']);
  return json;
}

async function av(params: Record<string, string>, apiKey: string): Promise<any> {
  try {
    return await avOnce(params, apiKey);
  } catch (e) {
    // the provider's per-second burst limit is transient — back off and retry once
    if (e instanceof LiveDataError && isBurstLimit(e.message)) {
      await pause(1600);
      return avOnce(params, apiKey);
    }
    throw e;
  }
}

/** Same request path (personal key or shared proxy) for other live modules. */
export const avQuery = av;

export interface SearchHit {
  symbol: string;
  name: string;
  region: string;
  currency: string;
}

export async function searchSymbols(q: string, apiKey: string): Promise<SearchHit[]> {
  const json = await av({ function: 'SYMBOL_SEARCH', keywords: q }, apiKey);
  const matches = json.bestMatches || [];
  return matches.slice(0, 6).map((m: any) => ({
    symbol: m['1. symbol'],
    name: m['2. name'],
    region: m['4. region'],
    currency: m['8. currency'],
  }));
}

/** Extend a 4-element actuals series with 4 estimate years via a per-year drift. */
function extend(actuals: number[], drift: (last: number, t: number) => number): number[] {
  const last = actuals[actuals.length - 1];
  return [...actuals, ...[1, 2, 3, 4].map(t => r1(drift(last, t)))];
}

/** Oldest-first last-4 annual reports, padded by repeating the oldest if history is short. */
function last4(reports: any[]): any[] {
  const asc = [...reports].reverse();
  const out = asc.slice(-4);
  while (out.length < 4 && out.length > 0) out.unshift(out[0]);
  if (out.length === 0) throw new LiveDataError('No annual reports available for this symbol');
  return out;
}

export async function fetchLiveCompany(symbol: string, apiKey: string): Promise<Company> {
  // sequential, spaced just over a second: Alpha Vantage's free tier documents
  // a limit of one request per second and answers bursts with a notice
  const results: any[] = [];
  const fns = ['OVERVIEW', 'GLOBAL_QUOTE', 'INCOME_STATEMENT', 'BALANCE_SHEET', 'CASH_FLOW', 'TIME_SERIES_MONTHLY_ADJUSTED'];
  for (let i = 0; i < fns.length; i++) {
    if (i) await pause(1100);
    results.push(await av({ function: fns[i], symbol }, apiKey));
  }
  const [ov, quoteRes, incRes, balRes, cfRes, tsRes] = results;
  if (!ov.Symbol) throw new LiveDataError(`No fundamentals found for "${symbol}"`);

  const q = quoteRes['Global Quote'] || {};
  const price = num(q['05. price'], num(ov['50DayMovingAverage']));
  if (!(price > 0)) throw new LiveDataError(`No price available for "${symbol}"`);
  const chgAbs = num(q['09. change'], 0);
  const chgPct = num(String(q['10. change percent'] || '').replace('%', ''), 0);
  const chgPos = chgAbs >= 0;
  const sign = chgPos ? '+' : '−';
  const chg = `${sign}${Math.abs(chgAbs).toFixed(2)} (${sign}${Math.abs(chgPct).toFixed(2)}%)`;

  const inc = last4(incRes.annualReports || []);
  const bal = last4(balRes.annualReports || []);
  const cf = last4(cfRes.annualReports || []);
  const M = 1e6;

  const revA = inc.map(r => num(r.totalRevenue) / M);
  if (revA.some(v => !(v > 0))) throw new LiveDataError(`Incomplete revenue history for "${symbol}"`);
  const gCagr = (Math.pow(revA[3] / revA[0], 1 / 3) - 1) * 100;
  const consG = r1(clamp(gCagr, -5, 20));

  const gmA = inc.map((r, i) => r1(clamp((num(r.grossProfit, revA[i] * M * 0.4) / M / revA[i]) * 100, 5, 95)));
  const daPs = inc.map((r, i) => clamp((num(r.depreciationAndAmortization, 0) / M / revA[i]) * 100, 0, 25));
  const daGap = r1(daPs.reduce((a, b) => a + b, 0) / daPs.length) || 3;
  const ebmA = inc.map((r, i) => r1(clamp((num(r.operatingIncome, 0) / M / revA[i]) * 100, -30, 60)));
  const emA = ebmA.map((v, i) => r1(v + daPs[i]));

  const taxRates = inc.map(r => {
    const t = num(r.incomeTaxExpense, NaN) / num(r.incomeBeforeTax, NaN);
    return isNaN(t) ? 0.22 : clamp(t, 0.1, 0.35);
  });
  const taxPct = r1(clamp((taxRates.reduce((a, b) => a + b, 0) / taxRates.length) * 100, 15, 30));

  const capexA = cf.map((r, i) => r1(clamp((Math.abs(num(r.capitalExpenditures, 0)) / M / revA[i]) * 100, 0.5, 25)));
  const cashA = bal.map(r => (num(r.cashAndCashEquivalentsAtCarryingValue, 0) + num(r.shortTermInvestments, 0)) / M);
  const debtNow =
    num(bal[3].shortLongTermDebtTotal, NaN) / M ||
    (num(bal[3].shortTermDebt, 0) + num(bal[3].longTermDebt, 0)) / M;

  const roicA = inc.map((r, i) => {
    const invested = (num(bal[i].totalAssets, NaN) - num(bal[i].totalCurrentLiabilities, 0)) / M;
    const nopat = (num(r.operatingIncome, 0) / M) * (1 - taxRates[i]);
    return r1(clamp(invested > 0 ? (nopat / invested) * 100 : 10, -20, 60));
  });
  const rndA = inc.map((r, i) => r1(clamp((num(r.researchAndDevelopment, 0) / M / revA[i]) * 100, 0, 30)));

  const ni3 = num(inc[3].netIncome, 0) / M;
  const divPaid = Math.abs(num(cf[3].dividendPayout, num(cf[3].dividendPayoutCommonStock, 0))) / M;
  const divRate = ni3 > 0 ? clamp(divPaid / ni3, 0, 1) : 0;
  const buybackNow = -Math.abs(num(cf[3].paymentsForRepurchaseOfCommonStock, num(cf[3].paymentsForRepurchaseOfEquity, 0))) / M;

  const shares = Math.max(1, num(ov.SharesOutstanding, 0) / M) || Math.max(1, (price > 0 ? num(ov.MarketCapitalization, 0) / price : 0) / M);

  // 20 quarterly price points from ~5y of monthly closes
  const series = tsRes['Monthly Adjusted Time Series'] || {};
  const months = Object.keys(series).sort(); // ascending
  const closes = months.map(m => num(series[m]['5. adjusted close']));
  const qCloses: number[] = [];
  for (let i = closes.length - 1; i >= 0 && qCloses.length < 20; i -= 3) qCloses.unshift(closes[i]);
  const priceHist = qCloses.length >= 2 ? qCloses : [price * 0.9, price];
  priceHist[priceHist.length - 1] = price;

  const rev = extend(revA, (last, t) => last * Math.pow(1 + consG / 100, t));
  const gm = extend(gmA, (last, t) => clamp(last + 0.2 * t, 5, 95));
  const em = extend(emA, (last, t) => clamp(last + 0.3 * t, -30, 60));
  const capexP = extend(capexA, (last, t) => clamp(last - 0.1 * t, 0.5, 25));
  const fcfProxy = ((emA[3] - taxPct * ebmA[3] / 100 - capexA[3]) / 100) * revA[3];
  const cash = extend(cashA, (last, t) => last + Math.max(0, fcfProxy) * 0.6 * t);
  const roic = extend(roicA, (last, t) => clamp(last + 0.3 * t, -20, 60));
  const rnd = extend(rndA, (last, t) => clamp(last - 0.05 * t, 0, 30));

  const M0 = em[3];
  const B0 = r1(M0 - daGap);
  const emT = r1(clamp(M0 + 2, 5, 45));
  // A starting discount rate from the company's own risk rather than one number
  // for every business: CAPM cost of equity, blended with after-tax cost of
  // debt at its actual capital structure. The risk-free rate and equity risk
  // premium are house assumptions — the WACC slider is there to disagree with.
  const RF = 4.0;
  const ERP = 5.0;
  const DEBT_SPREAD = 1.5;
  const beta = clamp(num(ov.Beta, 1) || 1, 0.3, 2.5);
  const equityV = price * shares;
  const debtV = Math.max(0, debtNow);
  const ke = RF + beta * ERP;
  const kd = (RF + DEBT_SPREAD) * (1 - taxPct / 100);
  const waccNow = equityV + debtV > 0
    ? r1(clamp((equityV * ke + debtV * kd) / (equityV + debtV), 6, 12))
    : 8.5;
  const defA: Assumptions = {
    g: r1(clamp(consG, 0, 25)),
    tg: 2.5, // long-run nominal GDP proxy; not company-specific by design
    em: emT,
    eb: r1(clamp(emT - daGap, 5, 38)),
    tax: taxPct,
    capex: r1(clamp(capexA[3], 3, 12)),
    wacc: waccNow,
  };
  const scDef = {
    bear: { ...defA, g: r1(clamp(defA.g - 4, 0, 22)), em: r1(clamp(defA.em - 3, 20, 42)), eb: r1(clamp(defA.eb - 3, 14, 36)), wacc: r1(defA.wacc + 1), tg: 1.5 },
    base: { ...defA },
    bull: { ...defA, g: r1(clamp(defA.g + 4, 0, 22)), em: r1(clamp(defA.em + 2.5, 20, 42)), eb: r1(clamp(defA.eb + 2.5, 14, 36)), wacc: r1(defA.wacc - 0.5), tg: 3 },
  };

  const netDebt = debtNow - cashA[3];
  const mcapM = price * shares;
  const evM = mcapM + netDebt;
  const eps26 = ((rev[4] * (em[4] - daGap)) / 100) * 0.78 / shares;
  // Reported multiples are passed through or left absent. Substituting a
  // model-derived number (or a literal) would put our own arithmetic in a
  // column the reader reads as the provider's reported fact.
  const reported = (raw: unknown): number | null => {
    const v = num(raw, NaN);
    return isFinite(v) && v > 0 ? r1(v) : null;
  };
  const peNow = reported(ov.ForwardPE) ?? reported(ov.TrailingPE);
  const eveNow = reported(ov.EVToEBITDA);
  const evsNow = reported(ov.EVToRevenue);
  const ocf3 = num(cf[3].operatingCashflow, 0) / M;
  const fcf3 = ocf3 - Math.abs(num(cf[3].capitalExpenditures, 0)) / M;
  const fcfyNow = mcapM > 0 ? r1((fcf3 / mcapM) * 100) : null;
  const pegNow = reported(ov.PEGRatio);

  const ccy = ov.Currency || 'USD';
  const fy0 = num(String(inc[3].fiscalDateEnding || '').slice(0, 4), new Date().getFullYear() - 1);
  const lo52 = reported(ov['52WeekLow']);
  const hi52 = reported(ov['52WeekHigh']);
  const wk52Now: [number, number] | null = lo52 != null && hi52 != null ? [lo52, hi52] : null;

  const gmTrendUp = gmA[3] >= gmA[0];
  const fcfM3 = revA[3] > 0 ? r1((fcf3 / revA[3]) * 100) : 0;
  const growthSeries = rev.map((r, i) => (i ? r1((r / rev[i - 1] - 1) * 100) : consG));
  const fcfMSeries = rev.map((r, i) => r1(clamp(em[i] - (taxPct * (em[i] - daGap)) / 100 - capexP[i], -30, 60)));
  const mkKpi = (l: string, vals: number[], fmt: (v: number) => string, higherIsBetter = true): Kpi => {
    const good: 0 | 1 = (higherIsBetter ? vals[3] >= vals[2] : vals[3] <= vals[2]) ? 1 : 0;
    return { l, latest: fmt(vals[3]), est: fmt(vals[4]), vals, good, st: good ? 'ON TRACK' : 'WATCH', estFrom: 4, period: 'year' };
  };

  return {
    ticker: ov.Symbol,
    name: ov.Name || symbol,
    meta: `${ov.Exchange || 'Live'} · ${(ov.Industry || ov.Sector || 'Live data').toLowerCase().replace(/\b\w/g, (ch: string) => ch.toUpperCase())}`,
    price,
    chg,
    chgPos,
    shares: Math.round(shares),
    debt: Math.round(debtNow),
    M0,
    B0,
    daGap,
    consG,
    rev,
    gm,
    em,
    capexP,
    cash,
    roic,
    rnd,
    buyback: () => Math.round(buybackNow),
    divRate: r1(divRate * 100) / 100,
    priceHist,
    defA,
    scDef,
    hist: { pe: peNow, eve: eveNow, evs: evsNow, fcfy: fcfyNow, peg: pegNow },
    wk52: wk52Now,
    // no historical multiple ranges exist for live data; the football field
    // builds its comparable bars from the peer group instead
    peBand: null,
    eveBand: null,
    evsBand: null,
    rating: 'LIVE DATA · UNRATED',
    buyBelow: Math.round(price * 0.85),
    segs: [], // segment split is not available from this API
    bull: [
      gCagr >= 0
        ? `Revenue compounded ${r1(gCagr)}% a year over the last three fiscal years, reaching ${(revA[3] / 1000).toFixed(1)}bn ${ccy}.`
        : `Revenue is ${(revA[3] / 1000).toFixed(1)}bn ${ccy} after falling ${r1(-gCagr)}% a year for three years — a low base to price off if the cycle turns.`,
      `${gmTrendUp ? 'Gross margin expanded' : 'Gross margin held near'} ${gmA[3].toFixed(1)}% while EBITDA margin runs at ${emA[3].toFixed(1)}%.`,
      `Latest-year free cash flow of ${(fcf3 / 1000).toFixed(1)}bn ${ccy} (${fcfM3.toFixed(1)}% margin) funds the ${divRate > 0 ? 'dividend and ' : ''}reinvestment.`,
    ],
    bear: [
      gCagr >= 0
        ? `The reverse DCF prices in ${r1(clamp(gCagr, -5, 20))}%+ growth — any deceleration from the historical ${r1(gCagr)}% pace pressures the multiple.`
        : `Revenue has fallen ${r1(-gCagr)}% a year for three years; the estimate years assume that stabilises, which the price has to justify.`,
      `${netDebt > 0 ? `Net debt of ${(netDebt / 1000).toFixed(1)}bn ${ccy} adds leverage to the equity story.` : 'A rich valuation leaves little margin of safety despite the net cash position.'}`,
      peNow != null
        ? `At ${peNow}x forward earnings the market already assumes continued margin ${emA[3] >= emA[0] ? 'expansion' : 'recovery'}.`
        : `The market already assumes continued margin ${emA[3] >= emA[0] ? 'expansion' : 'recovery'} — test how much in Expectations.`,
    ],
    debate: `This profile is generated from live filings: the model extrapolates ${consG.toFixed(0)}% consensus-proxy growth and terminal margins near ${emT.toFixed(0)}%. Use the Expectations page to test what the current price of ${ccy} ${price.toFixed(2)} really implies.`,
    thesis: [
      { n: '01', h: 'What history says.', t: `Three-year revenue CAGR of ${r1(gCagr)}% with EBITDA margins moving from ${emA[0].toFixed(1)}% to ${emA[3].toFixed(1)}%. The estimate years extrapolate that trajectory.` },
      { n: '02', h: 'What the price implies.', t: 'See Expectations: the reverse DCF solves for the growth and terminal margin embedded in the current quote — compare it against the historical run-rate.' },
      { n: '03', h: 'What to verify by hand.', t: 'Segment mix, guidance, and one-offs are not in this feed. Confirm the extrapolated margins and capex against the latest report before acting on the output.' },
    ],
    catalysts: [
      { t: 'Next quarterly report', when: 'UPCOMING' },
      { t: 'Fiscal-year results & guidance', when: `FY${(fy0 + 1) % 100}` },
      { t: 'Capital-allocation update', when: 'ONGOING' },
    ],
    risks: [
      { t: 'Estimates here are extrapolations, not analyst consensus', sev: 'HIGH' },
      { t: 'Growth deceleration vs the historical CAGR', sev: 'MED' },
      { t: netDebt > 0 ? 'Refinancing / leverage risk' : 'Multiple compression', sev: 'MED' },
    ],
    variantBody:
      'Scenario spread on live data: the bear case works out to {ccy} {bear} per share and the bull case to {ccy} {bull}. A simple 15% discount to the current quote — {ccy} {buy} — is marked as a reference entry level, not a recommendation.'
        .replace(/\{ccy\}/g, ccy),
    kpis: [
      mkKpi('Revenue growth (YoY)', growthSeries, v => v.toFixed(1) + '%'),
      mkKpi('Gross margin', gm, v => v.toFixed(1) + '%'),
      mkKpi('EBITDA margin', em, v => v.toFixed(1) + '%'),
      mkKpi('FCF margin (modelled)', fcfMSeries, v => v.toFixed(1) + '%'),
      mkKpi('ROIC', roic, v => v.toFixed(1) + '%'),
    ],
    valFootTail: 'reported multiples are the provider\u2019s own current figures, not a five-year average.',
    ccy,
    fy0,
    mktRow: peerFromOverview(ov),
    live: true,
    updated: new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  };
}
