import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type UTCTimestamp,
} from "lightweight-charts";
import { openAlertDialog } from "./alerts";
import {
  CANDLE_SIZES,
  RANGES,
  effectiveRange,
  fetchCandles,
  searchSymbols,
  type Candle,
  type Range,
} from "./api";
import * as ind from "./indicators";
import { displaySymbol, isForex, normalizeSymbol } from "./symbols";
import { el, fmtPct, fmtPrice, modal, toast } from "./ui";

const UP = "#22c55e";
const DOWN = "#ef4444";
const GOLD = "#ffd54f";

interface Prefs {
  candle: number;
  range: Range;
  type: "candles" | "line";
  vol: boolean;
  ma20: boolean;
  ma50: boolean;
  ma200: boolean;
  boll: boolean;
  pane: "none" | "rsi" | "macd";
}

const DEFAULT_PREFS: Prefs = {
  candle: 0,
  range: "1y",
  type: "candles",
  vol: true,
  ma20: false,
  ma50: false,
  ma200: false,
  boll: false,
  pane: "none",
};

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem("mm_chart_prefs") ?? "{}") };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

interface Drawing {
  type: "h" | "t" | "f"; // horizontal line, trend line, Fibonacci
  t1: number;
  p1: number;
  t2: number;
  p2: number;
}

const drawingsKey = (sym: string): string => `mm_drawings_${sym}`;
function loadDrawings(sym: string): Drawing[] {
  try {
    return JSON.parse(localStorage.getItem(drawingsKey(sym)) ?? "[]");
  } catch {
    return [];
  }
}
const saveDrawings = (sym: string, d: Drawing[]): void => localStorage.setItem(drawingsKey(sym), JSON.stringify(d));

type Mode = "none" | "h" | "t" | "f" | "alert";

export function mountChart(root: HTMLElement, uid: string, initialSymbol: string): () => void {
  const prefs = loadPrefs();
  let symbol = normalizeSymbol(initialSymbol) || "SPY";
  let candles: Candle[] = [];
  let livePrice = 0;
  let chart: IChartApi | null = null;
  let priceSeries: ISeriesApi<"Candlestick"> | ISeriesApi<"Area"> | null = null;
  let drawLines: IPriceLine[] = [];
  let drawSeries: ISeriesApi<"Line">[] = [];
  let mode: Mode = "none";
  let pending: { t: number; p: number } | null = null;
  let token = 0;
  const savePrefs = (): void => localStorage.setItem("mm_chart_prefs", JSON.stringify(prefs));

  // ---------- layout ----------
  const symInput = el("input", { class: "input sym", value: displaySymbol(symbol), list: "sym-suggest", placeholder: "Symbol" });
  const suggest = el("datalist", { id: "sym-suggest" });
  const goBtn = el("button", { class: "btn primary" }, "Go");
  const rangeBtns = RANGES.map((r) =>
    el("button", { class: "chip", "data-r": r }, r === "max" ? "MAX" : r.toUpperCase()),
  );
  const candleSel = el("select", { class: "input", title: "Candle size" });
  for (const c of CANDLE_SIZES) candleSel.append(el("option", { value: String(c.value) }, c.label));
  const typeSel = el("select", { class: "input", title: "Chart type" }, el("option", { value: "candles" }, "Candles"), el("option", { value: "line" }, "Line"));

  const indBox = el("div", { class: "menu-body" });
  const drawBox = el("div", { class: "menu-body" });
  const indMenu = el("details", { class: "menu" }, el("summary", { class: "btn" }, "Indicators"), indBox);
  const drawMenu = el("details", { class: "menu" }, el("summary", { class: "btn" }, "Draw & alerts"), drawBox);

  const headSym = el("span", { class: "h-sym" });
  const headPrice = el("span", { class: "h-price" });
  const headChg = el("span", { class: "h-chg" });
  const legend = el("div", { class: "legend" });
  const box = el("div", { class: "chartbox" });
  const hint = el("div", { class: "hint" });

  root.replaceChildren(
    el("div", { class: "toolbar" }, symInput, suggest, goBtn, el("div", { class: "chips" }, ...rangeBtns), candleSel, typeSel, indMenu, drawMenu),
    el("div", { class: "headline" }, headSym, headPrice, headChg),
    el("div", { class: "chartwrap" }, legend, box),
    hint,
  );

  // ---------- indicator + drawing menus ----------
  const checks: Record<string, HTMLInputElement> = {};
  const addCheck = (key: keyof Prefs | "rsi" | "macd", label: string, get: () => boolean, set: (v: boolean) => void): void => {
    const cb = el("input", { type: "checkbox" });
    cb.checked = get();
    cb.addEventListener("change", () => {
      set(cb.checked);
      savePrefs();
      syncChecks();
      rebuild();
    });
    checks[key] = cb;
    indBox.append(el("label", { class: "chk" }, cb, ` ${label}`));
  };
  addCheck("vol", "Volume", () => prefs.vol, (v) => (prefs.vol = v));
  addCheck("ma20", "MA 20", () => prefs.ma20, (v) => (prefs.ma20 = v));
  addCheck("ma50", "MA 50", () => prefs.ma50, (v) => (prefs.ma50 = v));
  addCheck("ma200", "MA 200", () => prefs.ma200, (v) => (prefs.ma200 = v));
  addCheck("boll", "Bollinger Bands (20, 2)", () => prefs.boll, (v) => (prefs.boll = v));
  addCheck("rsi", "RSI (14) pane", () => prefs.pane === "rsi", (v) => (prefs.pane = v ? "rsi" : prefs.pane === "rsi" ? "none" : prefs.pane));
  addCheck("macd", "MACD (12, 26, 9) pane", () => prefs.pane === "macd", (v) => (prefs.pane = v ? "macd" : prefs.pane === "macd" ? "none" : prefs.pane));
  function syncChecks(): void {
    checks.rsi.checked = prefs.pane === "rsi";
    checks.macd.checked = prefs.pane === "macd";
  }
  indBox.append(el("div", { class: "muted small" }, "Long averages need enough candles in the range."));

  const setMode = (m: Mode): void => {
    mode = m;
    pending = null;
    drawMenu.open = false;
    root.classList.toggle("drawing", m !== "none");
    hint.textContent =
      m === "h" ? "Click the chart where the horizontal line should go (Esc to cancel)."
      : m === "t" ? "Click the first point of the trend line (Esc to cancel)."
      : m === "f" ? "Click the first point (swing low or high) of the Fibonacci retracement (Esc to cancel)."
      : m === "alert" ? "Click the price level for the alert (Esc to cancel)."
      : "";
  };
  const menuBtn = (label: string, fn: () => void): HTMLButtonElement => el("button", { class: "menu-item", onclick: fn }, label);
  drawBox.append(
    menuBtn("Horizontal line (support / resistance)", () => setMode("h")),
    menuBtn("Trend line (2 points)", () => setMode("t")),
    menuBtn("Fibonacci retracement (2 points)", () => setMode("f")),
    menuBtn("Price alert: click a level", () => setMode("alert")),
    menuBtn("Price alert: type a price", () => {
      drawMenu.open = false;
      openAlertDialog(uid, symbol, livePrice, livePrice);
    }),
    menuBtn("Undo last drawing", () => {
      const d = loadDrawings(symbol);
      d.pop();
      saveDrawings(symbol, d);
      drawMenu.open = false;
      renderDrawings();
    }),
    menuBtn("Delete all drawings", () => {
      drawMenu.open = false;
      modal("Delete all drawings?", el("p", {}, `Remove every line drawn on ${displaySymbol(symbol)}.`), [
        { label: "Cancel" },
        {
          label: "Delete",
          primary: true,
          onClick: () => {
            saveDrawings(symbol, []);
            renderDrawings();
          },
        },
      ]);
    }),
  );
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && mode !== "none") setMode("none");
  };
  document.addEventListener("keydown", onKey);

  // ---------- controls ----------
  const refreshControls = (): void => {
    symInput.value = displaySymbol(symbol);
    candleSel.value = String(prefs.candle);
    typeSel.value = prefs.type;
    for (const b of rangeBtns) b.classList.toggle("active", b.dataset.r === prefs.range);
  };
  const go = (): void => {
    const s = normalizeSymbol(symInput.value);
    if (!s) return;
    symbol = s;
    history.replaceState(null, "", `#/chart/${encodeURIComponent(s)}`);
    localStorage.setItem("mm_last_symbol", s);
    setMode("none");
    void load();
  };
  goBtn.addEventListener("click", go);
  symInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
  let sugTimer = 0;
  symInput.addEventListener("input", () => {
    clearTimeout(sugTimer);
    sugTimer = window.setTimeout(async () => {
      try {
        const res = await searchSymbols(symInput.value);
        suggest.replaceChildren(...res.map((r) => el("option", { value: r.symbol }, r.name)));
      } catch {
        /* suggestions are optional */
      }
    }, 250);
  });
  for (const b of rangeBtns) {
    b.addEventListener("click", () => {
      prefs.range = b.dataset.r as Range;
      savePrefs();
      refreshControls();
      void load();
    });
  }
  candleSel.addEventListener("change", () => {
    prefs.candle = Number(candleSel.value);
    savePrefs();
    if (prefs.candle !== 0 && effectiveRange(prefs.range, prefs.candle) !== prefs.range) {
      toast(`Intraday data is limited to ${effectiveRange(prefs.range, prefs.candle)} of history`);
    }
    void load();
  });
  typeSel.addEventListener("change", () => {
    prefs.type = typeSel.value as Prefs["type"];
    savePrefs();
    rebuild();
  });

  // ---------- data ----------
  async function load(): Promise<void> {
    const mine = ++token;
    refreshControls();
    hint.textContent = mode === "none" ? "Loading..." : hint.textContent;
    try {
      const res = await fetchCandles(symbol, prefs.candle, prefs.range);
      if (mine !== token) return;
      candles = res.candles;
      livePrice = res.price;
      if (mode === "none") hint.textContent = "";
      rebuild();
    } catch (e) {
      if (mine !== token) return;
      hint.textContent = e instanceof Error ? e.message : "Could not load data";
    }
  }

  // ---------- rendering ----------
  const cssVar = (n: string, fb: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb;

  function precisionFor(p: number): { precision: number; minMove: number } {
    if (isForex(symbol)) return { precision: 4, minMove: 0.0001 };
    if (p < 0.1) return { precision: 6, minMove: 0.000001 };
    if (p < 1) return { precision: 5, minMove: 0.00001 };
    if (p < 10) return { precision: 4, minMove: 0.0001 };
    return { precision: 2, minMove: 0.01 };
  }

  function lineData(values: number[]): { time: UTCTimestamp; value: number }[] {
    const out: { time: UTCTimestamp; value: number }[] = [];
    values.forEach((v, i) => {
      if (Number.isFinite(v)) out.push({ time: candles[i].time as UTCTimestamp, value: v });
    });
    return out;
  }

  function rebuild(): void {
    chart?.remove();
    chart = null;
    priceSeries = null;
    drawLines = [];
    drawSeries = [];
    legend.textContent = "";
    if (candles.length === 0) return;
    const intraday = prefs.candle > 0;
    const ch = createChart(box, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: cssVar("--card", "#0f1730") },
        textColor: cssVar("--muted", "#9fb0d0"),
        panes: { separatorColor: "#26324f" },
      },
      grid: { vertLines: { color: "#18223f" }, horzLines: { color: "#18223f" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#26324f" },
      timeScale: { borderColor: "#26324f", timeVisible: intraday, secondsVisible: false },
    });
    chart = ch;
    const last = candles[candles.length - 1];
    const pf = { type: "price" as const, ...precisionFor(last.close) };

    if (prefs.type === "candles") {
      const s = ch.addSeries(CandlestickSeries, {
        upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false, priceFormat: pf,
      });
      s.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
      priceSeries = s;
    } else {
      const s = ch.addSeries(AreaSeries, {
        lineColor: "#22d3ee", topColor: "rgba(34,211,238,0.35)", bottomColor: "rgba(34,211,238,0.02)", lineWidth: 2, priceFormat: pf,
      });
      s.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
      priceSeries = s;
    }

    const closes = candles.map((c) => c.close);
    const overlay = (values: number[], color: string, width: 1 | 2 = 1, dashed = false): void => {
      const d = lineData(values);
      if (d.length === 0) return;
      const s = ch.addSeries(LineSeries, {
        color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
      });
      s.setData(d);
    };
    if (prefs.ma20) overlay(ind.sma(closes, 20), "#4fc3f7");
    if (prefs.ma50) overlay(ind.sma(closes, 50), "#ba68c8");
    if (prefs.ma200) overlay(ind.sma(closes, 200), "#f06292");
    if (prefs.boll) {
      const [mid, up, low] = ind.bollinger(closes, 20, 2);
      overlay(up, "#90a4ae");
      overlay(low, "#90a4ae");
      overlay(mid, "#90a4ae88", 1, true);
    }

    if (prefs.vol && candles.some((c) => c.volume > 0)) {
      const v = ch.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", priceLineVisible: false, lastValueVisible: false });
      ch.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      v.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "#22c55e66" : "#ef444466" })));
    }

    if (prefs.pane === "rsi") {
      const r = ch.addSeries(LineSeries, { color: "#ab47bc", lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: "RSI 14" }, 1);
      r.setData(lineData(ind.rsi(closes, 14)));
      for (const lvl of [30, 70]) {
        r.createPriceLine({ price: lvl, color: "#ffffff55", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
      }
    } else if (prefs.pane === "macd") {
      const [m, sg, hist] = ind.macd(closes, 12, 26, 9);
      const hs = ch.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 1);
      hs.setData(
        hist.map((v, i) => ({ time: candles[i].time as UTCTimestamp, value: v, color: v >= 0 ? "#22c55eaa" : "#ef4444aa" })).filter((x) => Number.isFinite(x.value)),
      );
      const ml = ch.addSeries(LineSeries, { color: "#29b6f6", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: "MACD" }, 1);
      ml.setData(lineData(m));
      const sl = ch.addSeries(LineSeries, { color: "#ffa726", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: "Signal" }, 1);
      sl.setData(lineData(sg));
    }
    if (prefs.pane !== "none") ch.panes()[1]?.setHeight(150);

    ch.timeScale().fitContent();
    // autoSize measures the box after creation, so fit again once the real width is known
    requestAnimationFrame(() => {
      if (chart === ch) ch.timeScale().fitContent();
    });
    setTimeout(() => {
      if (chart === ch) ch.timeScale().fitContent();
    }, 120);
    ch.subscribeClick(onChartClick);
    ch.subscribeCrosshairMove(onCrosshair);
    renderDrawings();
    renderHeader();
  }

  function renderHeader(): void {
    const first = candles[0];
    const lastC = candles[candles.length - 1];
    const price = livePrice || lastC.close;
    const pct = first.open ? ((price - first.open) / first.open) * 100 : 0;
    headSym.textContent = displaySymbol(symbol);
    headPrice.textContent = fmtPrice(price);
    headChg.textContent = fmtPct(pct);
    headChg.className = `h-chg ${pct >= 0 ? "up" : "down"}`;
  }

  function onCrosshair(param: MouseEventParams): void {
    if (!priceSeries || !param.time) {
      legend.textContent = "";
      return;
    }
    const d = param.seriesData.get(priceSeries) as { open?: number; high?: number; low?: number; close?: number; value?: number } | undefined;
    if (!d) return;
    if (d.open !== undefined) {
      legend.textContent = `O ${fmtPrice(d.open)}   H ${fmtPrice(d.high ?? NaN)}   L ${fmtPrice(d.low ?? NaN)}   C ${fmtPrice(d.close ?? NaN)}`;
    } else if (d.value !== undefined) {
      legend.textContent = `Price ${fmtPrice(d.value)}`;
    }
  }

  // ---------- drawings ----------
  function clearDrawings(): void {
    if (priceSeries) for (const l of drawLines) priceSeries.removePriceLine(l);
    if (chart) for (const s of drawSeries) chart.removeSeries(s);
    drawLines = [];
    drawSeries = [];
  }

  function renderDrawings(): void {
    clearDrawings();
    if (!chart || !priceSeries || candles.length === 0) return;
    const firstT = candles[0].time;
    const lastT = candles[candles.length - 1].time;
    const fibs = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    for (const d of loadDrawings(symbol)) {
      if (d.type === "h") {
        drawLines.push(priceSeries.createPriceLine({ price: d.p1, color: GOLD, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "" }));
      } else if (d.type === "f") {
        const hi = Math.max(d.p1, d.p2);
        const lo = Math.min(d.p1, d.p2);
        for (const r of fibs) {
          drawLines.push(
            priceSeries.createPriceLine({
              price: hi - (hi - lo) * r, color: "#ffa726", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `${(r * 100).toFixed(1)}%`,
            }),
          );
        }
      } else if (d.type === "t") {
        let [t1, p1, t2, p2] = [d.t1, d.p1, d.t2, d.p2];
        if (t1 > t2) [t1, p1, t2, p2] = [t2, p2, t1, p1];
        if (t1 === t2 || t1 < firstT) continue;
        const pts = [{ time: t1 as UTCTimestamp, value: p1 }, { time: t2 as UTCTimestamp, value: p2 }];
        if (lastT > t2) {
          const slope = (p2 - p1) / (t2 - t1);
          pts.push({ time: lastT as UTCTimestamp, value: p2 + slope * (lastT - t2) });
        }
        const s = chart.addSeries(LineSeries, { color: GOLD, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        s.setData(pts);
        drawSeries.push(s);
      }
    }
  }

  function onChartClick(param: MouseEventParams): void {
    if (mode === "none" || !priceSeries || !param.point || param.time === undefined) return;
    const price = priceSeries.coordinateToPrice(param.point.y);
    if (price === null) return;
    const t = param.time as number;
    if (mode === "alert") {
      setMode("none");
      openAlertDialog(uid, symbol, price, livePrice);
      return;
    }
    if (mode === "h") {
      const d = loadDrawings(symbol);
      d.push({ type: "h", t1: t, p1: price, t2: t, p2: price });
      saveDrawings(symbol, d);
      setMode("none");
      renderDrawings();
      return;
    }
    if (!pending) {
      pending = { t, p: price };
      hint.textContent = "Now click the second point (Esc to cancel).";
      return;
    }
    const d = loadDrawings(symbol);
    d.push({ type: mode, t1: pending.t, p1: pending.p, t2: t, p2: price });
    saveDrawings(symbol, d);
    setMode("none");
    renderDrawings();
    toast("Drawing saved for " + displaySymbol(symbol));
  }

  refreshControls();
  syncChecks();
  void load();

  return () => {
    token++;
    document.removeEventListener("keydown", onKey);
    chart?.remove();
    chart = null;
  };
}
