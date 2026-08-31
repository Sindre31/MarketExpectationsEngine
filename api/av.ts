/**
 * Vercel serverless function: proxies Alpha Vantage using a shared key stored
 * server-side, so visitors don't need their own key.
 *
 * Configure in Vercel: Project → Settings → Environment Variables →
 *   ALPHAVANTAGE_API_KEY = <your key>
 *
 * Only a fixed set of read-only endpoints is allowed, and only the
 * symbol/keywords parameters are forwarded, so the shared key can't be used
 * for anything else. Responses are cached at the edge to stretch the key's
 * daily quota.
 */

const ALLOWED = new Set([
  'OVERVIEW',
  'GLOBAL_QUOTE',
  'INCOME_STATEMENT',
  'BALANCE_SHEET',
  'CASH_FLOW',
  'TIME_SERIES_MONTHLY_ADJUSTED',
  'SYMBOL_SEARCH',
]);

// seconds of edge cache per endpoint: quotes stay fresh, filings barely change
const CACHE: Record<string, number> = {
  GLOBAL_QUOTE: 300,
  SYMBOL_SEARCH: 86400,
  OVERVIEW: 21600,
  INCOME_STATEMENT: 86400,
  BALANCE_SHEET: 86400,
  CASH_FLOW: 86400,
  TIME_SERIES_MONTHLY_ADJUSTED: 21600,
};

const SAFE = /^[A-Za-z0-9 .\-:&]{1,40}$/;

export default async function handler(req: any, res: any) {
  const key = process.env.ALPHAVANTAGE_API_KEY;
  if (!key) {
    res.status(503).json({ error: 'No shared API key is configured on the server — add your own key via the API button.' });
    return;
  }
  const fn = String(req.query.function || '');
  if (!ALLOWED.has(fn)) {
    res.status(400).json({ error: 'Unsupported function' });
    return;
  }
  const params = new URLSearchParams({ function: fn, apikey: key });
  for (const p of ['symbol', 'keywords'] as const) {
    const v = req.query[p];
    if (typeof v === 'string' && v) {
      if (!SAFE.test(v)) {
        res.status(400).json({ error: 'Invalid ' + p });
        return;
      }
      params.set(p, v);
    }
  }
  try {
    const upstream = await fetch('https://www.alphavantage.co/query?' + params.toString());
    const body = await upstream.text();

    // Alpha Vantage reports rate limits and bad symbols as HTTP 200 with a
    // notice payload. Caching one of those would serve the error to everyone
    // until it expired, so notices are passed through uncached.
    let notice: string | null = null;
    try {
      const parsed = JSON.parse(body);
      notice = parsed['Information'] || parsed['Error Message'] || parsed['Note'] || null;
      // An empty object means "nothing for this symbol right now" — sometimes an
      // unknown ticker, sometimes a hiccup. Either way it must not be cached, or
      // a real company can go blank for the rest of the cache window.
      if (!notice && Object.keys(parsed).length === 0) notice = `No data returned for "${req.query.symbol || ''}"`;
    } catch {
      notice = 'Malformed response from the market-data provider';
    }
    if (notice) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(/per second|per day|rate limit|premium/i.test(notice) ? 429 : 502).json({ error: notice });
      return;
    }

    res.setHeader('Cache-Control', `s-maxage=${CACHE[fn] ?? 3600}, stale-while-revalidate=86400`);
    res.status(upstream.ok ? 200 : upstream.status).setHeader('Content-Type', 'application/json').send(body);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'Upstream market-data request failed' });
  }
}
