import { describe, it, expect } from 'vitest';
import { suggestPeers } from '../peers';
import { peerFromOverview } from '../marketRow';
import type { Company } from '../data';

const co = (ticker: string, name: string, meta: string, ccy = 'USD') =>
  ({ ticker, name, meta, ccy }) as Company;

describe('suggestPeers', () => {
  it('matches the modern industry taxonomy, not just the SIC-flavoured one', () => {
    // regression: these spellings once fell through to the industrials bucket,
    // so pharma and telecom companies were compared against Caterpillar
    expect(suggestPeers(co('PFE', 'Pfizer Inc', 'NYSE · DRUG MANUFACTURERS - GENERAL'), 4))
      .toContain('JNJ');
    expect(suggestPeers(co('CSCO', 'Cisco', 'NASDAQ · COMMUNICATION EQUIPMENT'), 4))
      .toContain('AAPL');
    expect(suggestPeers(co('XOM', 'Exxon Mobil Corp', 'NYSE · OIL & GAS INTEGRATED'), 4))
      .toContain('CVX');
  });

  it('still matches the SIC-flavoured taxonomy', () => {
    expect(suggestPeers(co('IBM', 'IBM', 'NYSE · INFORMATION TECHNOLOGY SERVICES'), 5))
      .toEqual(['ACN', 'INFY', 'CTSH', 'DXC', 'EPAM']);
  });

  it('never suggests the company itself', () => {
    for (const t of ['IBM', 'XOM', 'NVO', 'AAPL', 'JPM']) {
      expect(suggestPeers(co(t, t, 'NYSE · OIL & GAS INTEGRATED'), 6)).not.toContain(t);
    }
  });

  it('leads a Nordic company with Nordic comparables, then tops up', () => {
    const eqnr = suggestPeers(co('EQNR', 'Equinor ASA ADR', 'NYSE · OIL & GAS INTEGRATED'), 5);
    expect(eqnr[0]).toBe('FRO');
    expect(eqnr).toContain('XOM');
    // detected via the ASA in the name — the ADR lists in USD on a US exchange
    const nvo = suggestPeers(co('NVO', 'Novo Nordisk A/S', 'NYSE · DRUG MANUFACTURERS - GENERAL'), 5);
    expect(nvo[0]).toBe('GMAB');
  });

  it('leaves US companies with US peers', () => {
    const xom = suggestPeers(co('XOM', 'Exxon Mobil Corp', 'NYSE · OIL & GAS INTEGRATED'), 5);
    expect(xom).not.toContain('EQNR');
    expect(xom).not.toContain('FRO');
  });

  it('treats a Nordic reporting currency as Nordic', () => {
    const n = suggestPeers(co('XXXX', 'Something', 'Oslo Børs · OIL & GAS INTEGRATED', 'NOK'), 3);
    expect(n[0]).toBe('EQNR');
  });

  it('returns a usable group for an unrecognised industry', () => {
    const g = suggestPeers(co('ZZZZ', 'Mystery Co', 'NYSE · SOMETHING UNCLASSIFIABLE'), 5);
    expect(g.length).toBe(5);
  });
});

describe('peerFromOverview', () => {
  const ov = {
    Symbol: 'ACN', Name: 'Accenture plc', Currency: 'USD',
    MarketCapitalization: '116000000000', RevenueTTM: '65000000000', EBITDA: '11505000000',
    OperatingMarginTTM: '0.17', QuarterlyRevenueGrowthYOY: '0.056', ReturnOnEquityTTM: '0.244',
    ForwardPE: '12.7', EVToEBITDA: '9.2', EVToRevenue: '1.5',
  };

  it('maps the provider payload to a comparison row', () => {
    const p = peerFromOverview(ov);
    expect(p).toMatchObject({ ticker: 'ACN', mcap: 116, revG: 5.6, ebitM: 17, quality: 24.4, pe: 12.7 });
    expect(p.ebitdaM).toBeCloseTo(17.7, 1);
    expect(p.live).toBe(true);
  });

  it('reports no free cash flow yield, because OVERVIEW does not publish one', () => {
    expect(peerFromOverview(ov).fcfY).toBeNull();
  });

  it('prefers forward P/E and falls back to trailing', () => {
    expect(peerFromOverview({ ...ov, ForwardPE: 'None', PERatio: '21.2' }).pe).toBe(21.2);
  });

  it('degrades to zero rather than NaN on a sparse payload', () => {
    const p = peerFromOverview({ Symbol: 'X' });
    expect(Object.values(p).every(v => !Number.isNaN(v as number))).toBe(true);
    expect(p.ccy).toBe('USD');
  });
});

describe('suggestPeers · the widened Nordic universe', () => {
  const co2 = (t: string, n: string, m: string) => ({ ticker: t, name: n, meta: m, ccy: 'USD' }) as Company;

  it('gives a tanker company shipping comparables, not UPS', () => {
    // MARINE SHIPPING used to land in `transport`, where a crude tanker was
    // measured against couriers and railroads
    const hafn = suggestPeers(co2('HAFN', 'Hafnia Limited', 'NYSE · MARINE SHIPPING'), 5);
    expect(hafn).toContain('FRO');
    expect(hafn).toContain('DHT');
    expect(hafn).not.toContain('UPS');
    expect(hafn).not.toContain('UNP');
  });

  it('routes drillers and equipment names away from the integrated majors', () => {
    const sdrl = suggestPeers(co2('SDRL', 'Seadrill Limited', 'NYSE · OIL & GAS DRILLING'), 5);
    expect(sdrl).toContain('BORR');
    expect(sdrl).toContain('SLB');
    expect(sdrl).not.toContain('XOM');
    expect(suggestPeers(co2('BKR', 'Baker Hughes Co', 'NASDAQ · OIL & GAS EQUIPMENT & SERVICES'), 4))
      .toContain('NOV');
  });

  it('leaves Equinor own group alone', () => {
    // the new names must not displace the majors for an integrated producer
    const eqnr = suggestPeers(co2('EQNR', 'Equinor ASA ADR', 'NYSE · OIL & GAS INTEGRATED'), 5);
    expect(eqnr).toEqual(['FRO', 'XOM', 'CVX', 'COP', 'EOG']);
  });

  it('reaches the new Nordic names in their own sectors', () => {
    expect(suggestPeers(co2('ASND', 'Ascendis Pharma AS', 'NASDAQ · BIOTECHNOLOGY'), 3)).toContain('GMAB');
    expect(suggestPeers(co2('GMAB', 'Genmab A/S', 'NASDAQ · BIOTECHNOLOGY'), 3)).toContain('ASND');
    expect(suggestPeers(co2('NVO', 'Novo Nordisk A/S', 'NYSE · DRUG MANUFACTURERS - GENERAL'), 3)).toContain('ALVO');
    expect(suggestPeers(co2('OTLY', 'Oatly Group AB ADR', 'NASDAQ · PACKAGED FOODS'), 3)).toContain('KO');
  });

  it('still leaves US companies unaffected', () => {
    const kmi = suggestPeers(co2('CVX', 'Chevron Corp', 'NYSE · OIL & GAS INTEGRATED'), 5);
    expect(kmi).not.toContain('SDRL');
    expect(suggestPeers(co2('UPS', 'United Parcel Service', 'NYSE · INTEGRATED FREIGHT & LOGISTICS'), 4))
      .toContain('FDX');
  });
});
