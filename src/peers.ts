import type { Company, Peer } from './data';
import { avQuery } from './live';

/**
 * Live peer groups.
 *
 * Alpha Vantage has no "competitors" endpoint, so the comparison set is drawn
 * from a built-in universe of liquid listed names grouped by what they do, and
 * matched against the company's own reported industry (falling back to its
 * sector). Anything the universe misses can be added by ticker.
 *
 * Each peer costs exactly one OVERVIEW request, so a group is cheap relative to
 * a full company load and is cached per company to avoid paying twice.
 */

const UNIVERSE: Record<string, string[]> = {
  semiconductors: ['NVDA', 'AMD', 'INTC', 'TXN', 'AVGO', 'QCOM', 'MU', 'ADI', 'NXPI', 'ON'],
  software: ['MSFT', 'ORCL', 'CRM', 'ADBE', 'SAP', 'INTU', 'NOW', 'WDAY'],
  itServices: ['IBM', 'ACN', 'INFY', 'CTSH', 'DXC', 'EPAM'],
  internet: ['GOOGL', 'META', 'NFLX', 'SPOT', 'UBER', 'ABNB'],
  hardware: ['AAPL', 'DELL', 'HPQ', 'HPE', 'STX', 'WDC', 'NTAP', 'CSCO'],
  pharma: ['JNJ', 'PFE', 'MRK', 'LLY', 'ABBV', 'BMY', 'AZN', 'NVS', 'GSK', 'SNY'],
  biotech: ['AMGN', 'GILD', 'REGN', 'VRTX', 'BIIB', 'MRNA'],
  medtech: ['MDT', 'ABT', 'SYK', 'BSX', 'BDX', 'ZBH', 'EW'],
  banks: ['JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'USB', 'PNC'],
  insurance: ['UNH', 'CI', 'ELV', 'PGR', 'ALL', 'TRV', 'AIG', 'MET'],
  payments: ['V', 'MA', 'AXP', 'PYPL', 'FIS', 'GPN'],
  retail: ['WMT', 'TGT', 'COST', 'HD', 'LOW', 'DG', 'DLTR', 'KR'],
  staples: ['PG', 'CL', 'KMB', 'MO', 'PM', 'EL'],
  foodBev: ['KO', 'PEP', 'MDLZ', 'KHC', 'GIS', 'STZ', 'HSY', 'K'],
  restaurants: ['MCD', 'SBUX', 'CMG', 'YUM', 'QSR', 'DPZ'],
  apparel: ['NKE', 'LULU', 'RL', 'PVH', 'UAA', 'SKX'],
  autos: ['TSLA', 'F', 'GM', 'STLA', 'TM', 'HMC', 'RIVN'],
  aerospace: ['BA', 'LMT', 'RTX', 'NOC', 'GD', 'LHX', 'TDG', 'HWM'],
  industrials: ['CAT', 'DE', 'HON', 'MMM', 'EMR', 'ETN', 'PH', 'ITW', 'CMI', 'GE'],
  energy: ['XOM', 'CVX', 'COP', 'EOG', 'SLB', 'PSX', 'VLO', 'MPC', 'OXY', 'HAL'],
  utilities: ['NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC', 'XEL', 'ED'],
  telecom: ['T', 'VZ', 'TMUS', 'CMCSA', 'CHTR'],
  transport: ['UPS', 'FDX', 'UNP', 'CSX', 'NSC', 'DAL', 'UAL', 'LUV'],
  chemicals: ['LIN', 'APD', 'SHW', 'DOW', 'DD', 'PPG', 'ECL'],
  reits: ['PLD', 'AMT', 'EQIX', 'SPG', 'O', 'PSA', 'CCI'],
  materials: ['FCX', 'NEM', 'NUE', 'VALE', 'RIO', 'BHP'],
};

/** Industry-string patterns, most specific first. */
const BY_INDUSTRY: [RegExp, keyof typeof UNIVERSE][] = [
  [/SEMICONDUCTOR/, 'semiconductors'],
  [/PREPACKAGED SOFTWARE|SOFTWARE/, 'software'],
  [/INFORMATION TECHNOLOGY SERVICES|COMPUTER PROGRAMMING|DATA PROCESSING/, 'itServices'],
  [/SEARCH|INTERNET|ONLINE|WEB/, 'internet'],
  [/ELECTRONIC COMPUTERS|COMPUTER (STORAGE|PERIPHERAL|COMMUNICATIONS)|TELEPHONE & TELEGRAPH APPARATUS/, 'hardware'],
  [/PHARMACEUTICAL|MEDICINAL|BOTANICAL/, 'pharma'],
  [/BIOLOGICAL PRODUCTS|BIOTECH/, 'biotech'],
  [/SURGICAL|MEDICAL INSTRUMENT|ELECTROMEDICAL|ORTHOPEDIC|DENTAL/, 'medtech'],
  [/COMMERCIAL BANKS|SAVINGS INSTITUTION|BANK/, 'banks'],
  [/INSURANCE|HOSPITAL & MEDICAL SERVICE/, 'insurance'],
  [/FINANCE SERVICES|BUSINESS SERVICES.*CREDIT|CREDIT CARD/, 'payments'],
  [/RETAIL/, 'retail'],
  [/EATING PLACES|RESTAURANT/, 'restaurants'],
  [/BEVERAGE|FOOD AND KINDRED|SUGAR|GRAIN MILL|CANNED/, 'foodBev'],
  [/SOAP|PERFUME|COSMETIC|TOILET|CIGARETTE|TOBACCO/, 'staples'],
  [/APPAREL|FOOTWEAR|LEATHER|RUBBER.*FOOTWEAR/, 'apparel'],
  [/MOTOR VEHICLE|AUTO/, 'autos'],
  [/AIRCRAFT|GUIDED MISSILE|SEARCH.*NAVIGATION|ORDNANCE/, 'aerospace'],
  [/ELECTRIC SERVICES|GAS.*DISTRIBUTION|WATER SUPPLY|COGENERATION/, 'utilities'],
  [/TELEPHONE COMMUNICATIONS|RADIOTELEPHONE|CABLE|BROADCAST/, 'telecom'],
  [/AIR TRANSPORT|TRUCKING|RAILROAD|WATER TRANSPORT|COURIER/, 'transport'],
  [/CHEMICAL|PLASTIC|PAINT|INDUSTRIAL GASES/, 'chemicals'],
  [/REAL ESTATE|REIT|LESSOR/, 'reits'],
  [/GOLD|MINING|STEEL|METAL|COPPER|IRON/, 'materials'],
  [/MACHINERY|ENGINE|CONSTRUCTION.*EQUIPMENT|ELECTRONIC COMPONENTS|INSTRUMENTS/, 'industrials'],
  [/PETROLEUM|CRUDE|OIL|NATURAL GAS|DRILLING/, 'energy'],
];

const BY_SECTOR: [RegExp, keyof typeof UNIVERSE][] = [
  [/TECHNOLOGY/, 'software'],
  [/LIFE SCIENCES/, 'pharma'],
  [/FINANCE/, 'banks'],
  [/ENERGY|TRANSPORTATION/, 'energy'],
  [/REAL ESTATE|CONSTRUCTION/, 'reits'],
  [/MANUFACTURING/, 'industrials'],
  [/TRADE|SERVICES/, 'retail'],
];

/** Tickers to compare a company against, excluding the company itself. */
export function suggestPeers(company: Company, limit = 6): string[] {
  const industry = (company.meta || '').toUpperCase();
  const hit =
    BY_INDUSTRY.find(([re]) => re.test(industry)) || BY_SECTOR.find(([re]) => re.test(industry));
  const group = hit ? UNIVERSE[hit[1]] : UNIVERSE.industrials;
  return group.filter(t => t !== company.ticker.toUpperCase()).slice(0, limit);
}

const num = (x: unknown): number => {
  const v = typeof x === 'string' ? parseFloat(x) : typeof x === 'number' ? x : NaN;
  return isNaN(v) ? 0 : v;
};
const r1 = (v: number) => Math.round(v * 10) / 10;

/** One OVERVIEW request → one comparison row. */
export async function fetchPeer(symbol: string, apiKey: string): Promise<Peer> {
  const ov = await avQuery({ function: 'OVERVIEW', symbol }, apiKey);
  if (!ov.Symbol) throw new Error(`No fundamentals for "${symbol}"`);
  const revTTM = num(ov.RevenueTTM);
  const ebitda = num(ov.EBITDA);
  return {
    ticker: ov.Symbol,
    name: ov.Name || symbol,
    mcap: r1(num(ov.MarketCapitalization) / 1e9),
    revG: r1(num(ov.QuarterlyRevenueGrowthYOY) * 100),
    ebitdaM: revTTM > 0 ? r1((ebitda / revTTM) * 100) : 0,
    ebitM: r1(num(ov.OperatingMarginTTM) * 100),
    quality: r1(num(ov.ReturnOnEquityTTM) * 100),
    pe: r1(num(ov.ForwardPE) || num(ov.PERatio)),
    evEbitda: r1(num(ov.EVToEBITDA)),
    evSales: r1(num(ov.EVToRevenue)),
    fcfY: null, // not exposed by OVERVIEW; a per-peer cash-flow call would double the cost
    ccy: ov.Currency || 'USD',
    live: true,
  };
}

/**
 * Fetch a group one request at a time, spaced for the provider's 1/sec limit.
 * Individual failures are skipped rather than failing the whole group.
 */
export async function fetchPeerGroup(
  symbols: string[],
  apiKey: string,
  onProgress?: (done: number, total: number, symbol: string) => void,
): Promise<{ peers: Peer[]; failed: string[] }> {
  const peers: Peer[] = [];
  const failed: string[] = [];
  for (let i = 0; i < symbols.length; i++) {
    if (i) await new Promise(r => setTimeout(r, 1100));
    onProgress?.(i, symbols.length, symbols[i]);
    try {
      peers.push(await fetchPeer(symbols[i], apiKey));
    } catch {
      failed.push(symbols[i]);
    }
  }
  onProgress?.(symbols.length, symbols.length, '');
  return { peers, failed };
}

// ---- cache: a group costs real quota, so keep it for a day ----

const KEY = 'mee_peers';
const TTL = 24 * 60 * 60 * 1000;

type Cache = Record<string, { at: number; peers: Peer[] }>;

function readCache(): Cache {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

export function loadCachedPeers(ticker: string): Peer[] | null {
  const entry = readCache()[ticker];
  if (!entry || Date.now() - entry.at > TTL) return null;
  return entry.peers;
}

export function cachePeers(ticker: string, peers: Peer[]) {
  try {
    const all = readCache();
    all[ticker] = { at: Date.now(), peers };
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable — the group just won't survive a reload */
  }
}
