import React, { useEffect, useMemo, useState } from 'react';
import { CO, MOCK_PEERS, type Assumptions, type Company, type Peer, type PeerSet, type ScenarioId } from './data';
import { cachePeers, fetchPeerGroup, loadCachedPeers, suggestPeers } from './peers';
import { dcf, solve } from './engine';
import { LiveDataError, fetchLiveCompany, searchSymbols, type SearchHit } from './live';
import {
  DARK, LIGHT, comboChart, lineChart, rangeChart, scatterChart, sparkline, waterfallChart,
  type Palette, type TipFn, type TipLine,
} from './charts';

type PageId = 'overview' | 'expectations' | 'financials' | 'scenarios' | 'valuation' | 'peers' | 'case';
type FinTab = 'is' | 'bs' | 'cf' | 'kpi';

interface Preset {
  id: number;
  co: string;
  name: string;
  a: Assumptions;
}

interface TipState {
  x: number;
  y: number;
  title: string;
  lines: TipLine[];
}

const MONO = "'IBM Plex Mono',monospace";
const SANS = "'IBM Plex Sans',sans-serif";

/** Below this width the desktop terminal layout has to fold: phones, and
 *  small tablets in portrait. */
const NARROW_Q = '(max-width: 860px)';

/** Reactive media-query match. */
function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    if (mq.addEventListener) {
      mq.addEventListener('change', on);
      return () => mq.removeEventListener('change', on);
    }
    mq.addListener(on); // Safari < 14
    return () => mq.removeListener(on);
  }, [query]);
  return match;
}

/** Grid template that folds to one column (or `mob`) on narrow screens.
 *  The folded tracks are `minmax(0, …)`: a bare `1fr` track grows to its
 *  content's minimum width, so one wide table would push the page sideways. */
const cols = (narrow: boolean, wide: string, mob = 'minmax(0,1fr)') => (narrow ? mob : wide);

/** Wrapper for a table too dense to fold: on narrow screens it keeps its
 *  natural width and the reader pans it sideways. Pair with a `minWidth` on
 *  the grid inside. */
const panX: React.CSSProperties = { overflowX: 'auto' };

const card: React.CSSProperties = {
  background: 'var(--sur)',
  border: '1px solid var(--bor)',
  borderRadius: 5,
  boxShadow: 'var(--sh)',
};

const cardTitle: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '.07em',
  color: 'var(--mut)',
};

/**
 * How many peers to pull automatically when a live company is loaded. Each one
 * costs a request on top of the six the company itself needs, so this stays
 * small; the Peers page can always load or add more.
 */
const AUTO_PEERS = 5;

/** 8 fiscal-year labels around a company's latest actual year: FY..A ×4 then FY..E ×4 */
const yrLabels = (fy0: number) =>
  [-3, -2, -1, 0, 1, 2, 3, 4].map(o => 'FY' + String((fy0 + o) % 100).padStart(2, '0') + (o <= 0 ? 'A' : 'E'));

const NAV: [PageId, string][] = [
  ['overview', 'Overview'],
  ['expectations', 'Expectations'],
  ['financials', 'Financials'],
  ['scenarios', 'Scenarios'],
  ['valuation', 'Valuation'],
  ['peers', 'Peers'],
  ['case', 'Investment Case'],
];

const fM = (v: number) => {
  const neg = v < 0;
  const s = Math.round(Math.abs(v)).toLocaleString('en-US').replace(/,/g, ' ');
  return (neg ? '−' : '') + s;
};
const fB = (v: number) => (v / 1000).toFixed(1);
const pctF = (v: number) => v.toFixed(1) + '%';

function loadPresets(): Preset[] {
  try {
    return JSON.parse(localStorage.getItem('mee_presets') || '[]');
  } catch {
    return [];
  }
}

function savePresets(list: Preset[]) {
  try {
    localStorage.setItem('mee_presets', JSON.stringify(list));
  } catch {
    /* storage unavailable — presets just don't persist */
  }
}

function loadTheme(): 'light' | 'dark' {
  try {
    const t = localStorage.getItem('mee_theme');
    return t === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function loadApiKey(): string {
  try {
    return localStorage.getItem('mee_av_key') || '';
  } catch {
    return '';
  }
}

function saveApiKey(k: string) {
  try {
    if (k) localStorage.setItem('mee_av_key', k);
    else localStorage.removeItem('mee_av_key');
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [page, setPage] = useState<PageId>('overview');
  const [theme, setTheme] = useState<'light' | 'dark'>(loadTheme);
  const [searchQ, setSearchQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [tab, setTab] = useState<FinTab>('is');
  const [period, setPeriod] = useState<'1Y' | '3Y' | '5Y'>('5Y');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [company, setCompany] = useState('NDLS');
  const [aOver, setAOver] = useState<Assumptions | null>(null);
  const [scOver, setScOver] = useState<Record<ScenarioId, Assumptions> | null>(null);
  const [presets, setPresets] = useState<Preset[]>(loadPresets);
  const [tip, setTip] = useState<TipState | null>(null);
  const [companies, setCompanies] = useState<Record<string, Company>>({ ...CO });
  const [apiKey, setApiKey] = useState(loadApiKey);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState(loadApiKey);
  const [loadingSym, setLoadingSym] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [peerSets, setPeerSets] = useState<Record<string, Peer[]>>({});
  const [peerBusy, setPeerBusy] = useState<{ done: number; total: number; sym: string } | null>(null);
  const [peerNote, setPeerNote] = useState<string | null>(null);
  const narrow = useMedia(NARROW_Q);
  const canHover = useMedia('(hover: hover)');

  useEffect(() => {
    document.body.dataset.theme = theme;
    try {
      localStorage.setItem('mee_theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  // debounced live symbol search (personal key, or the site's shared-key proxy)
  useEffect(() => {
    if (searchQ.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      searchSymbols(searchQ.trim(), apiKey)
        .then(setHits)
        .catch(() => setHits([]));
    }, 450);
    return () => clearTimeout(t);
  }, [searchQ, apiKey]);

  const c = companies[company];
  const a = aOver || c.defA;
  const scNow = scOver || c.scDef;
  const C: Palette = theme === 'dark' ? DARK : LIGHT;

  const tt: TipFn = (title, lines) => ({
    onMouseMove: e => {
      if (canHover) setTip({ x: e.clientX, y: e.clientY, title, lines });
    },
    onMouseLeave: () => setTip(null),
  });

  const go = (p: PageId) => () => setPage(p);
  const setA = (k: keyof Assumptions) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v)) setAOver(prev => ({ ...(prev || c.defA), [k]: v }));
  };
  const setSc = (id: ScenarioId, k: keyof Assumptions) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v)) setScOver(prev => {
      const cur = prev || c.scDef;
      return { ...cur, [id]: { ...cur[id], [k]: v } };
    });
  };

  // ----- derived financial model -----
  const PRICE = c.price;
  const SH = c.shares;
  const rev = c.rev;
  const gm = c.gm;
  const em = c.em;
  const ebm = em.map(v => +(v - c.daGap).toFixed(1));
  const ebitda = rev.map((r, i) => (r * em[i]) / 100);
  const ebit = rev.map((r, i) => (r * ebm[i]) / 100);
  // the mocks carry 22%; a live company carries its own effective rate
  const taxR = c.defA.tax / 100;
  const ni = ebit.map(e => e * (1 - taxR));
  const eps = ni.map(n => n / SH);
  const capex = rev.map((r, i) => (r * c.capexP[i]) / 100);
  const ocf = ebitda.map((e, i) => e - ebit[i] * taxR - (i ? 0.02 * (rev[i] - rev[i - 1]) : 300));
  const fcf = ocf.map((o, i) => o - capex[i]);
  const growth = rev.map((r, i) => (i ? (r / rev[i - 1] - 1) * 100 : 11.8));
  const mcapM = PRICE * SH;
  const netDebt = c.debt - c.cash[3];
  const evM = mcapM + netDebt;

  const d = useMemo(() => dcf(c, a), [c, a]);
  const implG = useMemo(() => solve(g => dcf(c, { ...a, g }).ps, 0, 40, PRICE), [c, a, PRICE]);
  const implEm = useMemo(
    () => solve(m => dcf(c, { ...a, g: c.consG, em: m, eb: m - c.daGap }).ps, 15, 60, PRICE),
    [c, a, PRICE],
  );
  const dImpl = useMemo(() => dcf(c, { ...a, g: implG }), [c, a, implG]);
  const implFcfM = (dImpl.fcf5 / dImpl.rev5) * 100;
  const implRoic = ((dImpl.ebit5 * (1 - a.tax / 100)) / (dImpl.rev5 * 0.85)) * 100;
  const gap = (PRICE / d.ps - 1) * 100;
  const gDiff = implG - c.consG;
  const assess: [string, string, string] =
    gDiff > 2.5
      ? ['AGGRESSIVE', 'var(--negBg)', 'var(--neg)']
      : gDiff < -1
        ? ['CONSERVATIVE', 'var(--posBg)', 'var(--pos)']
        : ['REASONABLE', 'var(--estBg)', 'var(--est)'];
  const barLoV = Math.min(d.ps, PRICE) * 0.7;
  const barHiV = Math.max(d.ps, PRICE) * 1.15;
  const pct = (v: number) => (((v - barLoV) / (barHiV - barLoV)) * 100).toFixed(1) + '%';

  // multiples
  const eps26 = eps[4];
  const ebitda26 = ebitda[4];
  const rev26 = rev[4];
  const fcf25 = fcf[3];
  const eps25 = eps[3];
  const pe = PRICE / eps26;
  const evE = evM / ebitda26;
  const evS = evM / rev26;
  const fcfY = (fcf25 / mcapM) * 100;
  const epsCagr = (Math.pow(eps[7] / eps26, 1 / 3) - 1) * 100;
  const peg = pe / epsCagr;
  // ----- peer set: mock companies keep the built-in universe; a live company
  // uses the live group once one has been loaded on the Peers page -----
  const livePeers = peerSets[c.ticker];
  const peerSet: PeerSet = livePeers
    ? { peers: livePeers, qualityLabel: 'ROE', live: true }
    : c.live
      ? { peers: [], qualityLabel: 'ROE', live: true }
      : MOCK_PEERS;

  /** This company as a comparison row, so it plots alongside its peers. */
  const selfPeer: Peer = {
    ticker: c.ticker, name: c.name, mcap: mcapM / 1000, revG: growth[4],
    ebitdaM: em[4], ebitM: ebm[4], quality: c.roic[3], pe, evEbitda: evE, evSales: evS,
    fcfY, ccy: c.ccy, live: c.live,
  };
  const peerRows: Peer[] = peerSet.peers.some(p => p.ticker === c.ticker)
    ? peerSet.peers
    : [selfPeer, ...peerSet.peers];
  const others = peerSet.peers.filter(p => p.ticker !== c.ticker);

  /** Median of a peer metric, or null when no peer reports it. */
  const med = (pick: (p: Peer) => number | null): number | null => {
    const s = others.map(pick).filter((v): v is number => v != null && isFinite(v)).sort((x, y) => x - y);
    if (!s.length) return null;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const medPe = med(p => p.pe);
  const medEve = med(p => p.evEbitda);
  const medEvs = med(p => p.evSales);
  const medFcfy = med(p => p.fcfY);
  const evps = (m: number, b: number) => (m * b - netDebt) / SH;

  // scenarios
  const scDefs: [ScenarioId, string, string][] = [
    ['bear', 'Bear', 'var(--neg)'],
    ['base', 'Base', 'var(--acc)'],
    ['bull', 'Bull', 'var(--pos)'],
  ];
  const scR = {} as Record<ScenarioId, ReturnType<typeof dcf>>;
  scDefs.forEach(([id]) => {
    scR[id] = dcf(c, scNow[id]);
  });

  const variantText =
    'The market prices ~' + implG.toFixed(0) + '% revenue CAGR and terminal EBITDA margins near ' + implEm.toFixed(0) +
    '%; our base case assumes ' + c.consG.toFixed(0) + '% and ' + c.defA.em.toFixed(0) + '%. ' +
    c.variantBody
      .replace('{bear}', scR.bear.ps.toFixed(0))
      .replace('{bull}', scR.bull.ps.toFixed(0))
      .replace('{buy}', String(c.buyBelow));

  const myPresets = presets.filter(p => p.co === company);

  const est = (i: number) => i >= 4;

  const pickCompany = (t: string) => {
    setCompany(t);
    setAOver(null);
    setScOver(null);
    setExpanded({});
    setSearchOpen(false);
    setSearchQ('');
    setLoadErr(null);
    setTip(null);
  };

  /**
   * Fetch a comparison group (one request per name) and cache it. `target`
   * is passed explicitly when loading for a company that has just been
   * fetched, since the selected-company state has not re-rendered yet.
   */
  const loadPeerGroup = async (symbols: string[], replace: boolean, target = c.ticker, initialDelayMs = 0) => {
    const wanted = symbols
      .map(s => s.trim().toUpperCase())
      .filter(s => s && s !== target)
      .filter((s, i, a) => a.indexOf(s) === i)
      .filter(s => replace || !(peerSets[target] || []).some(p => p.ticker === s));
    if (!wanted.length) return;
    setPeerNote(null);
    setPeerBusy({ done: 0, total: wanted.length, sym: wanted[0] });
    try {
      const { peers, failed } = await fetchPeerGroup(wanted, apiKey, (done, total, sym) =>
        setPeerBusy({ done, total, sym }), initialDelayMs);
      setPeerSets(s => {
        const merged = replace ? peers : [...(s[target] || []), ...peers];
        cachePeers(target, merged);
        return { ...s, [target]: merged };
      });
      if (failed.length) setPeerNote('Could not load: ' + failed.join(', '));
      else if (!peers.length) setPeerNote('No comparison data came back for those symbols.');
    } catch (e) {
      setPeerNote(e instanceof Error ? e.message : 'Could not load the peer group.');
    } finally {
      setPeerBusy(null);
    }
  };

  const removePeer = (ticker: string) => {
    setPeerSets(s => {
      const next = (s[c.ticker] || []).filter(p => p.ticker !== ticker);
      cachePeers(c.ticker, next);
      return { ...s, [c.ticker]: next };
    });
  };

  const loadLive = async (sym: string) => {
    const t = sym.toUpperCase();
    if (companies[t]) {
      pickCompany(t);
      return;
    }
    setLoadingSym(t);
    setLoadErr(null);
    try {
      const co = await fetchLiveCompany(t, apiKey);
      setCompanies(s => ({ ...s, [co.ticker]: co }));
      const cached = loadCachedPeers(co.ticker);
      if (cached) setPeerSets(s => ({ ...s, [co.ticker]: cached }));
      pickCompany(co.ticker);
      // Fill the comparison set in the background — the company is already on
      // screen, and the peer-median columns light up as the group arrives.
      if (!cached) {
        void loadPeerGroup(suggestPeers(co, AUTO_PEERS), true, co.ticker, 1200);
      }
    } catch (e) {
      setLoadErr(e instanceof LiveDataError ? e.message : 'Could not load ' + t + ' — check the symbol and your API key.');
      setSearchOpen(true);
    } finally {
      setLoadingSym(null);
    }
  };

  // search dropdown rows: loaded companies first, then live matches, then a direct-load fallback
  const q = searchQ.toLowerCase();
  interface SearchRow {
    t: string;
    n: string;
    tag: string;
    tagCol: string;
    action: (() => void) | null;
  }
  const searchRows: SearchRow[] = [];
  Object.values(companies)
    .filter(co => !q || co.ticker.toLowerCase().includes(q) || co.name.toLowerCase().includes(q))
    .slice(0, 4)
    .forEach(co => {
      const sel = co.ticker === c.ticker;
      searchRows.push({
        t: co.ticker,
        n: co.name,
        tag: sel ? 'SELECTED' : co.live ? 'LIVE' : 'LOADED',
        tagCol: sel ? 'var(--acc)' : 'var(--pos)',
        action: sel ? null : () => pickCompany(co.ticker),
      });
    });
  hits
    .filter(h => !companies[h.symbol.toUpperCase()])
    .slice(0, 5)
    .forEach(h => {
      searchRows.push({
        t: h.symbol,
        n: h.name + ' · ' + h.currency,
        tag: loadingSym === h.symbol.toUpperCase() ? 'LOADING…' : 'LOAD LIVE',
        tagCol: 'var(--est)',
        action: () => loadLive(h.symbol),
      });
    });
  const typed = searchQ.trim().toUpperCase();
  if (typed.length >= 1 && !companies[typed] && !hits.some(h => h.symbol.toUpperCase() === typed)) {
    searchRows.push({
      t: typed,
      n: 'Load this exact symbol from the API',
      tag: loadingSym === typed ? 'LOADING…' : 'FETCH',
      tagCol: 'var(--mut)',
      action: () => loadLive(typed),
    });
  }
  if (!apiKey && !searchQ.trim()) {
    searchRows.push({ t: '', n: 'Type any real ticker to load it live — shared key, or set your own', tag: 'API', tagCol: 'var(--acc)', action: () => setKeyOpen(true) });
  }

  const YRS = yrLabels(c.fy0);

  return (
    <div
      data-app-root="1"
      style={{
        display: 'flex', flexDirection: narrow ? 'column' : 'row',
        height: narrow ? 'auto' : '100vh', overflow: narrow ? 'visible' : 'hidden',
        background: 'var(--bg)', color: 'var(--ink)', fontFamily: SANS, fontSize: 13, lineHeight: 1.45,
      }}
    >
      <nav
        data-print-hide="1"
        className={narrow ? 'mx-hscroll' : undefined}
        style={
          narrow
            ? { position: 'sticky', top: 0, zIndex: 40, flexShrink: 0, background: 'var(--sur)', borderBottom: '1px solid var(--bor)', display: 'flex', overflowX: 'auto' }
            : { width: 204, flexShrink: 0, background: 'var(--sur)', borderRight: '1px solid var(--bor)', display: 'flex', flexDirection: 'column' }
        }
      >
        {!narrow && (
          <div style={{ padding: '18px 18px 14px', borderBottom: '1px solid var(--bor)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.02em' }}>
              Market Expectations<br />Engine
            </div>
            <div style={{ fontSize: 10, color: 'var(--mut)', fontFamily: MONO, marginTop: 4 }}>REVERSE-DCF TERMINAL</div>
          </div>
        )}
        <div style={narrow ? { display: 'flex', gap: 2, padding: '6px 8px' } : { display: 'flex', flexDirection: 'column', gap: 1, padding: 10 }}>
          {NAV.map(([id, label], i) => (
            <div
              key={id}
              className={page === id ? undefined : 'hov-sur2'}
              onClick={go(id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, borderRadius: 4, cursor: 'pointer',
                padding: narrow ? '8px 11px' : '8px 10px',
                whiteSpace: narrow ? 'nowrap' : undefined,
                background: page === id ? 'var(--accS)' : 'transparent',
                color: page === id ? 'var(--acc)' : 'var(--ink)',
                fontWeight: page === id ? 600 : 400,
              }}
            >
              {!narrow && <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--mut)' }}>{'0' + (i + 1)}</span>}
              <span style={{ fontSize: 12.5 }}>{narrow && id === 'case' ? 'Case' : label}</span>
            </div>
          ))}
        </div>
        {!narrow && (
          <div style={{ marginTop: 'auto', padding: '14px 18px', borderTop: '1px solid var(--bor)', fontSize: 10, color: 'var(--mut)' }}>
            {c.live ? 'Live data · Alpha Vantage' : 'Mock dataset'} · {c.ccy}
            <br />Model v1.2 — live API
          </div>
        )}
      </nav>
      <div data-app-col="1" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <header style={{ minHeight: narrow ? 0 : 58, flexShrink: 0, background: 'var(--sur)', borderBottom: '1px solid var(--bor)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: narrow ? '5px 12px' : '8px 16px', padding: narrow ? '8px 12px' : '8px 22px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0, maxWidth: narrow ? '100%' : undefined, whiteSpace: 'nowrap' }}>
            <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 15 }}>{c.ticker}</span>
            <span style={{ fontWeight: 500, overflow: narrow ? 'hidden' : undefined, textOverflow: narrow ? 'ellipsis' : undefined }}>{c.name}</span>
            {!narrow && <span style={{ fontSize: 11, color: 'var(--mut)' }}>{c.meta}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontFamily: MONO, whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>{PRICE.toFixed(2)}</span>
            <span style={{ fontSize: 12, color: c.chgPos ? 'var(--pos)' : 'var(--neg)' }}>{c.chg}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--mut)', whiteSpace: 'nowrap' }}>
            Mkt cap <span style={{ fontFamily: MONO, color: 'var(--ink)' }}>{c.ccy + ' ' + fB(mcapM) + 'bn'}</span>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--mut)', whiteSpace: 'nowrap' }}>
            {loadingSym
              ? 'Loading ' + loadingSym + '…'
              : peerBusy
                ? `Loading peers ${Math.min(peerBusy.done + 1, peerBusy.total)}/${peerBusy.total}…`
                : 'Updated ' + c.updated + (c.live ? ' · live' : ' · mock')}
          </div>
          <div data-print-hide="1" style={{ marginLeft: narrow ? 0 : 'auto', flex: narrow ? '1 1 100%' : undefined, position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="text"
              placeholder="Search companies…"
              value={searchQ}
              onChange={e => {
                setSearchQ(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 180)}
              style={{ background: 'var(--bg)', border: '1px solid var(--bor2)', borderRadius: 4, color: 'var(--ink)', fontSize: 12, padding: '6px 10px', width: narrow ? '100%' : 150, maxWidth: narrow ? undefined : '26vw', minWidth: 0, fontFamily: SANS }}
            />
            {searchOpen && (
              <div style={{ position: 'absolute', top: 34, right: 0, width: 300, maxWidth: 'calc(100vw - 24px)', background: 'var(--sur)', border: '1px solid var(--bor2)', borderRadius: 5, boxShadow: '0 8px 24px rgba(0,0,0,.14)', zIndex: 50, overflow: 'hidden' }}>
                {loadErr && (
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--bor)', fontSize: 11, color: 'var(--neg)', background: 'var(--negBg)' }}>{loadErr}</div>
                )}
                {searchRows.map((r, i) => (
                  <div
                    key={r.t + i}
                    className="hov-sur2"
                    onMouseDown={e => {
                      e.preventDefault();
                      if (r.action) r.action();
                    }}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--bor)', cursor: r.action ? 'pointer' : 'default' }}
                  >
                    <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.t && <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600 }}>{r.t}</span>}{' '}
                      <span style={{ fontSize: 12 }}>{r.n}</span>
                    </div>
                    <span style={{ fontSize: 9.5, color: r.tagCol, fontFamily: MONO, flexShrink: 0 }}>{r.tag}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            data-print-hide="1"
            className="hov-sur2"
            onClick={() => setTimeout(() => window.print(), 60)}
            title="Print / save the current view as PDF"
            style={{ background: 'var(--sur)', border: '1px solid var(--bor2)', color: 'var(--ink)', borderRadius: 4, padding: '6px 12px', fontSize: 11.5, cursor: 'pointer', fontFamily: SANS }}
          >
            Export
          </button>
          <button
            data-print-hide="1"
            className="hov-ink"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            style={{ background: 'var(--sur)', border: '1px solid var(--bor2)', color: 'var(--mut)', borderRadius: 4, padding: '6px 12px', fontSize: 11.5, cursor: 'pointer', fontFamily: SANS }}
          >
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
          <div data-print-hide="1" style={{ position: 'relative', marginLeft: narrow ? 'auto' : undefined }}>
            <button
              className="hov-ink"
              onClick={() => {
                setKeyDraft(apiKey);
                setKeyOpen(!keyOpen);
              }}
              title="Configure the Alpha Vantage API key used for live data"
              style={{ background: 'var(--sur)', border: '1px solid var(--bor2)', color: apiKey ? 'var(--pos)' : 'var(--mut)', borderRadius: 4, padding: '6px 12px', fontSize: 11.5, cursor: 'pointer', fontFamily: SANS }}
            >
              {apiKey ? 'API ●' : 'API ○'}
            </button>
            {keyOpen && (
              <div style={{ position: 'absolute', top: 34, right: 0, width: 318, boxSizing: 'border-box', maxWidth: 'calc(100vw - 24px)', background: 'var(--sur)', border: '1px solid var(--bor2)', borderRadius: 5, boxShadow: '0 8px 24px rgba(0,0,0,.14)', zIndex: 50, padding: '12px 14px' }}>
                <div style={{ ...cardTitle, marginBottom: 6 }}>Live data · Alpha Vantage</div>
                <div style={{ fontSize: 11, color: 'var(--mut)', marginBottom: 8 }}>
                  Live loads use this site’s shared key by default. Paste your own free key from{' '}
                  <a href="https://www.alphavantage.co/support/#api-key" target="_blank" rel="noreferrer">alphavantage.co</a>{' '}
                  for a personal quota. The key is stored only in this browser.
                </div>
                <input
                  type="text"
                  value={keyDraft}
                  onChange={e => setKeyDraft(e.target.value)}
                  placeholder="API key…"
                  style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg)', border: '1px solid var(--bor2)', borderRadius: 4, color: 'var(--ink)', fontSize: 12, padding: '6px 10px', fontFamily: MONO, marginBottom: 8 }}
                />
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  {apiKey && (
                    <button
                      className="hov-ink"
                      onClick={() => {
                        setApiKey('');
                        setKeyDraft('');
                        saveApiKey('');
                        setKeyOpen(false);
                      }}
                      style={{ background: 'none', border: '1px solid var(--bor2)', color: 'var(--mut)', borderRadius: 3, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontFamily: SANS }}
                    >
                      Clear
                    </button>
                  )}
                  <button
                    className="hov-accS"
                    onClick={() => {
                      const k = keyDraft.trim();
                      setApiKey(k);
                      saveApiKey(k);
                      setKeyOpen(false);
                    }}
                    style={{ background: 'none', border: '1px solid var(--bor2)', color: 'var(--acc)', borderRadius: 3, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontFamily: SANS }}
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>
        <main data-main="1" style={{ flex: 1, minHeight: 0, overflowY: narrow ? 'visible' : 'auto', padding: narrow ? '14px 12px 40px' : '24px 26px 48px' }}>
          <div style={{ maxWidth: 1280, margin: '0 auto' }}>
            {page === 'overview' && (
              <OverviewPage {...{ narrow, c, C, tt, go, period, setPeriod, rev, em, gm, ebm, eps, eps25, eps26, ebitda, ebitda26, rev26, fcf25, growth, evM, netDebt, pe, evE, evS, fcfY, peg, mcapM, YRS, medPe, medEve, medEvs, medFcfy, peerSet }} />
            )}
            {page === 'expectations' && (
              <ExpectationsPage {...{ narrow, c, C, tt, a, d, setA, implG, implEm, implFcfM, implRoic, gap, assess, pct, PRICE, myPresets, presets, setPresets, setAOver, rev, fcf25, gapColor: gap > 5 ? 'var(--neg)' : gap < -5 ? 'var(--pos)' : 'var(--est)', barLoV, barHiV }} />
            )}
            {page === 'financials' && (
              <FinancialsPage {...{ narrow, c, tab, setTab, expanded, setExpanded, rev, gm, em, ebm, ebitda, ebit, ni, eps, capex, ocf, fcf, growth, est, YRS, taxR }} />
            )}
            {page === 'scenarios' && (
              <ScenariosPage {...{ narrow, c, C, tt, scNow, scR, scDefs, setSc, setAOver, setPage, PRICE }} />
            )}
            {page === 'valuation' && (
              <ValuationPage {...{ narrow, c, C, tt, d, go, netDebt, PRICE, SH, eps25, eps26, ebitda26, rev26, pe, evE, evS, evps, scR, scNow, medPe, medEve, medEvs }} />
            )}
            {page === 'peers' && <PeersPage {...{ c, C, tt, narrow, peerSet, peerRows, peerBusy, peerNote, setPeerNote, loadPeerGroup, removePeer, apiKey, go }} />}
            {page === 'case' && <CasePage {...{ c, C, narrow, variantText }} />}
          </div>
        </main>
      </div>
      {tip && (
        <div style={{ position: 'fixed', left: Math.min(tip.x, (window.innerWidth || 1200) - 250) + 14, top: tip.y + 16, zIndex: 99, background: 'var(--ink)', color: 'var(--bg)', padding: '7px 10px', borderRadius: 4, fontSize: 11, pointerEvents: 'none', boxShadow: '0 4px 14px rgba(0,0,0,.25)', maxWidth: 230 }}>
          <div style={{ fontWeight: 600, fontFamily: MONO, marginBottom: 2 }}>{tip.title}</div>
          {tip.lines.map((l, i) => (
            <div key={i} style={{ fontFamily: MONO, whiteSpace: 'nowrap' }}>{l.t}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- overview

function OverviewPage(P: any) {
  const { c, C, tt, go, narrow, period, setPeriod, rev, em, gm, ebm, eps, eps25, eps26, ebitda, ebitda26, rev26, fcf25, growth, evM, netDebt, pe, evE, evS, fcfY, peg, mcapM, YRS, medPe, medEve, medEvs, medFcfy, peerSet } = P;
  const ccy = c.ccy;
  const fx1 = (v: number) => v.toFixed(1) + 'x';
  const fp1 = (v: number) => v.toFixed(1) + '%';
  const prem = (cur: number, avg: number, pp?: boolean): [string, string] => {
    const dd = pp ? cur - avg : (cur / avg - 1) * 100;
    const s = (dd >= 0 ? '+' : '−') + Math.abs(dd).toFixed(pp ? 1 : 0) + (pp ? 'pp' : '%');
    return [s, Math.abs(dd) > (pp ? 0.5 : 10) ? 'var(--neg)' : 'var(--est)'];
  };
  const mkVal = (m: string, cur: number, avg: number, peerV: number | null, fmt: (v: number) => string, pp?: boolean) => {
    const [s, col] = prem(cur, avg, pp);
    return { m, cur: fmt(cur), avg: fmt(avg), peer: peerV == null ? '–' : fmt(peerV), prem: s, premCol: col };
  };
  const valRows = [
    mkVal('P/E (NTM)', pe, c.hist.pe, medPe, fx1),
    mkVal('EV / EBITDA (NTM)', evE, c.hist.eve, medEve, fx1),
    mkVal('EV / Sales (NTM)', evS, c.hist.evs, medEvs, fx1),
    mkVal('FCF yield', fcfY, c.hist.fcfy, medFcfy, fp1, true),
    mkVal('PEG (NTM)', peg, c.hist.peg, 1.9, fx1),
  ];
  const g25 = growth[3];
  const ndE = netDebt / ebitda[3];
  const fy1 = YRS[4].slice(0, 4); // e.g. "FY26"
  const ovMetrics = [
    { l: 'Revenue', v: ccy + ' ' + fB(rev[3]) + 'bn', sub: fy1 + 'E ' + fB(rev26) + 'bn', subCol: 'var(--mut)', tip: 'FY' + c.fy0 + 'A reported revenue' },
    { l: 'Revenue growth', v: (g25 >= 0 ? '+' : '') + g25.toFixed(1) + '%', sub: fy1 + 'E ' + (growth[4] >= 0 ? '+' : '') + growth[4].toFixed(1) + '%', subCol: 'var(--pos)', tip: 'Year-over-year revenue growth' },
    { l: 'EBITDA', v: ccy + ' ' + fB(ebitda[3]) + 'bn', sub: fy1 + 'E ' + fB(ebitda26) + 'bn', subCol: 'var(--mut)', tip: 'Earnings before interest, tax, depreciation & amortisation' },
    { l: 'EBITDA margin', v: em[3].toFixed(1) + '%', sub: fy1 + 'E ' + em[4].toFixed(1) + '%', subCol: 'var(--pos)', tip: 'EBITDA / revenue' },
    { l: 'EBIT margin', v: ebm[3].toFixed(1) + '%', sub: fy1 + 'E ' + ebm[4].toFixed(1) + '%', subCol: 'var(--pos)', tip: 'Operating profit / revenue' },
    { l: 'EPS', v: ccy + ' ' + eps25.toFixed(2), sub: fy1 + 'E ' + eps26.toFixed(2), subCol: 'var(--mut)', tip: 'Diluted earnings per share' },
    { l: 'Free cash flow', v: ccy + ' ' + fB(fcf25) + 'bn', sub: ((fcf25 / rev[3]) * 100).toFixed(1) + '% margin', subCol: 'var(--mut)', tip: 'Operating cash flow less capex' },
    { l: 'ROIC', v: c.roic[3].toFixed(1) + '%', sub: fy1 + 'E ' + c.roic[4].toFixed(1) + '%', subCol: 'var(--pos)', tip: 'Return on invested capital — NOPAT / invested capital' },
    { l: 'Net debt / EBITDA', v: (ndE < 0 ? '−' : '') + Math.abs(ndE).toFixed(1) + 'x', sub: ndE < 0 ? 'Net cash ' + fB(-netDebt) + 'bn' : 'Net debt ' + fB(netDebt) + 'bn', subCol: ndE < 0.5 ? 'var(--pos)' : 'var(--est)', tip: 'Negative = net cash position' },
    { l: 'FCF yield', v: fcfY.toFixed(1) + '%', sub: medFcfy == null ? 'of market cap' : 'vs peers ' + medFcfy.toFixed(1) + '%', subCol: medFcfy != null && fcfY < medFcfy ? 'var(--neg)' : 'var(--pos)', tip: 'Free cash flow / market cap' },
  ];
  // price chart
  const pn = period === '1Y' ? 5 : period === '3Y' ? 12 : 20;
  const ph = c.priceHist.slice(-pn);
  // label a price point by its calendar quarter, counting back from now
  const qLbl = (i: number) => {
    const back = ph.length - 1 - i;
    const now = new Date();
    const dt = new Date(now.getFullYear(), now.getMonth() - back * 3, 1);
    return 'Q' + (Math.floor(dt.getMonth() / 3) + 1) + '-' + String(dt.getFullYear() % 100).padStart(2, '0');
  };
  const phl = ph.map((_: number, i: number) =>
    i === 0 || i === ph.length - 1 || i === Math.floor(ph.length / 2) ? (i === ph.length - 1 ? 'Now' : qLbl(i)) : '',
  );
  const phTips = ph.map((_: number, i: number) => (i === ph.length - 1 ? 'Now' : qLbl(i)));

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px 12px', marginBottom: 16 }}>
        <h1 style={{ fontSize: 19, fontWeight: 600, margin: 0 }}>Company overview</h1>
        <span style={{ fontSize: 11, color: 'var(--mut)' }}>
          {'FY' + c.fy0 + 'A reported · FY' + (c.fy0 + 1) + 'E ' + (c.live ? 'extrapolated' : 'consensus')}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: cols(narrow, 'repeat(5,1fr)', 'repeat(2,minmax(0,1fr))'), gap: 10, marginBottom: 10 }}>
        {ovMetrics.map((m: any) => (
          <div key={m.l} title={m.tip} style={{ ...card, padding: '12px 14px' }}>
            <div style={{ ...cardTitle, marginBottom: 6 }}>{m.l}</div>
            <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 600 }}>{m.v}</div>
            <div style={{ fontSize: 10.5, color: m.subCol, marginTop: 3, fontFamily: MONO }}>{m.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: cols(narrow, '1.2fr 1fr'), gap: 10, marginBottom: 10 }}>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ ...cardTitle, marginBottom: 10 }}>Valuation vs history &amp; peers</div>
          <div style={narrow ? panX : undefined}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr', gap: 0, fontSize: 12, minWidth: narrow ? 400 : undefined }}>
              {['Metric', 'Current', '5Y avg', 'Peer med.', 'vs hist.'].map((h, i) => (
                <div key={h} style={{ color: 'var(--mut)', fontSize: 10.5, padding: '4px 0', borderBottom: '1px solid var(--bor)', textAlign: i ? 'right' : 'left' }}>{h}</div>
              ))}
              {valRows.map(vr => (
                <React.Fragment key={vr.m}>
                  <div style={{ padding: '6px 0', borderBottom: '1px solid var(--bor)' }}>{vr.m}</div>
                  <div style={{ padding: '6px 0', borderBottom: '1px solid var(--bor)', textAlign: 'right', fontFamily: MONO, fontWeight: 600 }}>{vr.cur}</div>
                  <div style={{ padding: '6px 0', borderBottom: '1px solid var(--bor)', textAlign: 'right', fontFamily: MONO, color: 'var(--mut)' }}>{vr.avg}</div>
                  <div style={{ padding: '6px 0', borderBottom: '1px solid var(--bor)', textAlign: 'right', fontFamily: MONO, color: 'var(--mut)' }}>{vr.peer}</div>
                  <div style={{ padding: '6px 0', borderBottom: '1px solid var(--bor)', textAlign: 'right', fontFamily: MONO, color: vr.premCol }}>{vr.prem}</div>
                </React.Fragment>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--mut)', marginTop: 10 }}>
            {'Enterprise value ' + ccy + ' ' + fB(evM) + 'bn · ' + c.valFootTail}
          </div>
        </div>
        <div style={{ ...card, padding: '16px 18px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={cardTitle}>{'Share price · ' + ccy}</div>
            <div style={{ display: 'flex', gap: 2 }}>
              {(['1Y', '3Y', '5Y'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  style={{ background: period === p ? 'var(--accS)' : 'transparent', color: period === p ? 'var(--acc)' : 'var(--mut)', border: '1px solid var(--bor)', borderRadius: 3, padding: '2px 8px', fontSize: 10, cursor: 'pointer', fontFamily: MONO }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            {lineChart({ w: 460, h: 168, series: [{ v: ph, c: C.s1, wd: 2, n: 'Price' }], labels: phl, tipLabels: phTips, fmt: v => v.toFixed(0), tipFmt: v => ccy + ' ' + v.toFixed(1), C }, tt)}
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: cols(narrow, '1fr 1fr 1fr'), gap: 10, marginBottom: 10 }}>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ ...cardTitle, marginBottom: 8 }}>Revenue &amp; EBITDA margin</div>
          {comboChart({ w: 400, h: 175, bars: rev.map((r: number) => r / 1000), estFrom: 4, line: em, labels: YRS.map((y: string) => y.slice(2)), fmt: v => v.toFixed(0), barName: 'Revenue', barFmt: v => ccy + ' ' + v.toFixed(1) + 'bn', lineName: 'EBITDA margin', C }, tt)}
          <div style={{ fontSize: 10, color: 'var(--mut)', marginTop: 6 }}>{'Bars: revenue, ' + ccy + ' bn · Line: EBITDA margin (rhs)'}</div>
        </div>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ ...cardTitle, marginBottom: 8 }}>Margin development · %</div>
          {lineChart({ w: 400, h: 175, series: [{ v: gm, c: C.txt, wd: 1.6, n: 'Gross' }, { v: em, c: C.s1, wd: 1.8, dots: true, n: 'EBITDA' }, { v: ebm, c: C.s2, wd: 1.6, n: 'EBIT' }], labels: YRS.map((y: string) => y.slice(2)), fmt: v => v.toFixed(0) + '%', tipFmt: v => v.toFixed(1) + '%', C }, tt)}
          <div style={{ display: 'flex', gap: 14, fontSize: 10, color: 'var(--mut)', marginTop: 6 }}>
            <span>— Gross</span>
            <span style={{ color: 'var(--acc)' }}>— EBITDA</span>
            <span style={{ color: 'var(--est)' }}>— EBIT</span>
          </div>
        </div>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ ...cardTitle, marginBottom: 8 }}>{'EPS development · ' + ccy}</div>
          {comboChart({ w: 400, h: 175, bars: eps, estFrom: 4, labels: YRS.map((y: string) => y.slice(2)), fmt: v => v.toFixed(0), barName: 'EPS', barFmt: v => ccy + ' ' + v.toFixed(2), C }, tt)}
          <div style={{ fontSize: 10, color: 'var(--mut)', marginTop: 6 }}>{c.live ? 'Shaded bars are extrapolated estimates' : 'Shaded bars are consensus estimates'}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: cols(narrow, '1fr 1fr 1.2fr'), gap: 10 }}>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ ...cardTitle, color: 'var(--pos)', marginBottom: 10 }}>Bull case</div>
          {c.bull.map((t: string) => (
            <div key={t} style={{ display: 'flex', gap: 8, marginBottom: 9, fontSize: 12.5 }}>
              <span style={{ color: 'var(--pos)', fontFamily: MONO }}>+</span>
              <span>{t}</span>
            </div>
          ))}
        </div>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ ...cardTitle, color: 'var(--neg)', marginBottom: 10 }}>Bear case</div>
          {c.bear.map((t: string) => (
            <div key={t} style={{ display: 'flex', gap: 8, marginBottom: 9, fontSize: 12.5 }}>
              <span style={{ color: 'var(--neg)', fontFamily: MONO }}>−</span>
              <span>{t}</span>
            </div>
          ))}
        </div>
        <div style={{ background: 'var(--accS)', border: '1px solid var(--bor)', borderRadius: 5, padding: '16px 18px' }}>
          <div style={{ ...cardTitle, color: 'var(--acc)', marginBottom: 10 }}>Key debate</div>
          <div style={{ fontSize: 12.5 }}>
            {c.debate}{' '}
            <a href="#" onClick={e => { e.preventDefault(); go('expectations')(); }}>Open Expectations →</a>
          </div>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------ expectations

function ExpectationsPage(P: any) {
  const { c, C, tt, a, d, narrow, setA, implG, implEm, implFcfM, implRoic, gap, assess, pct, PRICE, myPresets, presets, setPresets, setAOver, rev, fcf25, gapColor, barLoV, barHiV } = P;
  const ccy = c.ccy;
  const assumpDefs: [string, keyof Assumptions, number, number, number, string, string][] = [
    ['Revenue CAGR (5Y)', 'g', 0, 25, 0.1, '%', 'Compound annual revenue growth FY26–30'],
    ['Terminal growth', 'tg', 0, 4, 0.1, '%', 'Perpetual growth beyond FY30; should not exceed long-run nominal GDP'],
    ['EBITDA margin (terminal)', 'em', 20, 45, 0.1, '%', 'FY30 EBITDA margin; interpolated from ' + c.M0 + '% today'],
    ['EBIT margin (terminal)', 'eb', 15, 38, 0.1, '%', 'FY30 EBIT margin; gap to EBITDA margin approximates D&A'],
    ['Tax rate', 'tax', 15, 30, 0.5, '%', 'Cash tax rate on EBIT'],
    ['Capex % of revenue', 'capex', 3, 12, 0.1, '%', 'Growth and maintenance capital expenditure'],
    ['WACC', 'wacc', 6, 12, 0.1, '%', 'Weighted average cost of capital (discount rate)'],
  ];
  const impliedStats = [
    { l: 'Implied rev. CAGR', v: implG.toFixed(1) + '%', sub: 'cons. ' + c.consG.toFixed(1) + '%', tip: 'Revenue growth needed to justify the price, holding your other assumptions' },
    { l: 'Implied term. margin', v: implEm.toFixed(1) + '%', sub: 'today ' + c.M0.toFixed(1) + '%', tip: 'FY30 EBITDA margin needed at consensus growth' },
    { l: 'Implied FCF margin', v: implFcfM.toFixed(1) + '%', sub: 'today ' + ((fcf25 / rev[3]) * 100).toFixed(1) + '%', tip: 'FY30 FCF margin at the implied growth path' },
    { l: 'Implied ROIC', v: implRoic.toFixed(1) + '%', sub: 'today ' + c.roic[3].toFixed(1) + '%', tip: 'FY30 return on invested capital at implied assumptions' },
    { l: 'TV % of EV', v: (d.tvShare * 100).toFixed(0) + '%', sub: 'terminal value', tip: 'Share of enterprise value beyond the explicit forecast' },
  ];
  // "what the market is pricing in" chart
  const pcLabels = [-3, -2, -1, 0, 1, 2, 3, 4, 5].map(o => 'FY' + String((c.fy0 + o) % 100).padStart(2, '0'));
  const R0b = rev[3] / 1000;
  const histS = [rev[0] / 1000, rev[1] / 1000, rev[2] / 1000, R0b, null, null, null, null, null];
  const cons = [null, null, null, R0b, ...[1, 2, 3, 4, 5].map(t => R0b * Math.pow(1 + c.consG / 100, t))];
  const impl = [null, null, null, R0b, ...[1, 2, 3, 4, 5].map(t => R0b * Math.pow(1 + implG / 100, t))];

  const onSavePreset = () => {
    const n = myPresets.length + 1;
    const list: Preset[] = [...presets, { id: Date.now(), co: c.ticker, name: 'P' + n, a: { ...a } }];
    savePresets(list);
    setPresets(list);
  };

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px' }}>What does the current share price imply?</h1>
        <div style={{ fontSize: 12.5, color: 'var(--mut)' }}>
          Reverse DCF — instead of estimating value, solve for the expectations embedded in {ccy} {PRICE.toFixed(2)}.
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: cols(narrow, '340px 1fr'), gap: 12, alignItems: 'start' }}>
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--bor)' }}>
            <div style={cardTitle}>Your assumptions</div>
            <button
              className="hov-ink"
              onClick={() => setAOver({ ...c.defA })}
              style={{ background: 'none', border: '1px solid var(--bor2)', color: 'var(--mut)', borderRadius: 3, padding: '3px 9px', fontSize: 10.5, cursor: 'pointer', fontFamily: SANS }}
            >
              Reset
            </button>
          </div>
          <div style={{ padding: '10px 16px 14px', display: 'flex', flexDirection: 'column', gap: 11 }}>
            {assumpDefs.map(([l, k, mn, mx, st, unit, tip]) => (
              <div key={k} title={tip}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--mut)' }}>{l}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <input type="number" value={a[k]} step={st} onChange={setA(k)} />
                    <span style={{ fontSize: 10, color: 'var(--mut)', fontFamily: MONO }}>{unit}</span>
                  </span>
                </div>
                <input type="range" min={mn} max={mx} step={st} value={a[k]} onChange={setA(k)} />
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid var(--bor)', padding: '11px 16px 13px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={cardTitle}>Presets</span>
              <button
                className="hov-accS"
                onClick={onSavePreset}
                style={{ background: 'none', border: '1px solid var(--bor2)', color: 'var(--acc)', borderRadius: 3, padding: '3px 9px', fontSize: 10.5, cursor: 'pointer', fontFamily: SANS }}
              >
                Save current
              </button>
            </div>
            {myPresets.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {myPresets.map((p: Preset) => (
                  <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--sur2)', border: '1px solid var(--bor2)', borderRadius: 3, padding: '3px 8px', fontSize: 10.5 }}>
                    <span onClick={() => setAOver({ ...p.a })} title="Load this assumption set" style={{ cursor: 'pointer', fontFamily: MONO }}>
                      {p.name} · <b>{dcf(c, p.a).ps.toFixed(0)}</b>
                    </span>
                    <span
                      onClick={() => {
                        const list = presets.filter((x: Preset) => x.id !== p.id);
                        savePresets(list);
                        setPresets(list);
                      }}
                      title="Delete preset"
                      style={{ cursor: 'pointer', color: 'var(--mut)' }}
                    >
                      ×
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 10.5, color: 'var(--mut)' }}>Save assumption sets to compare their implied values side by side.</div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div style={{ ...card, padding: '18px 20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: cols(narrow, '1fr 1fr 1fr'), gap: narrow ? 10 : 16, marginBottom: 14 }}>
              <div>
                <div style={{ ...cardTitle, marginBottom: 4 }}>Market price</div>
                <div style={{ fontFamily: MONO, fontSize: 26, fontWeight: 600 }}>{PRICE.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ ...cardTitle, marginBottom: 4 }}>Your model value</div>
                <div style={{ fontFamily: MONO, fontSize: 26, fontWeight: 600, color: 'var(--acc)' }}>{d.ps.toFixed(1)}</div>
              </div>
              <div>
                <div style={{ ...cardTitle, marginBottom: 4 }}>Market vs model</div>
                <div style={{ fontFamily: MONO, fontSize: 26, fontWeight: 600, color: gapColor }}>{(gap >= 0 ? '+' : '') + gap.toFixed(0) + '%'}</div>
              </div>
            </div>
            <div style={{ position: 'relative', height: 34, margin: '0 6px' }}>
              <div style={{ position: 'absolute', top: 15, left: 0, right: 0, height: 4, background: 'var(--sur2)', borderRadius: 2 }} />
              <div style={{ position: 'absolute', top: 15, height: 4, background: 'var(--accS)', left: pct(Math.min(d.ps, PRICE)), width: ((Math.abs(PRICE - d.ps) / (barHiV - barLoV)) * 100).toFixed(1) + '%' }} />
              <div style={{ position: 'absolute', top: 8, left: pct(d.ps), transform: 'translateX(-50%)', textAlign: 'center' }}>
                <div style={{ width: 2, height: 18, background: 'var(--acc)', margin: '0 auto' }} />
                <div style={{ fontSize: 9, color: 'var(--acc)', fontFamily: MONO, whiteSpace: 'nowrap' }}>MODEL {d.ps.toFixed(1)}</div>
              </div>
              <div style={{ position: 'absolute', top: 8, left: pct(PRICE), transform: 'translateX(-50%)', textAlign: 'center' }}>
                <div style={{ width: 2, height: 18, background: 'var(--ink)', margin: '0 auto' }} />
                <div style={{ fontSize: 9, color: 'var(--mut)', fontFamily: MONO, whiteSpace: 'nowrap' }}>PRICE {PRICE.toFixed(2)}</div>
              </div>
            </div>
          </div>
          <div style={{ background: 'var(--accS)', border: '1px solid var(--bor)', borderRadius: 5, padding: '16px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ ...cardTitle, color: 'var(--acc)' }}>Market-implied expectations</div>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', padding: '3px 9px', borderRadius: 3, background: assess[1], color: assess[2], fontFamily: MONO }}>{assess[0]}</span>
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.55 }}>
              {'At the current share price of ' + ccy + ' ' + PRICE.toFixed(2) + ', the market appears to be pricing in approximately ' + implG.toFixed(1) + '% annual revenue growth over the next five years and an EBITDA margin expansion from ' + c.M0.toFixed(1) + '% to ' + implEm.toFixed(1) + '% — against ' + (c.live ? 'a historical-trend baseline' : 'analyst consensus') + ' of ' + c.consG.toFixed(1) + '% growth and a ' + c.defA.em.toFixed(0) + '% terminal margin.'}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: cols(narrow, 'repeat(5,1fr)', 'repeat(2,minmax(0,1fr))'), gap: 10 }}>
            {impliedStats.map(st => (
              <div key={st.l} title={st.tip} style={{ ...card, padding: '11px 13px' }}>
                <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mut)', marginBottom: 5 }}>{st.l}</div>
                <div style={{ fontFamily: MONO, fontSize: 17, fontWeight: 600 }}>{st.v}</div>
                <div style={{ fontSize: 10, color: 'var(--mut)', marginTop: 2, fontFamily: MONO }}>{st.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ ...card, padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={cardTitle}>{'What the market is pricing in · revenue, ' + ccy + ' bn'}</div>
              <div style={{ display: 'flex', gap: 14, fontSize: 10, color: 'var(--mut)' }}>
                <span>— Historical</span>
                <span style={{ color: 'var(--est)' }}>{c.live ? '- - Trend baseline' : '- - Analyst consensus'}</span>
                <span style={{ color: 'var(--acc)' }}>— Market-implied</span>
              </div>
            </div>
            {lineChart({ w: narrow ? 430 : 720, h: narrow ? 200 : 210, series: [
              { v: histS, c: C.ink, wd: 2, dots: true, n: 'Historical' },
              { v: cons, c: C.s2, wd: 1.6, dash: '5 4', dots: true, n: 'Consensus' },
              { v: impl, c: C.s1, wd: 2, dots: true, n: 'Market-implied' },
            ], labels: pcLabels, fmt: v => v.toFixed(0), tipFmt: v => ccy + ' ' + v.toFixed(1) + 'bn', C }, tt)}
          </div>
        </div>
      </div>
    </>
  );
}

// -------------------------------------------------------------- financials

function FinancialsPage(P: any) {
  const { c, tab, setTab, narrow, expanded, setExpanded, rev, gm, em, ebm, ebitda, ebit, ni, eps, capex, ocf, fcf, growth, est, YRS, taxR } = P;
  const shade = true;
  const hasSegs = c.segs.length > 0;

  interface FinRowDef {
    id: string;
    label: string;
    vals: number[];
    fmt: (v: number, i?: number) => string;
    bold?: 1;
    sub?: 1;
    exp?: 1;
  }
  const row = (id: string, label: string, vals: number[], fmt: (v: number, i?: number) => string, o: Partial<FinRowDef> = {}): FinRowDef =>
    ({ id, label, vals, fmt, ...o });

  const isRows: FinRowDef[] = [
    row('rev', 'Revenue', rev, fM, hasSegs ? { bold: 1, exp: 1 } : { bold: 1 }),
    row('g', 'YoY growth %', growth, pctF, { sub: 1 }),
    row('gp', 'Gross profit', rev.map((r: number, i: number) => (r * gm[i]) / 100), fM),
    row('gpm', 'Gross margin %', gm, pctF, { sub: 1 }),
    row('ebitda', 'EBITDA', ebitda, fM, { bold: 1 }),
    row('ebitdam', 'EBITDA margin %', em, pctF, { sub: 1 }),
    row('da', 'D&A', rev.map((r: number) => (-r * c.daGap) / 100), fM),
    row('ebit', 'EBIT', ebit, fM, { bold: 1 }),
    row('ebitm', 'EBIT margin %', ebm, pctF, { sub: 1 }),
    row('fin', 'Net financials', rev.map((_r: number, i: number) => (c.cash[i] - c.debt) * 0.03), fM),
    row('tax', `Tax (${c.defA.tax}%)`, ebit.map((e: number) => -e * taxR), fM),
    row('ni', 'Net income', ni, fM, { bold: 1 }),
    row('eps', 'EPS · ' + c.ccy, eps, (v: number) => v.toFixed(2), { bold: 1 }),
  ];
  const bsRows: FinRowDef[] = [
    row('cash', 'Cash & equivalents', c.cash, fM),
    row('ar', 'Receivables', rev.map((r: number) => r * 0.12), fM),
    row('inv', 'Inventory', rev.map((r: number) => r * 0.145), fM),
    row('ppe', 'PP&E', rev.map((r: number) => r * 0.38), fM),
    row('int', 'Intangibles & goodwill', rev.map((_r: number, i: number) => 8600 + i * 240), fM),
    row('ta', 'Total assets', rev.map((r: number, i: number) => c.cash[i] + r * 0.645 + 8600 + i * 240), fM, { bold: 1 }),
    row('debt', 'Interest-bearing debt', rev.map(() => c.debt), fM),
    row('ol', 'Other liabilities', rev.map((r: number) => r * 0.185), fM),
    row('eqt', 'Shareholders’ equity', rev.map((r: number, i: number) => c.cash[i] + r * 0.46 + 8600 + i * 240 - c.debt), fM, { bold: 1 }),
    row('nd', 'Net debt (cash)', c.cash.map((x: number) => c.debt - x), fM, { bold: 1 }),
  ];
  const cfRows: FinRowDef[] = [
    row('cebitda', 'EBITDA', ebitda, fM),
    row('wc', 'Change in working capital', rev.map((r: number, i: number) => (i ? -0.02 * (r - rev[i - 1]) : -300)), fM),
    row('taxp', 'Tax paid', ebit.map((e: number) => -e * taxR), fM),
    row('ocf', 'Operating cash flow', ocf, fM, { bold: 1 }),
    row('cap', 'Capex', capex.map((x: number) => -x), fM),
    row('ccp', 'Capex % of revenue', c.capexP.map((v: number) => -v), (v: number) => v.toFixed(1) + '%', { sub: 1 }),
    row('fcf', 'Free cash flow', fcf, fM, { bold: 1 }),
    row('fcfm', 'FCF margin %', fcf.map((f: number, i: number) => (f / rev[i]) * 100), pctF, { sub: 1 }),
    row('div', 'Dividends', ni.map((n: number) => -n * c.divRate), fM),
    row('bb', 'Share buybacks', rev.map((_r: number, i: number) => c.buyback(i)), fM),
  ];
  const kpiRows: FinRowDef[] = [
    row('roic', 'ROIC %', c.roic, pctF, { bold: 1 }),
    row('roe', 'ROE %', ni.map((n: number, i: number) => (n / (c.cash[i] + rev[i] * 0.46 + 8600)) * 100), pctF),
    row('fcfm2', 'FCF margin %', fcf.map((f: number, i: number) => (f / rev[i]) * 100), pctF),
    row('conv', 'FCF conversion (FCF/NI) %', fcf.map((f: number, i: number) => (f / ni[i]) * 100), (v: number) => v.toFixed(0) + '%'),
    row('rnd', 'R&D % of revenue', c.rnd, pctF),
    row('nde', 'Net debt / EBITDA', c.cash.map((x: number, i: number) => (c.debt - x) / ebitda[i]), (v: number) => v.toFixed(1) + 'x', { bold: 1 }),
  ];
  const tabRows: Record<FinTab, FinRowDef[]> = { is: isRows, bs: bsRows, cf: cfRows, kpi: kpiRows };

  const finCols = (narrow ? '148px' : '230px') + ' repeat(8,1fr)';
  const labelCell: React.CSSProperties = narrow
    ? { position: 'sticky', left: 0, zIndex: 1, background: 'var(--sur)', borderRight: '1px solid var(--bor)', overflow: 'hidden', textOverflow: 'ellipsis' }
    : {};

  const cellStyle = (i: number, bold?: 1, negRed?: boolean, v?: number): React.CSSProperties => ({
    padding: '7px 12px', textAlign: 'right', fontFamily: MONO, fontSize: 11.5,
    fontWeight: bold ? 600 : 400,
    color: negRed && v != null && v < 0 ? 'var(--neg)' : 'var(--ink)',
    background: est(i) && shade ? 'var(--estBg)' : 'transparent',
  });

  const rowsOut: React.ReactNode[] = [];
  (tabRows[tab as FinTab] || isRows).forEach(r => {
    const expd = !!expanded[r.id];
    rowsOut.push(
      <div key={r.id} className="hov-sur2" style={{ display: 'grid', gridTemplateColumns: finCols, borderBottom: '1px solid var(--bor)' }}>
        <div
          onClick={r.exp ? () => setExpanded((s: Record<string, boolean>) => ({ ...s, [r.id]: !s[r.id] })) : undefined}
          style={{ padding: '7px 16px', paddingLeft: r.sub ? 28 : 16, fontSize: 12, fontWeight: r.bold ? 600 : 400, color: r.sub ? 'var(--mut)' : 'var(--ink)', cursor: r.exp ? 'pointer' : 'default', whiteSpace: 'nowrap', ...labelCell }}
        >
          {(r.exp ? (expd ? '▾ ' : '▸ ') : '') + r.label}
        </div>
        {r.vals.map((v, i) => (
          <div key={i} style={cellStyle(i, r.bold, true, v)}>{r.fmt(v, i)}</div>
        ))}
      </div>,
    );
    if (r.exp && expd) {
      c.segs.forEach(([sl, fn]: [string, (r: number, i: number) => number]) => {
        rowsOut.push(
          <div key={r.id + '-' + sl} className="hov-sur2" style={{ display: 'grid', gridTemplateColumns: finCols, borderBottom: '1px solid var(--bor)' }}>
            <div style={{ padding: '7px 16px', paddingLeft: 32, fontSize: 12, fontWeight: 400, color: 'var(--mut)', cursor: 'default', whiteSpace: 'nowrap', ...labelCell }}>{sl}</div>
            {rev.map((rr: number, i: number) => (
              <div key={i} style={cellStyle(i)}>{fM(fn(rr, i))}</div>
            ))}
          </div>,
        );
      });
    }
  });

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px 12px', marginBottom: 14 }}>
        <h1 style={{ fontSize: 19, fontWeight: 600, margin: 0 }}>Financial model</h1>
        <div style={{ display: 'flex', gap: 2, background: 'var(--sur)', border: '1px solid var(--bor)', borderRadius: 5, padding: 3 }}>
          {(narrow
            ? ([['is', 'Income'], ['bs', 'Balance'], ['cf', 'Cash flow'], ['kpi', 'KPIs']] as [FinTab, string][])
            : ([['is', 'Income Statement'], ['bs', 'Balance Sheet'], ['cf', 'Cash Flow'], ['kpi', 'KPIs']] as [FinTab, string][])
          ).map(([id, l]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{ background: tab === id ? 'var(--accS)' : 'transparent', color: tab === id ? 'var(--acc)' : 'var(--mut)', border: 'none', borderRadius: 3, padding: narrow ? '6px 10px' : '5px 13px', fontSize: 11.5, cursor: 'pointer', fontFamily: SANS, fontWeight: tab === id ? 600 : 400, whiteSpace: 'nowrap' }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div style={{ ...card, overflowX: 'auto' }}>
        <div style={{ minWidth: narrow ? 720 : 980 }}>
          <div style={{ display: 'grid', gridTemplateColumns: finCols, borderBottom: '1px solid var(--bor2)', background: 'var(--sur)' }}>
            <div style={{ padding: '9px 16px', ...cardTitle, ...labelCell }}>{c.ccy + ' m unless stated'}</div>
            {YRS.map((y: string, i: number) => (
              <div key={y} style={{ padding: '9px 12px', textAlign: 'right', fontFamily: MONO, fontSize: 11, fontWeight: 600, color: est(i) ? 'var(--est)' : 'var(--ink)', background: est(i) && shade ? 'var(--estBg)' : 'transparent' }}>{y}</div>
            ))}
          </div>
          {rowsOut}
        </div>
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--mut)', marginTop: 8 }}>
        {'A = actual · E = estimate (shaded).' + (narrow ? ' Swipe the table sideways for later years.' : '') + (hasSegs ? ' Click Revenue to expand segment detail.' : c.live ? ' Estimates are trend extrapolations from reported filings.' : '')}
      </div>
    </>
  );
}

// --------------------------------------------------------------- scenarios

function ScenariosPage(P: any) {
  const { c, C, tt, narrow, scNow, scR, scDefs, setSc, setAOver, setPage, PRICE } = P;
  const waccs = [7.5, 8, 8.5, 9, 9.5, 10];
  const tgs = [1.5, 2, 2.5, 3, 3.5];
  const base = scNow.base;

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 19, fontWeight: 600, margin: '0 0 4px' }}>Scenario engine</h1>
        <div style={{ fontSize: 12, color: 'var(--mut)' }}>
          Each scenario runs the full DCF. Adjust assumptions per scenario; outputs update immediately.
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: cols(narrow, '1fr 1fr 1fr'), gap: 10, marginBottom: 12 }}>
        {scDefs.map(([id, name, tone]: [ScenarioId, string, string]) => {
          const p = scNow[id];
          const r = scR[id];
          const up = (r.ps / PRICE - 1) * 100;
          const fl: [string, keyof Assumptions, number, number, number][] = [
            ['Revenue CAGR', 'g', 0, 22, 0.5],
            ['EBITDA margin ⁵ʸ', 'em', 20, 42, 0.5],
            ['EBIT margin ⁵ʸ', 'eb', 14, 36, 0.5],
            ['WACC', 'wacc', 6, 12, 0.25],
            ['Terminal growth', 'tg', 0, 4, 0.25],
          ];
          const outs = [
            { l: 'EPS FY30E', v: r.eps5.toFixed(2), col: 'var(--ink)', fw: 400 },
            { l: 'FCF FY30E', v: fB(r.fcf5) + 'bn', col: 'var(--ink)', fw: 400 },
            { l: 'Enterprise value', v: fB(r.ev) + 'bn', col: 'var(--ink)', fw: 400 },
            { l: 'Equity value', v: fB(r.eq) + 'bn', col: 'var(--ink)', fw: 400 },
            { l: 'Implied price', v: c.ccy + ' ' + r.ps.toFixed(0), col: tone, fw: 600 },
            { l: 'Upside', v: (up >= 0 ? '+' : '') + up.toFixed(0) + '%', col: up >= 0 ? 'var(--pos)' : 'var(--neg)', fw: 600 },
          ];
          return (
            <div key={id} style={{ ...card, borderTop: '2px solid ' + tone, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 16px', borderBottom: '1px solid var(--bor)' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{name}</span>
                <span style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, color: tone }}>{r.ps.toFixed(0)}</span>
              </div>
              <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid var(--bor)' }}>
                {fl.map(([l, k, mn, mx, st]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--mut)', width: 104, flexShrink: 0 }}>{l}</span>
                    <input type="range" min={mn} max={mx} step={st} value={p[k]} onChange={setSc(id, k)} style={{ flex: 1 }} />
                    <span style={{ fontFamily: MONO, fontSize: 11, width: 46, textAlign: 'right' }}>
                      {p[k].toFixed(k === 'wacc' || k === 'tg' ? 2 : 1) + '%'}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ padding: '10px 16px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 14px' }}>
                {outs.map(o => (
                  <div key={o.l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: 'var(--mut)' }}>{o.l}</span>
                    <span style={{ fontFamily: MONO, color: o.col, fontWeight: o.fw }}>{o.v}</span>
                  </div>
                ))}
              </div>
              <button
                className="hov-accS"
                onClick={() => {
                  setAOver({ ...p });
                  setPage('expectations');
                }}
                style={{ margin: '0 16px 13px', marginTop: 'auto', background: 'none', border: '1px solid var(--bor2)', color: 'var(--acc)', borderRadius: 3, padding: '5px 0', fontSize: 10.5, cursor: 'pointer', fontFamily: SANS }}
              >
                Load into Expectations →
              </button>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: cols(narrow, '1.2fr 1fr'), gap: 10 }}>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ ...cardTitle, marginBottom: 10 }}>{'Valuation range · ' + c.ccy + ' per share'}</div>
          {rangeChart(
            scDefs.map(([id, name]: [ScenarioId, string]) => ({
              label: name + ' · ' + c.ccy + ' ' + scR[id].ps.toFixed(0),
              lo: scR[id].ps * 0.97,
              hi: scR[id].ps * 1.03,
              mid: null,
              c: id === 'bear' ? C.neg : id === 'bull' ? C.s3 : C.s1,
            })),
            PRICE, C, tt, 130, c.ccy,
          )}
          <div style={{ fontSize: 10.5, color: 'var(--mut)', marginTop: 8 }}>Dashed marker: current price {PRICE.toFixed(2)}.</div>
        </div>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ ...cardTitle, marginBottom: 10 }}>{'Sensitivity · WACC × terminal growth (base case, ' + c.ccy + '/share)'}</div>
          <div style={narrow ? panX : undefined}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 2, fontFamily: MONO, fontSize: 11, minWidth: narrow ? 380 : undefined }}>
              <div style={{ padding: 5, color: 'var(--mut)', fontSize: 9.5 }}>WACC \ g∞</div>
              {tgs.map(t => (
                <div key={t} style={{ padding: 5, textAlign: 'center', color: 'var(--mut)', fontSize: 10 }}>{t.toFixed(1) + '%'}</div>
              ))}
              {waccs.map(wv => (
                <React.Fragment key={wv}>
                  <div style={{ padding: '6px 4px', textAlign: 'center', color: 'var(--mut)' }}>{wv.toFixed(1) + '%'}</div>
                  {tgs.map(tv => {
                    const ps = dcf(c, { ...base, wacc: wv, tg: tv }).ps;
                    const rel = ps / PRICE;
                    const cur = Math.abs(wv - base.wacc) < 0.13 && Math.abs(tv - base.tg) < 0.13;
                    return (
                      <div
                        key={tv}
                        title={'WACC ' + wv + '% · terminal growth ' + tv + '% → ' + c.ccy + ' ' + ps.toFixed(0)}
                        style={{
                          padding: '6px 4px', textAlign: 'center', borderRadius: 3,
                          background: rel > 1.05 ? 'var(--posBg)' : rel < 0.95 ? 'var(--negBg)' : 'var(--sur2)',
                          color: rel > 1.05 ? 'var(--pos)' : rel < 0.95 ? 'var(--neg)' : 'var(--ink)',
                          outline: cur ? '1.5px solid var(--acc)' : 'none',
                          fontWeight: cur ? 700 : 400,
                        }}
                      >
                        {ps.toFixed(0)}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--mut)', marginTop: 8 }}>
            Outlined cell = current base assumptions. Green above market price, red below.
          </div>
        </div>
      </div>
    </>
  );
}

// --------------------------------------------------------------- valuation

function ValuationPage(P: any) {
  const { c, C, tt, d, go, narrow, netDebt, PRICE, SH, eps25, eps26, ebitda26, rev26, pe, evE, evS, evps, scR, scNow, medPe, medEve, medEvs } = P;
  const mx = (v: number | null, unit: string) => (v == null ? '–' : v.toFixed(1) + unit);
  const ccy = c.ccy;
  const fy1 = 'FY' + String((c.fy0 + 1) % 100).padStart(2, '0');
  const fy5 = 'FY' + String((c.fy0 + 5) % 100).padStart(2, '0');
  const dcfRows = [
    { l: 'PV of ' + fy1 + '–' + fy5 + 'E free cash flows', v: ccy + ' ' + fB(d.pvSum) + 'bn', fw: 400, lcol: 'var(--ink)', vcol: 'var(--ink)', bord: 'var(--bor)' },
    { l: 'PV of terminal value', v: ccy + ' ' + fB(d.tvPV) + 'bn', fw: 400, lcol: 'var(--ink)', vcol: 'var(--ink)', bord: 'var(--bor)' },
    { l: 'Enterprise value', v: ccy + ' ' + fB(d.ev) + 'bn', fw: 600, lcol: 'var(--ink)', vcol: 'var(--ink)', bord: 'var(--bor2)' },
    { l: netDebt < 0 ? 'Add: net cash position' : 'Less: net debt', v: (netDebt < 0 ? '+' : '−') + ccy + ' ' + fB(Math.abs(netDebt)) + 'bn', fw: 400, lcol: 'var(--mut)', vcol: netDebt < 0 ? 'var(--pos)' : 'var(--neg)', bord: 'var(--bor)' },
    { l: 'Equity value', v: ccy + ' ' + fB(d.eq) + 'bn', fw: 600, lcol: 'var(--ink)', vcol: 'var(--ink)', bord: 'var(--bor2)' },
    { l: 'Shares outstanding', v: SH + 'm', fw: 400, lcol: 'var(--mut)', vcol: 'var(--mut)', bord: 'var(--bor)' },
    { l: 'Implied value per share', v: ccy + ' ' + d.ps.toFixed(1), fw: 700, lcol: 'var(--ink)', vcol: 'var(--acc)', bord: 'var(--bor2)' },
    { l: 'vs market price ' + PRICE.toFixed(2), v: (d.ps / PRICE - 1 >= 0 ? '+' : '') + ((d.ps / PRICE - 1) * 100).toFixed(1) + '%', fw: 600, lcol: 'var(--mut)', vcol: d.ps >= PRICE ? 'var(--pos)' : 'var(--neg)', bord: 'transparent' },
  ];
  const multRows = [
    { m: 'P/E (' + fy1 + 'E EPS ' + eps26.toFixed(2) + ')', cur: pe.toFixed(1) + 'x', hist: c.hist.pe.toFixed(1) + 'x', peer: mx(medPe, 'x'), impl: medPe == null ? '–' : (medPe * eps26).toFixed(0) },
    { m: 'EV/EBITDA (' + fy1 + 'E)', cur: evE.toFixed(1) + 'x', hist: c.hist.eve.toFixed(1) + 'x', peer: mx(medEve, 'x'), impl: medEve == null ? '–' : evps(medEve, ebitda26).toFixed(0) },
    { m: 'EV/Sales (' + fy1 + 'E)', cur: evS.toFixed(1) + 'x', hist: c.hist.evs.toFixed(1) + 'x', peer: mx(medEvs, 'x'), impl: medEvs == null ? '–' : evps(medEvs, rev26).toFixed(0) },
  ];
  const field = [
    { label: 'DCF (Bear–Bull)', lo: scR.bear.ps, hi: scR.bull.ps, mid: scR.base.ps, c: C.s1 },
    { label: 'P/E ' + c.peBand[0] + '–' + c.peBand[1] + 'x ' + fy1 + 'E', lo: c.peBand[0] * eps26, hi: c.peBand[1] * eps26, c: C.bar },
    { label: 'EV/EBITDA ' + c.eveBand[0] + '–' + c.eveBand[1] + 'x', lo: evps(c.eveBand[0], ebitda26), hi: evps(c.eveBand[1], ebitda26), c: C.bar },
    { label: 'EV/Sales ' + c.evsBand[0] + '–' + c.evsBand[1] + 'x', lo: evps(c.evsBand[0], rev26), hi: evps(c.evsBand[1], rev26), c: C.bar },
    { label: '52-week range', lo: c.wk52[0], hi: c.wk52[1], c: C.barE },
  ];
  const base = scNow.base;
  const rf = Math.pow(1 + base.g / 100, 5);
  const brGrowth = eps25 * (rf - 1);
  const brMargin = eps25 * rf * (base.eb / c.B0 - 1);
  const eps30 = scR.base.eps5;
  const brOther = eps30 - eps25 - brGrowth - brMargin;
  const bridge = [
    { l: 'FY25A', v: eps25, isTotal: true },
    { l: 'Growth', v: brGrowth },
    { l: 'Margin', v: brMargin },
    { l: 'Other', v: brOther },
    { l: 'FY30E', v: eps30, isTotal: true },
  ];

  return (
    <>
      <h1 style={{ fontSize: 19, fontWeight: 600, margin: '0 0 14px' }}>Valuation</h1>
      <div style={{ display: 'grid', gridTemplateColumns: cols(narrow, '1fr 1.3fr'), gap: 10, marginBottom: 10 }}>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ ...cardTitle, marginBottom: 10 }}>DCF build-up (your Expectations assumptions)</div>
          {dcfRows.map(dr => (
            <div key={dr.l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '6px 0', borderBottom: '1px solid ' + dr.bord, fontSize: 12, fontWeight: dr.fw }}>
              <span style={{ color: dr.lcol, minWidth: 0 }}>{dr.l}</span>
              <span style={{ fontFamily: MONO, color: dr.vcol, whiteSpace: 'nowrap', flexShrink: 0 }}>{dr.v}</span>
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: 'var(--mut)', marginTop: 10 }}>
            Terminal value is {(d.tvShare * 100).toFixed(0)}% of enterprise value — worth stressing in{' '}
            <a href="#" onClick={e => { e.preventDefault(); go('scenarios')(); }}>Scenarios</a>.
          </div>
        </div>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ ...cardTitle, marginBottom: 10 }}>{'Trading multiples → implied share price (on ' + fy1 + 'E)'}</div>
          <div style={narrow ? panX : undefined}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr', fontSize: 12, minWidth: narrow ? 420 : undefined }}>
              {['Method', 'Current', 'Hist. avg', 'Peer med.', 'Impl. price*'].map((h, i) => (
                <div key={h} style={{ color: 'var(--mut)', fontSize: 10.5, padding: '4px 0', borderBottom: '1px solid var(--bor)', textAlign: i ? 'right' : 'left' }}>{h}</div>
              ))}
              {multRows.map(mr => (
                <React.Fragment key={mr.m}>
                  <div style={{ padding: '7px 0', borderBottom: '1px solid var(--bor)' }}>{mr.m}</div>
                  <div style={{ padding: '7px 0', borderBottom: '1px solid var(--bor)', textAlign: 'right', fontFamily: MONO }}>{mr.cur}</div>
                  <div style={{ padding: '7px 0', borderBottom: '1px solid var(--bor)', textAlign: 'right', fontFamily: MONO, color: 'var(--mut)' }}>{mr.hist}</div>
                  <div style={{ padding: '7px 0', borderBottom: '1px solid var(--bor)', textAlign: 'right', fontFamily: MONO, color: 'var(--mut)' }}>{mr.peer}</div>
                  <div style={{ padding: '7px 0', borderBottom: '1px solid var(--bor)', textAlign: 'right', fontFamily: MONO, fontWeight: 600 }}>{mr.impl}</div>
                </React.Fragment>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--mut)', marginTop: 10 }}>
            *At peer-median multiple. Range across Bear/Base/Bull earnings shown in the football field.
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: cols(narrow, '1.3fr 1fr'), gap: 10 }}>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ ...cardTitle, marginBottom: 10 }}>{'Football field · ' + ccy + ' per share'}</div>
          {rangeChart(field, PRICE, C, tt, undefined, ccy)}
        </div>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ ...cardTitle, marginBottom: 10 }}>{'EPS bridge FY' + String(c.fy0 % 100) + 'A → FY' + String((c.fy0 + 5) % 100) + 'E · base case, ' + ccy}</div>
          {waterfallChart(bridge, C, tt, ccy)}
          <div style={{ fontSize: 10.5, color: 'var(--mut)', marginTop: 8 }}>
            Decomposes base-case EPS growth into revenue and margin contribution.
          </div>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------- peers

function PeersPage(P: any) {
  const { c, C, tt, narrow, peerSet, peerRows, peerBusy, peerNote, setPeerNote, loadPeerGroup, removePeer, go } = P;
  const [draft, setDraft] = useState('');
  const suggested = suggestPeers(c, AUTO_PEERS);
  const qLabel = peerSet.qualityLabel as 'ROIC' | 'ROE';
  const editable = !!c.live;
  const mixed = peerRows.some((p: Peer) => p.ccy !== c.ccy);

  const peerHead: [string, 'left' | 'right'][] = [
    ['Company', 'left'], ['Mkt cap bn', 'right'], ['Rev growth', 'right'], ['EBITDA m.', 'right'],
    ['EBIT m.', 'right'], [qLabel, 'right'], ['P/E', 'right'], ['EV/EBITDA', 'right'],
    ['EV/Sales', 'right'], ['FCF yield', 'right'],
  ];
  const peerLabelCell: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 1, background: 'var(--sur)', borderRight: '1px solid var(--bor)', overflow: 'hidden', textOverflow: 'ellipsis' };
  const pct = (v: number | null) => (v == null ? '–' : v.toFixed(1) + '%');
  const mult = (v: number | null) => (v == null || !isFinite(v) || v <= 0 ? '–' : v.toFixed(1) + 'x');
  const cells = (p: Peer): string[] => [
    p.mcap.toFixed(0) + (mixed ? ' ' + p.ccy : ''),
    pct(p.revG), pct(p.ebitdaM), pct(p.ebitM), pct(p.quality),
    mult(p.pe), mult(p.evEbitda), mult(p.evSales), pct(p.fcfY),
  ];

  const addDraft = () => {
    const list = draft.split(/[,\s]+/).filter(Boolean);
    if (list.length) loadPeerGroup(list, false);
    setDraft('');
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <h1 style={{ fontSize: 19, fontWeight: 600, margin: 0 }}>Peer analysis</h1>
        <span style={{ fontSize: 11, color: 'var(--mut)' }}>
          {peerSet.live
            ? peerSet.peers.length
              ? peerSet.peers.length + ' live peers · one OVERVIEW request each'
              : 'No peer group loaded yet'
            : 'Built-in mock universe'}
        </span>
      </div>

      {editable && (
        <div data-print-hide="1" style={{ ...card, padding: '13px 16px', marginBottom: 10 }}>
          {peerBusy ? (
            <div style={{ fontSize: 12, color: 'var(--mut)' }}>
              Loading peer {Math.min(peerBusy.done + 1, peerBusy.total)} of {peerBusy.total}
              {peerBusy.sym ? ' · ' + peerBusy.sym : ''}…
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                className="hov-accS"
                onClick={() => loadPeerGroup(suggested, true)}
                style={{ background: 'none', border: '1px solid var(--bor2)', color: 'var(--acc)', borderRadius: 3, padding: '5px 11px', fontSize: 11.5, cursor: 'pointer', fontFamily: SANS }}
              >
                {peerSet.peers.length ? 'Reload' : 'Load'} suggested peers ({suggested.length} requests)
              </button>
              <span style={{ fontSize: 11, color: 'var(--mut)', fontFamily: MONO }}>{suggested.join(' · ')}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                <input
                  type="text"
                  value={draft}
                  placeholder="Add tickers…"
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addDraft(); }}
                  style={{ background: 'var(--bg)', border: '1px solid var(--bor2)', borderRadius: 4, color: 'var(--ink)', fontSize: 12, padding: '5px 9px', width: 150, fontFamily: SANS }}
                />
                <button
                  className="hov-sur2"
                  onClick={addDraft}
                  style={{ background: 'var(--sur)', border: '1px solid var(--bor2)', color: 'var(--ink)', borderRadius: 3, padding: '5px 11px', fontSize: 11.5, cursor: 'pointer', fontFamily: SANS }}
                >
                  Add
                </button>
              </span>
            </div>
          )}
          {peerNote && (
            <div style={{ fontSize: 11, color: 'var(--neg)', marginTop: 8 }}>
              {peerNote}{' '}
              <span onClick={() => setPeerNote(null)} style={{ cursor: 'pointer', color: 'var(--mut)' }}>×</span>
            </div>
          )}
        </div>
      )}

      {editable && !peerSet.peers.length && !peerBusy && (
        <div style={{ background: 'var(--estBg)', border: '1px solid var(--bor)', borderRadius: 5, padding: '10px 14px', fontSize: 11.5, color: 'var(--est)', marginBottom: 10 }}>
          No comparison group for {c.ticker}. Peers load automatically when a company is fetched, so an empty set usually means the daily request quota is spent — or that every name was removed. The mock Norwegian universe is deliberately not used as a stand-in. Load or add names above and the peer-median columns on Overview and Valuation fill in with them.
        </div>
      )}

      <div style={{ ...card, overflowX: 'auto', marginBottom: narrow ? 4 : 10 }}>
        <div style={{ minWidth: narrow ? 780 : 960, display: 'grid', gridTemplateColumns: (narrow ? '150px' : '1.6fr') + ' repeat(9,1fr)' }}>
          {peerHead.map(([l, al], i) => (
            <div key={l} style={{ padding: '9px 12px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--mut)', borderBottom: '1px solid var(--bor2)', textAlign: al, whiteSpace: 'nowrap', ...(narrow && !i ? peerLabelCell : null) }}>{l}</div>
          ))}
          {peerRows.map((p: Peer) => {
            const hl = p.ticker === c.ticker;
            const bg = hl ? 'var(--accS)' : 'transparent';
            return (
              <React.Fragment key={p.ticker}>
                <div style={{ padding: '7px 12px', fontSize: 11.5, borderBottom: '1px solid var(--bor)', background: bg, fontWeight: hl ? 600 : 400, textAlign: 'left', fontFamily: SANS, color: 'var(--ink)', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6, ...(narrow ? { ...peerLabelCell, background: hl ? 'var(--accS)' : 'var(--sur)' } : null) }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{narrow ? p.ticker : p.ticker + ' · ' + p.name}</span>
                  {editable && !hl && (
                    <span
                      data-print-hide="1"
                      onClick={() => removePeer(p.ticker)}
                      title={'Remove ' + p.ticker}
                      style={{ cursor: 'pointer', color: 'var(--mut)', marginLeft: 'auto', paddingLeft: 6 }}
                    >
                      ×
                    </span>
                  )}
                </div>
                {cells(p).map((v, i) => (
                  <div key={i} style={{ padding: '7px 12px', fontSize: 11.5, borderBottom: '1px solid var(--bor)', background: bg, fontWeight: hl ? 600 : 400, textAlign: 'right', fontFamily: MONO, color: v === '–' ? 'var(--mut)' : 'var(--ink)', whiteSpace: 'nowrap' }}>
                    {v}
                  </div>
                ))}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <div style={{ fontSize: 10.5, color: 'var(--mut)', margin: '0 0 10px' }}>
        {narrow && 'Swipe the table sideways for the remaining columns. '}
        {peerSet.live
          ? qLabel + ' is return on equity — the return measure the provider exposes per company; ' +
            'growth is the latest reported quarter year-on-year, and free cash flow yield is not published at this level.'
          : 'Mock universe: ROIC, growth and FCF yield are modelled figures.'}
        {mixed && ' Market caps are shown in each company’s own reporting currency; multiples and margins are currency-free.'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: cols(narrow, '1fr 1fr'), gap: 10 }}>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ ...cardTitle, marginBottom: 8 }}>Growth vs valuation · bubble = market cap</div>
          {peerRows.length > 1 ? (
            <>
              {scatterChart({ pts: peerRows.map((p: Peer) => ({ t: p.ticker, x: p.revG, y: p.evSales, m: Math.max(1, p.mcap), hl: p.ticker === c.ticker })), xl: 'Revenue growth, %', yl: 'EV / Sales, x', fx: v => v.toFixed(0) + '%', fy: v => v.toFixed(1), C, ccy: c.ccy }, tt)}
              <div style={{ fontSize: 10.5, color: 'var(--mut)', marginTop: 6 }}>
                Companies above the growth-for-multiple diagonal screen expensive; below it, cheap.
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11.5, color: 'var(--mut)', padding: '28px 0' }}>Load a peer group to plot this comparison.</div>
          )}
        </div>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ ...cardTitle, marginBottom: 8 }}>Quality vs multiple · bubble = market cap</div>
          {peerRows.length > 1 ? (
            <>
              {scatterChart({ pts: peerRows.map((p: Peer) => ({ t: p.ticker, x: p.quality, y: p.evEbitda, m: Math.max(1, p.mcap), hl: p.ticker === c.ticker })), xl: qLabel + ', %', yl: 'EV / EBITDA, x', fx: v => v.toFixed(0) + '%', fy: v => v.toFixed(0), C, ccy: c.ccy }, tt)}
              <div style={{ fontSize: 10.5, color: 'var(--mut)', marginTop: 6 }}>
                High-{qLabel} names command higher EV/EBITDA; outliers merit a closer look.
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11.5, color: 'var(--mut)', padding: '28px 0' }}>Load a peer group to plot this comparison.</div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------- investment case

function CasePage(P: any) {
  const { c, C, narrow, variantText } = P;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px 12px', marginBottom: 16 }}>
        <h1 style={{ fontSize: 19, fontWeight: 600, margin: 0 }}>Investment case</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--mut)' }}>Rating</span>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', padding: '3px 10px', borderRadius: 3, background: 'var(--estBg)', color: 'var(--est)', fontFamily: MONO }}>{c.rating}</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: cols(narrow, '1.3fr 1fr'), gap: 10, marginBottom: 10 }}>
        <div style={{ ...card, padding: '16px 20px' }}>
          <div style={{ ...cardTitle, marginBottom: 12 }}>Investment thesis</div>
          {c.thesis.map((th: { n: string; h: string; t: string }) => (
            <div key={th.n} style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <span style={{ fontFamily: MONO, fontSize: 13, color: 'var(--acc)', fontWeight: 600 }}>{th.n}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{th.h}</div>
                <div style={{ fontSize: 12.5, color: 'var(--mut)' }}>{th.t}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ ...card, padding: '14px 18px' }}>
            <div style={{ ...cardTitle, color: 'var(--pos)', marginBottom: 8 }}>Key catalysts</div>
            {c.catalysts.map((k: { t: string; when: string }) => (
              <div key={k.t} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '5px 0', fontSize: 12 }}>
                <span style={{ minWidth: 0 }}>{k.t}</span>
                <span style={{ fontSize: 10.5, color: 'var(--mut)', fontFamily: MONO, whiteSpace: 'nowrap', flexShrink: 0 }}>{k.when}</span>
              </div>
            ))}
          </div>
          <div style={{ ...card, padding: '14px 18px' }}>
            <div style={{ ...cardTitle, color: 'var(--neg)', marginBottom: 8 }}>Key risks</div>
            {c.risks.map((r: { t: string; sev: string }) => (
              <div key={r.t} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '5px 0', fontSize: 12 }}>
                <span style={{ minWidth: 0 }}>{r.t}</span>
                <span style={{ fontSize: 10.5, color: r.sev === 'HIGH' ? 'var(--neg)' : 'var(--est)', fontFamily: MONO, whiteSpace: 'nowrap', flexShrink: 0 }}>{r.sev}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ background: 'var(--accS)', border: '1px solid var(--acc)', borderRadius: 5, padding: '16px 20px', marginBottom: 10 }}>
        <div style={{ ...cardTitle, color: 'var(--acc)', marginBottom: 8 }}>Variant perception — where could the market be wrong?</div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>{variantText}</div>
      </div>
      <div style={card}>
        <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--bor)', ...cardTitle }}>Quarterly monitoring dashboard</div>
        {narrow && (
          <div style={{ padding: '0 18px 8px', fontSize: 10.5, color: 'var(--mut)' }}>Swipe sideways for the trend and status columns.</div>
        )}
        <div style={narrow ? panX : undefined}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr .9fr', minWidth: narrow ? 580 : undefined }}>
            {[
              ['KPI', 'left', 18], ['Latest', 'right', 12], ['Estimate', 'right', 12], ['Trend (8Q)', 'left', 12], ['Status', 'left', 18],
            ].map(([h, al, px]) => (
              <div key={h as string} style={{ padding: `8px ${px}px`, fontSize: 10, color: 'var(--mut)', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid var(--bor)', textAlign: al as any }}>{h}</div>
            ))}
            {c.kpis.map((k: any) => (
              <React.Fragment key={k.l}>
                <div style={{ padding: '9px 18px', fontSize: 12.5, borderBottom: '1px solid var(--bor)' }}>{k.l}</div>
                <div style={{ padding: '9px 12px', fontSize: 12, borderBottom: '1px solid var(--bor)', textAlign: 'right', fontFamily: MONO, fontWeight: 600 }}>{k.latest}</div>
                <div style={{ padding: '9px 12px', fontSize: 12, borderBottom: '1px solid var(--bor)', textAlign: 'right', fontFamily: MONO, color: 'var(--mut)' }}>{k.est}</div>
                <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--bor)' }}>{sparkline(k.vals, !!k.good, C)}</div>
                <div style={{ padding: '9px 18px', borderBottom: '1px solid var(--bor)' }}>
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.05em', padding: '2px 8px', borderRadius: 3, background: k.st === 'ON TRACK' ? 'var(--posBg)' : k.st === 'WATCH' ? 'var(--estBg)' : 'var(--negBg)', color: k.st === 'ON TRACK' ? 'var(--pos)' : k.st === 'WATCH' ? 'var(--est)' : 'var(--neg)', fontFamily: MONO }}>{k.st}</span>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
