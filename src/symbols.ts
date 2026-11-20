// Symbol conventions shared with the Android app: crypto is "BINANCE:BTCUSDT",
// forex and commodities use Yahoo symbols ("EURUSD=X", "GC=F").

const CRYPTO: Record<string, string> = {};
for (const c of ["BTC", "ETH", "XRP", "SOL", "BNB", "DOGE", "ADA", "AVAX", "DOT", "LINK", "LTC", "MATIC", "UNI"]) {
  CRYPTO[c] = `BINANCE:${c}USDT`;
  CRYPTO[`${c}USD`] = `BINANCE:${c}USDT`;
  CRYPTO[`${c}USDT`] = `BINANCE:${c}USDT`;
}

const FOREX: Record<string, string> = {
  EURUSD: "EURUSD=X", USDILS: "USDILS=X", GBPUSD: "GBPUSD=X", USDJPY: "USDJPY=X", AUDUSD: "AUDUSD=X",
  USDCAD: "USDCAD=X", USDCHF: "USDCHF=X", NZDUSD: "NZDUSD=X", EURGBP: "EURGBP=X", EURJPY: "EURJPY=X",
  GBPJPY: "GBPJPY=X", USDINR: "USDINR=X", USDCNY: "USDCNY=X", USDBRL: "USDBRL=X", USDMXN: "USDMXN=X",
  EURILS: "EURILS=X", GBPILS: "GBPILS=X", XAUUSD: "GC=F", GOLD: "GC=F", XAGUSD: "SI=F", SILVER: "SI=F",
  XBRUSD: "BZ=F", OIL: "CL=F", CRUDE: "CL=F", WTI: "CL=F", USOIL: "CL=F", CRUDEOIL: "CL=F",
  BRENT: "BZ=F", UKOIL: "BZ=F", VIX: "^VIX", VIXINDEX: "^VIX",
};

export function normalizeSymbol(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (!s) return "";
  if (CRYPTO[s]) return CRYPTO[s];
  if (FOREX[s]) return FOREX[s];
  if (s === "SPX" || s === "^SPX" || s === "GSPC") return "^GSPC";
  return s;
}

export const isCrypto = (sym: string): boolean => sym.includes(":");

export function displaySymbol(sym: string): string {
  if (isCrypto(sym)) return sym.slice(sym.indexOf(":") + 1);
  if (sym === "^VIX") return "VIX";
  if (sym === "CL=F") return "OIL";
  if (sym === "BZ=F") return "BRENT";
  return sym.replace("=X", "").replace("=F", "");
}

export const isForex = (sym: string): boolean => sym.endsWith("=X");

/** Firebase keys cannot contain ":" or "." - same rule the Android app uses. */
export const firebaseKey = (sym: string): string => sym.replace(/:/g, "_").replace(/\./g, "_");
