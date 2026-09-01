import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchLiveCompany, LiveDataError } from '../live';

/** Four fiscal years of a plainly profitable company, oldest last (API order). */
const years = ['2022-12-31', '2023-12-31', '2024-12-31', '2025-12-31'].reverse();
const B = (n: number) => String(n * 1e9);

const income = (over: Record<string, unknown> = {}) =>
  years.map((fiscalDateEnding, i) => ({
    fiscalDateEnding, reportedCurrency: 'USD',
    totalRevenue: B(100 - i * 5), grossProfit: B(50 - i * 3),
    operatingIncome: B(20 - i), depreciationAndAmortization: B(5),
    incomeBeforeTax: B(18 - i), incomeTaxExpense: B(4), netIncome: B(14 - i),
    researchAndDevelopment: B(6), ...over,
  }));
const balance = (over: Record<string, unknown> = {}) =>
  years.map((fiscalDateEnding) => ({
    fiscalDateEnding, totalAssets: B(200), totalCurrentLiabilities: B(50),
    cashAndCashEquivalentsAtCarryingValue: B(10), shortTermInvestments: B(2),
    shortLongTermDebtTotal: B(40), ...over,
  }));
const cash = (over: Record<string, unknown> = {}) =>
  years.map((fiscalDateEnding) => ({
    fiscalDateEnding, operatingCashflow: B(25), capitalExpenditures: B(8),
    dividendPayout: B(3), ...over,
  }));

function stubApi(parts: Record<string, unknown> = {}) {
  const payloads: Record<string, unknown> = {
    OVERVIEW: { Symbol: 'TEST', Name: 'Test Corp', Currency: 'USD', Exchange: 'NYSE',
      Industry: 'OIL & GAS INTEGRATED', SharesOutstanding: String(1e9),
      MarketCapitalization: B(150), Beta: '1.0', ForwardPE: '10', EVToEBITDA: '6',
      EVToRevenue: '1.5', '52WeekLow': '80', '52WeekHigh': '160' },
    GLOBAL_QUOTE: { 'Global Quote': { '05. price': '150.00', '09. change': '1.00', '10. change percent': '0.67%' } },
    INCOME_STATEMENT: { annualReports: income() },
    BALANCE_SHEET: { annualReports: balance() },
    CASH_FLOW: { annualReports: cash() },
    TIME_SERIES_MONTHLY_ADJUSTED: { 'Monthly Adjusted Time Series':
      Object.fromEntries([...Array(60)].map((_, i) => [`2021-${String((i % 12) + 1).padStart(2, '0')}-28`, { '5. adjusted close': String(100 + i) }])) },
    ...parts,
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const fn = new URL(url).searchParams.get('function') as string;
    return { ok: true, status: 200, json: async () => payloads[fn] };
  }));
}

beforeEach(() => {
  // the adapter spaces requests ~1.1s apart for the rate limit; not in tests
  vi.stubGlobal('setTimeout', ((fn: () => void) => { fn(); return 0; }) as unknown as typeof setTimeout);
});
afterEach(() => vi.restoreAllMocks());

describe('fetchLiveCompany', () => {
  it('builds a company from complete filings', async () => {
    stubApi();
    const c = await fetchLiveCompany('TEST', 'k');
    expect(c.ticker).toBe('TEST');
    expect(c.price).toBe(150);
    expect(c.ccy).toBe('USD');
    expect(c.rev).toHaveLength(8);
    expect(c.hasGross).toBe(true);
    expect(c.notes).toEqual([]);
    expect(c.roic.every(v => v != null)).toBe(true);
  });

  it('omits gross margin instead of inventing one when gross profit is missing', async () => {
    stubApi({ INCOME_STATEMENT: { annualReports: income({ grossProfit: 'None' }) } });
    const c = await fetchLiveCompany('TEST', 'k');
    expect(c.hasGross).toBe(false);
    expect(c.notes?.join(' ')).toMatch(/gross/i);
    // the old behaviour silently substituted a 40% margin
    expect(c.gm.every(v => v === 0)).toBe(true);
  });

  it('falls back to the cash-flow statement for D&A before giving up', async () => {
    stubApi({
      INCOME_STATEMENT: { annualReports: income({ depreciationAndAmortization: 'None' }) },
      CASH_FLOW: { annualReports: cash({ depreciationDepletionAndAmortization: B(5) }) },
    });
    const c = await fetchLiveCompany('TEST', 'k');
    expect(c.daGap).toBeGreaterThan(0);       // recovered from a real reported figure
    expect(c.M0).toBeGreaterThan(c.B0);       // EBITDA still separates from EBIT
  });

  it('refuses the company when D&A is reported nowhere', async () => {
    stubApi({
      INCOME_STATEMENT: { annualReports: income({ depreciationAndAmortization: 'None' }) },
      CASH_FLOW: { annualReports: cash() },
    });
    await expect(fetchLiveCompany('TEST', 'k')).rejects.toBeInstanceOf(LiveDataError);
  });

  it('blanks ROIC rather than defaulting to 10% when invested capital is underivable', async () => {
    stubApi({ BALANCE_SHEET: { annualReports: balance({ totalAssets: 'None' }) } });
    const c = await fetchLiveCompany('TEST', 'k');
    expect(c.roic.slice(0, 4).every(v => v == null)).toBe(true);
    expect(c.notes?.join(' ')).toMatch(/invested capital/i);
  });

  it('discloses an assumed tax rate when no year reports one', async () => {
    stubApi({ INCOME_STATEMENT: { annualReports: income({ incomeTaxExpense: 'None', incomeBeforeTax: 'None' }) } });
    const c = await fetchLiveCompany('TEST', 'k');
    expect(c.defA.tax).toBe(22);
    expect(c.notes?.join(' ')).toMatch(/22% assumption/i);
  });

  it('leaves unreported multiples and the 52-week range absent, not fabricated', async () => {
    stubApi({ OVERVIEW: { Symbol: 'TEST', Name: 'Test Corp', Currency: 'USD',
      SharesOutstanding: String(1e9), MarketCapitalization: B(150), Industry: 'OIL & GAS INTEGRATED' } });
    const c = await fetchLiveCompany('TEST', 'k');
    expect(c.hist.peg).toBeNull();            // once silently became 2.0
    expect(c.wk52).toBeNull();                // once became price x0.75 / x1.25
    expect(c.peBand).toBeNull();              // once became a +/-15% spread
  });

  it('derives WACC from the company beta rather than a flat rate', async () => {
    stubApi({ OVERVIEW: { Symbol: 'A', Name: 'A', Currency: 'USD', Beta: '0.4',
      SharesOutstanding: String(1e9), MarketCapitalization: B(150), Industry: 'OIL & GAS INTEGRATED' } });
    const low = (await fetchLiveCompany('A', 'k')).defA.wacc;
    stubApi({ OVERVIEW: { Symbol: 'B', Name: 'B', Currency: 'USD', Beta: '2.0',
      SharesOutstanding: String(1e9), MarketCapitalization: B(150), Industry: 'OIL & GAS INTEGRATED' } });
    const high = (await fetchLiveCompany('B', 'k')).defA.wacc;
    expect(high).toBeGreaterThan(low);
    expect(low).toBeGreaterThanOrEqual(6);
    expect(high).toBeLessThanOrEqual(12);
  });

  it('rejects a symbol with no fundamentals', async () => {
    stubApi({ OVERVIEW: {} });
    await expect(fetchLiveCompany('NOPE', 'k')).rejects.toBeInstanceOf(LiveDataError);
  });
});

describe('effective tax rate', () => {
  it('keeps a genuinely high statutory regime instead of capping it at 30%', async () => {
    // Equinor reports 63-80% under Norway's petroleum tax; a 30% ceiling was
    // handing it more than double its real after-tax cash flow
    stubApi({ INCOME_STATEMENT: { annualReports: income({ incomeBeforeTax: B(25), incomeTaxExpense: B(20) }) } });
    const c = await fetchLiveCompany('TEST', 'k');
    expect(c.defA.tax).toBeCloseTo(80, 0);
  });

  it('keeps an ordinary rate unchanged', async () => {
    stubApi({ INCOME_STATEMENT: { annualReports: income({ incomeBeforeTax: B(20), incomeTaxExpense: B(4) }) } });
    expect((await fetchLiveCompany('TEST', 'k')).defA.tax).toBeCloseTo(20, 0);
  });

  it('ignores tax-benefit years rather than averaging them into the forward rate', async () => {
    // IBM books a net benefit in three years of four; averaging those in gives
    // ~3%, which is no more sustainable than a 30% cap was for Equinor
    const reports = income();
    reports[0] = { ...reports[0], incomeBeforeTax: B(10), incomeTaxExpense: B(-0.2) };
    reports[1] = { ...reports[1], incomeBeforeTax: B(6), incomeTaxExpense: B(-0.2) };
    reports[2] = { ...reports[2], incomeBeforeTax: B(9), incomeTaxExpense: B(1.2) };  // the one taxpaying year
    reports[3] = { ...reports[3], incomeBeforeTax: B(1), incomeTaxExpense: B(-0.6) };
    stubApi({ INCOME_STATEMENT: { annualReports: reports } });
    const c = await fetchLiveCompany('TEST', 'k');
    expect(c.defA.tax).toBeCloseTo(13.3, 0);
    expect(c.notes?.join(' ')).toMatch(/1 of 4 years/);
  });

  it('excludes loss years, whose rate says nothing about tax on future profits', async () => {
    const reports = income();
    reports[0] = { ...reports[0], incomeBeforeTax: B(-10), incomeTaxExpense: B(3) };
    stubApi({ INCOME_STATEMENT: { annualReports: reports } });
    const c = await fetchLiveCompany('TEST', 'k');
    expect(c.defA.tax).toBeGreaterThan(0);
    expect(c.notes?.join(' ')).toMatch(/3 of 4 years/);
  });

  it('discloses the assumption when no year qualifies at all', async () => {
    stubApi({ INCOME_STATEMENT: { annualReports: income({ incomeBeforeTax: B(-5), incomeTaxExpense: B(-1) }) } });
    const c = await fetchLiveCompany('TEST', 'k');
    expect(c.defA.tax).toBe(22);
    expect(c.notes?.join(' ')).toMatch(/22% assumption/);
  });
});
