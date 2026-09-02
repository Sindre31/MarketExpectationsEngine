import type { Company, Peer } from './data';
import { avQuery } from './live';
import { peerFromOverview } from './marketRow';

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
  // drillers and equipment names sit apart from the integrated majors: a rig
  // operator's multiples say nothing about Equinor's, and vice versa
  oilServices: ['SLB', 'HAL', 'BKR', 'NOV', 'RIG', 'SDRL', 'BORR'],
  // tankers and gas carriers, kept out of `transport` — a crude tanker has
  // nothing in common with UPS or Union Pacific. The names are Nordic-heavy
  // because the listed sector is, not by regional preference.
  shipping: ['FRO', 'DHT', 'NAT', 'HAFN', 'SFL', 'FLNG', 'BWLP'],
  utilities: ['NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC', 'XEL', 'ED'],
  telecom: ['T', 'VZ', 'TMUS', 'CMCSA', 'CHTR'],
  transport: ['UPS', 'FDX', 'UNP', 'CSX', 'NSC', 'DAL', 'UAL', 'LUV'],
  chemicals: ['LIN', 'APD', 'SHW', 'DOW', 'DD', 'PPG', 'ECL'],
  reits: ['PLD', 'AMT', 'EQIX', 'SPG', 'O', 'PSA', 'CCI'],
  materials: ['FCX', 'NEM', 'NUE', 'VALE', 'RIO', 'BHP'],
};

/**
 * Nordic names, kept separate so a Nordic company is compared against its own
 * region first and topped up from the list above.
 *
 * These are all primary US listings or NYSE/NASDAQ ADRs. That is not a
 * preference but a coverage limit: the provider returns no fundamentals for
 * local Nordic tickers (EQNR.OL, NOVO-B.CO, ERIC-B.ST all come back empty),
 * nor for OTC pink-sheet ADRs (NHYDY, YARIY, DNNGY, ATLKY, VLVLY, NRDBY were
 * all tested and returned nothing). Every ticker here has been checked to
 * return a usable OVERVIEW; anything else can still be added by hand on the
 * Peers page. GOGL and ZEAL were tried and answer "No data returned"; EVAX
 * returns data but is pre-revenue with negative equity, which makes it noise
 * in a five-name group rather than a comparison.
 *
 * "Nordic" here is an editorial call, not a provider field. The shipping and
 * offshore names report Country: USA because they are Bermuda-domiciled, but
 * they are Oslo-listed and Norwegian-run, and Frontline — in this list from the
 * start — is the same shape. Spotify is a Luxembourg SA on the same reasoning.
 */
const NORDIC: Partial<Record<keyof typeof UNIVERSE, string[]>> = {
  pharma: ['NVO', 'GMAB', 'ALVO'],
  biotech: ['GMAB', 'ASND', 'NVO'],
  hardware: ['ERIC', 'NOK'],
  telecom: ['ERIC', 'NOK'],
  // deliberately just the two: Equinor is an integrated major, and leading its
  // group with drillers or tankers would compare it against the wrong business
  energy: ['EQNR', 'FRO'],
  oilServices: ['SDRL', 'BORR'],
  shipping: ['FRO', 'HAFN', 'SFL', 'DHT', 'NAT', 'FLNG', 'BWLP'],
  transport: ['FRO', 'HAFN', 'SFL'],
  autos: ['ALV'],
  industrials: ['ALV', 'CDLR', 'ERIC'],
  internet: ['SPOT'],
  foodBev: ['OTLY'],
};

/** Every verified Nordic ticker, for recognising a Nordic company by symbol. */
const NORDIC_TICKERS = new Set(Object.values(NORDIC).flat());

/** Currencies that mark a company as Nordic (NOK here is the krone, not Nokia). */
const NORDIC_CCY = new Set(['NOK', 'SEK', 'DKK', 'ISK']);

/**
 * Nordic by any of: a verified Nordic ticker, a Nordic reporting currency, a
 * Nordic exchange, or a Nordic corporate form in the name (ASA, A/S, AB, Oyj)
 * — the last one catches ADRs, which list in USD on a US exchange.
 */
function isNordic(company: Company): boolean {
  if (NORDIC_TICKERS.has(company.ticker.toUpperCase())) return true;
  if (NORDIC_CCY.has((company.ccy || '').toUpperCase())) return true;
  if (/OSLO|STOCKHOLM|COPENHAGEN|HELSINKI|NORDIC|BØRS|BORS/i.test(company.meta || '')) return true;
  return /(\bASA\b|\bA\/S\b|\bAB\b|\bOyj\b|\bASA,)/i.test(company.name || '');
}

/**
 * Industry-string patterns, most specific first.
 *
 * The provider mixes two taxonomies: an SIC-flavoured one ("SERVICES-PREPACKAGED
 * SOFTWARE", "PHARMACEUTICAL PREPARATIONS") and a modern sector one
 * ("DRUG MANUFACTURERS - GENERAL", "COMMUNICATION EQUIPMENT", "AUTO PARTS"),
 * so both spellings of each industry are matched here.
 */
const BY_INDUSTRY: [RegExp, keyof typeof UNIVERSE][] = [
  [/SEMICONDUCTOR/, 'semiconductors'],
  // modern taxonomy — checked before the broader legacy patterns below
  [/DRUG MANUFACTURER/, 'pharma'],
  [/BIOTECHNOLOGY/, 'biotech'],
  [/MEDICAL (DEVICE|INSTRUMENT)|DIAGNOSTICS & RESEARCH|HEALTH INFORMATION/, 'medtech'],
  [/COMMUNICATION EQUIPMENT|CONSUMER ELECTRONICS|COMPUTER HARDWARE/, 'hardware'],
  [/TELECOM SERVICES/, 'telecom'],
  [/AUTO (PARTS|MANUFACTURERS)/, 'autos'],
  [/OIL & GAS (DRILLING|EQUIPMENT)/, 'oilServices'],
  [/OIL & GAS/, 'energy'],
  [/AEROSPACE & DEFENSE/, 'aerospace'],
  [/CREDIT SERVICES/, 'payments'],
  [/MARINE SHIPPING/, 'shipping'],
  [/INTEGRATED FREIGHT|RAILROADS|AIRLINES/, 'transport'],
  [/SPECIALTY CHEMICALS|AGRICULTURAL INPUTS/, 'chemicals'],
  [/SPECIALTY INDUSTRIAL MACHINERY|FARM & HEAVY CONSTRUCTION|INDUSTRIAL DISTRIBUTION|ELECTRICAL EQUIPMENT/, 'industrials'],
  [/INTERNET CONTENT|ENTERTAINMENT/, 'internet'],
  [/BEVERAGES|PACKAGED FOODS|CONFECTIONERS|FARM PRODUCTS/, 'foodBev'],
  [/HOUSEHOLD & PERSONAL PRODUCTS|TOBACCO/, 'staples'],
  [/SPECIALTY RETAIL|DISCOUNT STORES|INTERNET RETAIL|GROCERY STORES|HOME IMPROVEMENT/, 'retail'],
  [/APPAREL|FOOTWEAR & ACCESSORIES/, 'apparel'],
  [/UTILITIES/, 'utilities'],
  [/OTHER INDUSTRIAL METALS|ALUMINUM|COPPER|GOLD|STEEL/, 'materials'],
  // legacy SIC-flavoured patterns
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

/**
 * Companies whose reported industry sends them to the wrong comparison.
 *
 * Alpha Vantage files crude and product tankers under OIL & GAS MIDSTREAM —
 * the same label it gives US pipeline operators — so Frontline came back in a
 * group of Exxon, Chevron, ConocoPhillips and EOG, which say nothing about a
 * tanker owner's multiples. Routing all of MIDSTREAM to shipping would just
 * misroute the pipelines instead, so the tankers are named one by one.
 *
 * HAFN and SFL are not here: they report MARINE SHIPPING and route correctly.
 */
const BY_TICKER: Record<string, keyof typeof UNIVERSE> = {
  FRO: 'shipping', DHT: 'shipping', NAT: 'shipping', FLNG: 'shipping', BWLP: 'shipping',
};

const BY_SECTOR: [RegExp, keyof typeof UNIVERSE][] = [
  [/TECHNOLOGY/, 'software'],
  [/LIFE SCIENCES/, 'pharma'],
  [/FINANCE/, 'banks'],
  [/ENERGY|TRANSPORTATION/, 'energy'],
  [/REAL ESTATE|CONSTRUCTION/, 'reits'],
  [/MANUFACTURING/, 'industrials'],
  [/TRADE|SERVICES/, 'retail'],
];

/**
 * Tickers to compare a company against, excluding the company itself. A Nordic
 * company leads with Nordic names and is topped up from the wider list, so the
 * group is regionally relevant without being too thin to be a comparison.
 */
export function suggestPeers(company: Company, limit = 6): string[] {
  const industry = (company.meta || '').toUpperCase();
  const self = company.ticker.toUpperCase();
  const hit =
    BY_INDUSTRY.find(([re]) => re.test(industry)) || BY_SECTOR.find(([re]) => re.test(industry));
  const key = BY_TICKER[self] || (hit ? hit[1] : 'industrials');
  const ordered = isNordic(company) ? [...(NORDIC[key] || []), ...UNIVERSE[key]] : UNIVERSE[key];
  return ordered.filter((t, i, a) => t !== self && a.indexOf(t) === i).slice(0, limit);
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
  return peerFromOverview(ov);
}

/**
 * Fetch a group one request at a time, spaced for the provider's 1/sec limit.
 * Individual failures are skipped rather than failing the whole group.
 */
export async function fetchPeerGroup(
  symbols: string[],
  apiKey: string,
  onProgress?: (done: number, total: number, symbol: string) => void,
  /** Wait before the first request — set when a company fetch just finished, so
   *  the opening peer request does not land inside the provider's 1/sec window. */
  initialDelayMs = 0,
): Promise<{ peers: Peer[]; failed: string[] }> {
  const peers: Peer[] = [];
  const failed: string[] = [];
  for (let i = 0; i < symbols.length; i++) {
    if (i) await new Promise(r => setTimeout(r, 1100));
    else if (initialDelayMs) await new Promise(r => setTimeout(r, initialDelayMs));
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
