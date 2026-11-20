/** Shared trade model, mirrors the Android StockData fields stored in Firebase. */
export interface Trade {
  symbol: string;
  name?: string;
  buyPrice: number;
  targetPrice?: number;
  stopLossPrice?: number;
  sellPrice?: number;
  tradeAmount: number;
  shares?: number;
  entryFees?: number;
  exitFees?: number;
  taxes?: number;
  notes?: string;
  strategyTag?: string;
  sector?: string;
  exitReason?: string;
  moodTag?: string;
  openedAt?: number;
  closedAt?: number;
  closedTradeId?: string;
  tradeNumber?: string;
  missedProfitLoss?: number;
  [k: string]: unknown;
}

export const MOODS = ["None", "Disciplined", "FOMO", "Revenge trade", "Fear", "Greed", "Hesitated", "Over-sized"];
export const EXIT_REASONS = ["Target hit", "Stop loss", "Manual exit", "Rebalance", "Other"];

export const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Net P/L of a closed trade (same formula as Android StockData.calculateProfitLoss). */
export function profitLoss(t: Trade): number {
  const gross = n(t.tradeAmount) > 0 && n(t.buyPrice) > 0
    ? ((n(t.sellPrice) - n(t.buyPrice)) * n(t.tradeAmount)) / n(t.buyPrice)
    : n(t.sellPrice) - n(t.buyPrice);
  return gross - n(t.entryFees) - n(t.exitFees) - n(t.taxes);
}

export function profitLossPct(t: Trade): number {
  const invested = n(t.tradeAmount) > 0 ? n(t.tradeAmount) : n(t.buyPrice) * (n(t.shares) > 0 ? n(t.shares) : 1);
  return invested > 0 ? (profitLoss(t) / invested) * 100 : 0;
}

/** Unrealised P/L of an open trade at a live price (before exit fees). */
export function openPnl(t: Trade, price: number): number {
  if (!(n(t.buyPrice) > 0) || !Number.isFinite(price)) return NaN;
  return ((price - n(t.buyPrice)) * n(t.tradeAmount)) / n(t.buyPrice) - n(t.entryFees);
}

export function toRoman(num: number): string {
  const v = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const s = ["M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"];
  let out = "";
  v.forEach((x, i) => {
    while (num >= x) {
      out += s[i];
      num -= x;
    }
  });
  return out;
}

export const fmtMoney = (v: number): string =>
  Number.isFinite(v) ? `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "--";

export const fmtDate = (ms?: number): string => (ms && ms > 0 ? new Date(ms).toLocaleDateString() : "-");

/** Merge two open trades in the same symbol (weighted average entry). */
export function combine(a: Trade, b: Trade): Trade {
  const sh = (t: Trade): number => (n(t.shares) > 0 ? n(t.shares) : n(t.buyPrice) > 0 ? n(t.tradeAmount) / n(t.buyPrice) : 0);
  const amount = n(a.tradeAmount) + n(b.tradeAmount);
  const shares = sh(a) + sh(b);
  return {
    ...a,
    ...b,
    buyPrice: shares > 0 ? amount / shares : n(b.buyPrice),
    tradeAmount: amount,
    shares,
    entryFees: n(a.entryFees) + n(b.entryFees),
    openedAt: Math.min(n(a.openedAt) || Infinity, n(b.openedAt) || Infinity) || Date.now(),
    notes: [a.notes, b.notes].filter(Boolean).join("\n"),
  };
}
