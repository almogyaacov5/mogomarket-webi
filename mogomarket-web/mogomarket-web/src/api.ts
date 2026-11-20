import { isCrypto } from "./symbols";

export interface Candle {
  time: number; // unix seconds, shifted to the exchange's local clock so the chart shows market hours
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartResult {
  candles: Candle[];
  /** Latest live price when the provider gives one, otherwise the last close. */
  price: number;
}

/** Candle size in minutes: 0 = daily, -1 = weekly. */
export type CandleSize = number;

export const CANDLE_SIZES: { value: CandleSize; label: string }[] = [
  { value: 0, label: "1 day" },
  { value: 1, label: "1 minute" },
  { value: 5, label: "5 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 65, label: "65 minutes" },
  { value: 90, label: "90 minutes" },
  { value: 120, label: "2 hours" },
  { value: 240, label: "4 hours" },
  { value: -1, label: "1 week" },
];

export const RANGES = ["1d", "5d", "1mo", "3mo", "6mo", "1y", "5y", "max"] as const;
export type Range = (typeof RANGES)[number];

const RANGE_ORDER = ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "max"];

/** Native bar size used to build the requested candle size. */
export function baseMinutes(size: CandleSize): number {
  if (size <= 0) return 0;
  if (size % 60 === 0) return 60;
  if (size % 30 === 0) return 30;
  if (size % 15 === 0) return 15;
  if (size % 5 === 0) return 5;
  return 1;
}

/** Intraday candles only exist for a limited history, so the range is clamped accordingly. */
export function effectiveRange(range: Range, size: CandleSize): string {
  if (size <= 0) return range;
  const base = baseMinutes(size);
  const cap = base === 1 ? "5d" : base <= 30 ? "1mo" : "1y";
  const ri = RANGE_ORDER.indexOf(range);
  const ci = RANGE_ORDER.indexOf(cap);
  return ri < 0 || ri > ci ? cap : range;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

/** Merges base bars into buckets of `minutes`, aligned to each trading day's first bar. */
export function aggregate(src: Candle[], minutes: number): Candle[] {
  const span = minutes * 60;
  const out: Candle[] = [];
  let curDay = NaN;
  let dayFirst = 0;
  let curBucket = NaN;
  let cur: Candle | null = null;
  for (const b of src) {
    const dayKey = Math.floor(b.time / 86400); // times are already on the exchange clock
    if (dayKey !== curDay) {
      curDay = dayKey;
      dayFirst = b.time;
      curBucket = NaN;
    }
    const bucket = Math.floor((b.time - dayFirst) / span);
    if (!cur || bucket !== curBucket || Math.floor(cur.time / 86400) !== dayKey) {
      cur = { ...b };
      out.push(cur);
      curBucket = bucket;
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  return out;
}

function tidy(c: Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  for (const x of c) map.set(x.time, x);
  return [...map.values()].sort((a, b) => a.time - b.time);
}

async function yahoo(symbol: string, size: CandleSize, range: Range): Promise<ChartResult> {
  const base = baseMinutes(size);
  const interval = size === -1 ? "1wk" : size > 0 ? `${base === 60 ? "60" : base}m` : "1d";
  const rng = effectiveRange(range, size);
  const url = `/api/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${rng}&includePrePost=false`;
  const json = await getJson(url);
  const item = json?.chart?.result?.[0];
  if (!item || !item.timestamp) throw new Error(`No data for ${symbol}`);
  const q = item.indicators.quote[0];
  const offset: number = item.meta?.gmtoffset ?? 0;
  let candles: Candle[] = [];
  for (let i = 0; i < item.timestamp.length; i++) {
    if (q.close[i] == null || q.open[i] == null || q.high[i] == null || q.low[i] == null) continue;
    candles.push({
      time: item.timestamp[i] + offset,
      open: q.open[i],
      high: q.high[i],
      low: q.low[i],
      close: q.close[i],
      volume: q.volume?.[i] ?? 0,
    });
  }
  if (size > 0 && size !== base) candles = aggregate(candles, size);
  candles = tidy(candles);
  const live = item.meta?.regularMarketPrice;
  return { candles, price: Number.isFinite(live) ? live : candles[candles.length - 1]?.close ?? 0 };
}

function binanceInterval(size: CandleSize): string {
  if (size === -1) return "1w";
  if (size <= 0) return "1d";
  const base = baseMinutes(size);
  return base === 60 ? "1h" : `${base}m`;
}

function binanceLimit(interval: string, range: Range): number {
  if (range === "max") return 1000;
  const rangeSec: Record<string, number> = {
    "1d": 86400, "5d": 7 * 86400, "1mo": 30 * 86400, "3mo": 90 * 86400, "6mo": 180 * 86400,
    "1y": 365 * 86400, "5y": 1825 * 86400,
  };
  const candleSec: Record<string, number> = {
    "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "1d": 86400, "1w": 7 * 86400,
  };
  const n = Math.ceil((rangeSec[range] ?? 365 * 86400) / (candleSec[interval] ?? 86400));
  return Math.max(1, Math.min(1000, n));
}

async function binance(symbol: string, size: CandleSize, range: Range): Promise<ChartResult> {
  const pair = symbol.slice(symbol.indexOf(":") + 1);
  const interval = binanceInterval(size);
  const url = `/api/binance/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${binanceLimit(interval, range)}`;
  const arr: any[][] = await getJson(url);
  const offset = -new Date().getTimezoneOffset() * 60; // crypto is shown on the viewer's clock
  let candles: Candle[] = arr.map((k) => ({
    time: Math.floor(k[0] / 1000) + offset,
    open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  }));
  if (size > 0 && size !== baseMinutes(size)) candles = aggregate(candles, size);
  candles = tidy(candles);
  return { candles, price: candles[candles.length - 1]?.close ?? 0 };
}

export async function fetchCandles(symbol: string, size: CandleSize, range: Range): Promise<ChartResult> {
  const r = isCrypto(symbol) ? await binance(symbol, size, range) : await yahoo(symbol, size, range);
  if (r.candles.length === 0) throw new Error(`No data for ${symbol}`);
  return r;
}

export interface Quote {
  price: number;
  changePct: number;
}

export async function fetchQuote(symbol: string): Promise<Quote> {
  if (isCrypto(symbol)) {
    const pair = symbol.slice(symbol.indexOf(":") + 1);
    const j = await getJson(`/api/binance/api/v3/ticker/24hr?symbol=${pair}`);
    return { price: +j.lastPrice, changePct: +j.priceChangePercent };
  }
  const json = await getJson(`/api/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`);
  const item = json?.chart?.result?.[0];
  const closes: number[] = (item?.indicators?.quote?.[0]?.close ?? []).filter((x: number | null) => x != null);
  const price: number = item?.meta?.regularMarketPrice ?? closes[closes.length - 1];
  const prev = closes.length >= 2 ? closes[closes.length - 2] : item?.meta?.chartPreviousClose ?? price;
  return { price, changePct: prev ? ((price - prev) / prev) * 100 : 0 };
}

export async function searchSymbols(q: string): Promise<{ symbol: string; name: string }[]> {
  if (q.trim().length < 1) return [];
  const j = await getJson(`/api/yahoo/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`);
  return (j.quotes ?? [])
    .filter((x: any) => x.symbol)
    .map((x: any) => ({ symbol: x.symbol as string, name: (x.shortname ?? x.longname ?? "") as string }));
}
