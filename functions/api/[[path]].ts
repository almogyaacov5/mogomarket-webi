// Cloudflare Pages Function: a small allow-listed proxy for market data.
// Browsers cannot call Yahoo Finance directly (CORS), so the site calls /api/yahoo/... and
// /api/binance/... on its own origin and this function forwards the request.

type Ctx = { request: Request; params: { path?: string | string[] } };

const UPSTREAMS: Record<string, { base: string; allow: RegExp }> = {
  yahoo: {
    base: "https://query1.finance.yahoo.com",
    allow: /^(v8\/finance\/chart\/[^/]+|v1\/finance\/search)$/,
  },
  binance: {
    base: "https://data-api.binance.vision",
    allow: /^api\/v3\/(klines|ticker\/24hr|ticker\/price)$/,
  },
};

export const onRequestGet = async ({ request, params }: Ctx): Promise<Response> => {
  const parts = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  const [provider, ...rest] = parts;
  const upstream = UPSTREAMS[provider ?? ""];
  const path = rest.join("/");
  if (!upstream || !upstream.allow.test(path)) {
    return new Response("Not found", { status: 404 });
  }
  const url = new URL(request.url);
  const target = `${upstream.base}/${path}${url.search}`;
  const res = await fetch(target, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    cf: { cacheTtl: 5, cacheEverything: true },
  } as RequestInit);
  return new Response(res.body, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "application/json",
      "Cache-Control": "public, max-age=5",
    },
  });
};
