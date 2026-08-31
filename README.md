# Market Expectations Engine

A reverse-DCF equity analysis terminal. Instead of estimating what a company is
worth, it solves for the expectations embedded in the current share price — the
revenue growth and terminal margins the market is implicitly paying for — and
lets you judge whether those expectations are conservative, reasonable, or
aggressive.

Built with React + TypeScript + Vite. Works out of the box with a mock NOK
dataset (two Oslo Børs companies, `NDLS` and `VSTM`) — and loads **any real
listed company live** through the Alpha Vantage API.

## Live data

Search any ticker — e.g. `IBM`, `AAPL`, `MSFT` — and pick **LOAD LIVE**. Live
requests go through two paths:

1. **Shared key (default)** — the serverless function `api/av.ts` proxies
   Alpha Vantage with a key stored server-side. On Vercel, set the environment
   variable **`ALPHAVANTAGE_API_KEY`** (Project → Settings → Environment
   Variables) and redeploy. The function only allows the seven read-only
   endpoints the app uses and caches successful responses at the edge (filings
   6–24h, quotes 5 min) to stretch the key's quota. The provider reports rate
   limits and bad symbols as HTTP 200 with a notice payload, so those are
   detected and passed through uncached — otherwise one throttled request
   would be served to every visitor until it expired.
2. **Personal key** — click **API** in the header and paste your own free key
   from [alphavantage.co](https://www.alphavantage.co/support/#api-key); it is
   stored only in your browser's `localStorage` and used directly, bypassing
   the shared proxy.

One company load uses 6 API requests (overview, quote, income statement,
balance sheet, cash flow, monthly prices), fetched about a second apart because
the free tier allows one request per second; a load therefore takes ~7s the
first time and is near-instant afterwards from the edge cache. The free tier
also caps usage at 25 requests/day per key — roughly four cold company loads.

The adapter (`src/live.ts`) maps real filings into the model: the last four
fiscal years are reported actuals, the four estimate years are trend
extrapolations (labelled as such in the UI — Alpha Vantage does not provide
analyst consensus), and everything downstream — reverse DCF, scenarios,
sensitivity, valuation — runs unchanged in the company's reporting currency.

### Live peer groups

The provider has no "competitors" endpoint, so `src/peers.ts` keeps a universe
of liquid listed names grouped by what they do and matches it against the
company's own reported industry — loading IBM picks ACN, INFY, CTSH, DXC and
EPAM.

A Nordic company leads with Nordic comparables and is topped up from the wider
list, so the group is regionally relevant without being too thin to compare
against: Equinor gets Frontline then the oil majors, Novo Nordisk gets Genmab
then the big pharma names, Ericsson gets Nokia then the hardware set. A company
counts as Nordic by ticker, reporting currency, exchange, or a Nordic corporate
form in its name (ASA, A/S, AB, Oyj) — the last catches ADRs, which list in USD
on a US exchange. US companies are unaffected.

**Nordic coverage is limited by the provider, not by choice.** Every Nordic
ticker in the universe is a primary US listing or a NYSE/NASDAQ ADR, because
those are the only ones with fundamentals: local tickers (`EQNR.OL`,
`NOVO-B.CO`, `ERIC-B.ST`) and OTC pink-sheet ADRs (`NHYDY`, `YARIY`, `DNNGY`,
`ATLKY`, `VLVLY`, `NRDBY`) were all tested and return nothing at all. The
verified set is EQNR, NVO, ERIC, NOK, ALV, FRO and GMAB. Anything else can
still be added by ticker on the Peers page.

One wrinkle worth knowing when extending the industry map: the provider mixes
two taxonomies. IBM reports `INFORMATION TECHNOLOGY SERVICES` (SIC-flavoured)
while Novo Nordisk reports `DRUG MANUFACTURERS - GENERAL` and Ericsson
`COMMUNICATION EQUIPMENT` (modern sector names). `BY_INDUSTRY` matches both
spellings of each industry.

A group of five loads **automatically** whenever a live company is fetched, in
the background: the company renders as soon as its own data lands, the header
shows `Loading peers n/5…`, and the peer-median columns light up as the group
arrives. On the Peers page you can reload the suggestion, add any ticker by hand
(the escape hatch for anything the universe misses, including non-US listings),
or drop a name. Each peer costs exactly **one** request, and a group is cached
per company for 24h, so a live company costs 6 requests the first time and 11
with its peer group — budget accordingly against the free tier's 25/day.

Two honest limits, surfaced in the UI rather than papered over: one `OVERVIEW`
call exposes **return on equity, not ROIC**, so the column and scatter axis are
relabelled ROE for live groups; and free cash flow yield is not published per
company, so that column shows `–` for peers. The fictional Norwegian mock
universe is never used as a stand-in for a live company — if the automatic load
comes back empty (usually a spent quota), the peer-median columns read `–`
rather than borrowing mock figures.

### What the live adapter will not invent

Where the provider publishes nothing, the app shows `–` rather than a stand-in,
because these figures render in columns a reader takes as reported fact:

- **Football-field multiple bars.** There are no historical trading bands for a
  live company, so bars are built from the peer group's actual low–high and
  labelled `· peers`. A spread around today's multiple would be arithmetic
  wearing a band's clothes; where no peer or reported range exists, the bar is
  left out.
- **Reported multiples and the 52-week range** are passed through or absent —
  never replaced by a model-derived number or a literal.
- **The KPI dashboard is annual on live data** (`Trend (8Y)`), and the forecast
  half of every sparkline is dashed, since only the first four points are
  reported.

The starting **WACC is derived per company** — CAPM cost of equity from the
provider's beta, blended with after-tax cost of debt at the company's actual
capital structure, clamped to the slider's 6–12% range. The risk-free rate
(4%), equity risk premium (5%) and debt spread (1.5%) are house assumptions;
terminal growth stays 2.5% as a long-run nominal-GDP proxy. All of them are
there to be disagreed with on the Expectations page — for a commodity cyclical
a beta-derived rate tends to sit low.

## Screens

| # | Screen | What it does |
|---|--------|--------------|
| 01 | **Overview** | KPI cards, valuation vs history & peers, share price chart (1Y/3Y/5Y), revenue/margin/EPS development, bull & bear case, key debate |
| 02 | **Expectations** | The reverse DCF. Adjust seven assumptions (revenue CAGR, terminal growth, EBITDA/EBIT margins, tax, capex, WACC) and see your model value vs the market price, the market-implied growth/margin/FCF/ROIC, and the revenue path the price implies vs consensus. Save assumption sets as presets (persisted in `localStorage`) |
| 03 | **Financials** | Income statement, balance sheet, cash flow, and KPI tabs, FY22A–FY29E, with estimate shading and expandable revenue segments |
| 04 | **Scenarios** | Bear/Base/Bull scenario cards, each running the full DCF live, plus a valuation range chart and a WACC × terminal-growth sensitivity grid |
| 05 | **Valuation** | DCF build-up, trading multiples → implied price, football field, EPS bridge waterfall |
| 06 | **Peers** | Peer comps table and growth-vs-valuation / quality-vs-multiple bubble scatters |
| 07 | **Investment Case** | Thesis, catalysts, risks, variant perception (fed by the live reverse-DCF outputs), and a KPI dashboard with sparklines — quarterly for the mock set, annual on live data |

Also: light/dark theme toggle (persisted), company search/switcher, crosshair
tooltips on every chart (hover devices only), and a print-friendly Export (save
as PDF) mode.

The layout is responsive: below 860px the sidebar becomes a sticky tab strip,
the card grids fold to one column, and the dense tables (financial model, peer
comps, sensitivity, KPI monitor) pan sideways with their label column pinned.

## Getting started

```bash
npm install
npm run dev       # local dev server
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build
```

## Project layout

```
src/
  data.ts      mock company dataset + peer comps (the data contract)
  live.ts      Alpha Vantage adapter — fetches a real company and maps it
               into the same Company shape the mocks use
  peers.ts     live peer groups — industry-matched suggestions, one request
               per peer, cached per company
  engine.ts    the DCF engine and the bisection solver used for
               "what growth does the price imply?"
  charts.tsx   dependency-free SVG charts: line, combo bar+line, range/
               football field, scatter, waterfall, sparkline
  App.tsx      the terminal UI — nav, header, and the seven screens
  styles.css   theme tokens (light/dark), global styles, print rules
api/
  av.ts        Vercel serverless function — shared-key Alpha Vantage proxy
               (reads ALPHAVANTAGE_API_KEY, whitelists endpoints, edge-caches)
design/
  Market Expectations Engine.dc.html   the original Claude Design source
  support.js                           its runtime (open the .dc.html in a
                                       browser to view the design)
```

## The model, briefly

`engine.ts` runs a five-year explicit DCF off FY2025A revenue: margins
interpolate linearly from today's level to your terminal assumption, free cash
flow is EBITDA − cash tax on EBIT − capex − working-capital drag, and a
Gordon-growth terminal value is added (with the WACC−g spread floored so the
terminal value can't blow up). The reverse step bisects on revenue growth (and
separately on terminal margin at consensus growth) until the model value equals
the market price.

All figures are mock data in NOK; nothing here is investment advice.
