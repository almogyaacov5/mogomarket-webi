// Technical indicators on a close-price series. Undefined points are NaN.

const nans = (n: number): number[] => new Array<number>(n).fill(NaN);

export function sma(c: number[], n: number): number[] {
  const out = nans(c.length);
  let sum = 0;
  for (let i = 0; i < c.length; i++) {
    sum += c[i];
    if (i >= n) sum -= c[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** Returns [middle, upper, lower]. */
export function bollinger(c: number[], n = 20, k = 2): number[][] {
  const mid = sma(c, n);
  const up = nans(c.length);
  const low = nans(c.length);
  for (let i = n - 1; i < c.length; i++) {
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (c[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / n);
    up[i] = mid[i] + k * sd;
    low[i] = mid[i] - k * sd;
  }
  return [mid, up, low];
}

/** EMA over a series that may start with NaNs, seeded with the SMA of the first n values. */
export function ema(v: number[], n: number): number[] {
  const out = nans(v.length);
  let first = 0;
  while (first < v.length && Number.isNaN(v[first])) first++;
  if (v.length - first < n) return out;
  let sum = 0;
  for (let i = first; i < first + n; i++) sum += v[i];
  let e = sum / n;
  out[first + n - 1] = e;
  const k = 2 / (n + 1);
  for (let i = first + n; i < v.length; i++) {
    e = v[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

/** Wilder RSI. */
export function rsi(c: number[], n = 14): number[] {
  const out = nans(c.length);
  if (c.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = c[i] - c[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  const val = (g: number, l: number): number => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
  out[n] = val(gain, loss);
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = val(gain, loss);
  }
  return out;
}

/** Returns [macd, signal, histogram]. */
export function macd(c: number[], fast = 12, slow = 26, signal = 9): number[][] {
  const f = ema(c, fast);
  const s = ema(c, slow);
  const line = c.map((_, i) => (Number.isNaN(f[i]) || Number.isNaN(s[i]) ? NaN : f[i] - s[i]));
  const sig = ema(line, signal);
  const hist = line.map((v, i) => (Number.isNaN(v) || Number.isNaN(sig[i]) ? NaN : v - sig[i]));
  return [line, sig, hist];
}
