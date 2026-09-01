import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler, { redact } from '../av';

const KEY = 'SECRETKEY1234567';

function mockRes() {
  const out = { code: 0, headers: {} as Record<string, string>, body: '' };
  const res = {
    status(c: number) { out.code = c; return res; },
    setHeader(k: string, v: string) { out.headers[k] = v; return res; },
    json(o: unknown) { out.body = JSON.stringify(o); return res; },
    send(b: unknown) { out.body = String(b); return res; },
  };
  return { out, res };
}
const upstream = (body: string, ok = true, status = 200) =>
  vi.fn().mockResolvedValue({ ok, status, text: async () => body });

beforeEach(() => { process.env.ALPHAVANTAGE_API_KEY = KEY; });
afterEach(() => { vi.restoreAllMocks(); });

describe('redact', () => {
  it('removes the key when the provider quotes it back', () => {
    const msg = `We have detected your API key as ${KEY} and our rate limit is 25 per day.`;
    expect(redact(msg, KEY)).not.toContain(KEY);
  });

  it('removes a key-shaped token even when it is not the configured key', () => {
    // the deployed key may differ from the one in the message (rotation, proxies)
    const out = redact('We have detected your API key as SW79UWM6SC2UDPTX and ...', KEY);
    expect(out).not.toMatch(/SW79UWM6SC2UDPTX/);
    expect(out).toContain('***');
  });

  it('leaves ordinary notices intact', () => {
    const msg = 'Please consider spreading out your free API requests (1 per second).';
    expect(redact(msg, KEY)).toBe(msg);
  });
});

describe('av handler', () => {
  it('proxies an allowed endpoint and marks it cacheable', async () => {
    vi.stubGlobal('fetch', upstream('{"Symbol":"IBM"}'));
    const { out, res } = mockRes();
    await handler({ query: { function: 'OVERVIEW', symbol: 'IBM' } }, res);
    expect(out.code).toBe(200);
    expect(out.headers['Cache-Control']).toMatch(/s-maxage=\d+/);
    expect(out.body).toContain('IBM');
  });

  it('refuses endpoints outside the whitelist', async () => {
    const fetchSpy = upstream('{}');
    vi.stubGlobal('fetch', fetchSpy);
    const { out, res } = mockRes();
    await handler({ query: { function: 'LISTING_STATUS' } }, res);
    expect(out.code).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();   // never reaches upstream with our key
  });

  it('rejects a malformed symbol', async () => {
    const fetchSpy = upstream('{}');
    vi.stubGlobal('fetch', fetchSpy);
    const { out, res } = mockRes();
    await handler({ query: { function: 'OVERVIEW', symbol: '../../etc/passwd' } }, res);
    expect(out.code).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never caches a rate-limit notice, and never leaks the key in one', async () => {
    vi.stubGlobal('fetch', upstream(JSON.stringify({
      Information: `We have detected your API key as ${KEY} and our standard rate limit is 25 requests per day.`,
    })));
    const { out, res } = mockRes();
    await handler({ query: { function: 'OVERVIEW', symbol: 'IBM' } }, res);
    expect(out.code).toBe(429);
    expect(out.headers['Cache-Control']).toBe('no-store');
    expect(out.body).not.toContain(KEY);
  });

  it('never caches an empty payload', async () => {
    // caching "{}" once blanked a real company for the whole cache window
    vi.stubGlobal('fetch', upstream('{}'));
    const { out, res } = mockRes();
    await handler({ query: { function: 'OVERVIEW', symbol: 'ACN' } }, res);
    expect(out.headers['Cache-Control']).toBe('no-store');
    expect(out.code).toBeGreaterThanOrEqual(400);
  });

  it('reports a missing server key without pretending to serve data', async () => {
    delete process.env.ALPHAVANTAGE_API_KEY;
    const { out, res } = mockRes();
    await handler({ query: { function: 'OVERVIEW', symbol: 'IBM' } }, res);
    expect(out.code).toBe(503);
  });

  it('forwards only symbol and keywords, never arbitrary query params', async () => {
    const fetchSpy = upstream('{"Symbol":"IBM"}');
    vi.stubGlobal('fetch', fetchSpy);
    const { res } = mockRes();
    await handler({ query: { function: 'OVERVIEW', symbol: 'IBM', datatype: 'csv', outputsize: 'full' } }, res);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('symbol=IBM');
    expect(url).not.toContain('datatype');
    expect(url).not.toContain('outputsize');
  });
});
