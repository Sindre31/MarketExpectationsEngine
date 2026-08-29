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
   endpoints the app uses and caches responses at the edge (filings 6–24h,
   quotes 5 min) to stretch the key's quota.
2. **Personal key** — click **API** in the header and paste your own free key
   from [alphavantage.co](https://www.alphavantage.co/support/#api-key); it is
   stored only in your browser's `localStorage` and used directly, bypassing
   the shared proxy.

One company load uses 6 API requests (overview, quote, income statement,
balance sheet, cash flow, monthly prices), fetched sequentially to respect the
API's burst limit; the free tier allows 25 requests/day per key.

The adapter (`src/live.ts`) maps real filings into the model: the last four
fiscal years are reported actuals, the four estimate years are trend
extrapolations (labelled as such in the UI — Alpha Vantage does not provide
analyst consensus), and everything downstream — reverse DCF, scenarios,
sensitivity, valuation — runs unchanged in the company's reporting currency.

## Screens

| # | Screen | What it does |
|---|--------|--------------|
| 01 | **Overview** | KPI cards, valuation vs history & peers, share price chart (1Y/3Y/5Y), revenue/margin/EPS development, bull & bear case, key debate |
| 02 | **Expectations** | The reverse DCF. Adjust seven assumptions (revenue CAGR, terminal growth, EBITDA/EBIT margins, tax, capex, WACC) and see your model value vs the market price, the market-implied growth/margin/FCF/ROIC, and the revenue path the price implies vs consensus. Save assumption sets as presets (persisted in `localStorage`) |
| 03 | **Financials** | Income statement, balance sheet, cash flow, and KPI tabs, FY22A–FY29E, with estimate shading and expandable revenue segments |
| 04 | **Scenarios** | Bear/Base/Bull scenario cards, each running the full DCF live, plus a valuation range chart and a WACC × terminal-growth sensitivity grid |
| 05 | **Valuation** | DCF build-up, trading multiples → implied price, football field, EPS bridge waterfall |
| 06 | **Peers** | Peer comps table and growth-vs-valuation / quality-vs-multiple bubble scatters |
| 07 | **Investment Case** | Thesis, catalysts, risks, variant perception (fed by the live reverse-DCF outputs), and a quarterly KPI monitoring dashboard with sparklines |

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
