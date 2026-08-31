import type { Peer } from './data';

/**
 * Maps one Alpha Vantage OVERVIEW payload to a comparison row.
 *
 * Shared by the peer fetcher and the live-company fetcher so that a company and
 * its peers are always measured the same way. Mixing sources here is what makes
 * a peer table lie: the model's annual FY+1 growth against the provider's
 * latest-quarter growth put the selected company in a different universe from
 * its own peer group.
 */

const num = (x: unknown): number => {
  const v = typeof x === 'string' ? parseFloat(x) : typeof x === 'number' ? x : NaN;
  return isNaN(v) ? 0 : v;
};
const r1 = (v: number) => Math.round(v * 10) / 10;

export function peerFromOverview(ov: any): Peer {
  const revTTM = num(ov.RevenueTTM);
  const ebitda = num(ov.EBITDA);
  return {
    ticker: ov.Symbol,
    name: ov.Name || ov.Symbol,
    mcap: r1(num(ov.MarketCapitalization) / 1e9),
    revG: r1(num(ov.QuarterlyRevenueGrowthYOY) * 100),
    ebitdaM: revTTM > 0 ? r1((ebitda / revTTM) * 100) : 0,
    ebitM: r1(num(ov.OperatingMarginTTM) * 100),
    quality: r1(num(ov.ReturnOnEquityTTM) * 100),
    pe: r1(num(ov.ForwardPE) || num(ov.PERatio)),
    evEbitda: r1(num(ov.EVToEBITDA)),
    evSales: r1(num(ov.EVToRevenue)),
    fcfY: null, // not exposed by OVERVIEW at this level
    ccy: ov.Currency || 'USD',
    live: true,
  };
}
