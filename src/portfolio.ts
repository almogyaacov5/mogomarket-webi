import { onValue, push, ref, runTransaction, set } from "firebase/database";
import { fetchQuote } from "./api";
import { db } from "./firebase";
import { displaySymbol, firebaseKey, normalizeSymbol } from "./symbols";
import { combine, EXIT_REASONS, fmtDate, fmtMoney, n, openPnl, profitLoss, toRoman, type Trade } from "./trades";
import { el, fmtPrice, modal, toast } from "./ui";

type UserData = Record<string, unknown> | null;

function field(label: string, input: HTMLElement): HTMLElement {
  return el("label", {}, el("span", { class: "muted" }, label), input);
}

export function mountPortfolio(root: HTMLElement, uid: string, openChart: (symbol: string) => void): () => void {
  const userPath = `users/${uid}`;
  let positions: Record<string, Trade> = {};
  let cash = 0;
  const prices = new Map<string, number>();
  let alive = true;
  let timer = 0;

  const summary = el("div", { class: "cards" });
  const tbody = el("tbody");
  const empty = el("p", { class: "muted" }, "No open trades. Press “New trade” to add one.");
  const newBtn = el("button", { class: "btn primary", onclick: () => openBuy() }, "+ New trade");
  const cashBtn = el("button", { class: "btn", onclick: () => openCash() }, "Edit cash");

  root.replaceChildren(
    el("div", { class: "toolbar" }, newBtn, cashBtn),
    summary,
    el(
      "table",
      { class: "table" },
      el("thead", {}, el("tr", {}, ...["Symbol", "Entry", "Price", "Invested", "P/L", "Target / Stop", "Opened", ""].map((h, i) => el("th", { class: i > 0 && i < 5 ? "num" : "" }, h)))),
      tbody,
    ),
    empty,
  );

  function card(label: string, value: string, cls = ""): HTMLElement {
    return el("div", { class: "card" }, el("div", { class: "muted small" }, label), el("div", { class: `card-v ${cls}` }, value));
  }

  function render(): void {
    const list = Object.entries(positions);
    empty.style.display = list.length ? "none" : "";
    let invested = 0;
    let pnl = 0;
    let value = 0;
    for (const [, t] of list) {
      invested += n(t.tradeAmount);
      const p = prices.get(t.symbol);
      const u = p != null ? openPnl(t, p) : NaN;
      if (Number.isFinite(u)) {
        pnl += u;
        value += n(t.tradeAmount) + u + n(t.entryFees);
      } else value += n(t.tradeAmount);
    }
    summary.replaceChildren(
      card("Cash", fmtMoney(cash)),
      card("Invested", fmtMoney(invested)),
      card("Open P/L", fmtMoney(pnl), pnl >= 0 ? "up" : "down"),
      card("Total value", fmtMoney(cash + value)),
    );
    tbody.replaceChildren(
      ...list.map(([key, t]) => {
        const p = prices.get(t.symbol);
        const u = p != null ? openPnl(t, p) : NaN;
        const pct = Number.isFinite(u) && n(t.tradeAmount) > 0 ? (u / n(t.tradeAmount)) * 100 : NaN;
        return el(
          "tr",
          {},
          el("td", {}, el("button", { class: "link", onclick: () => openChart(t.symbol) }, displaySymbol(t.symbol))),
          el("td", { class: "num" }, fmtPrice(n(t.buyPrice))),
          el("td", { class: "num" }, p != null ? fmtPrice(p) : "..."),
          el("td", { class: "num" }, fmtMoney(n(t.tradeAmount))),
          el("td", { class: `num ${u >= 0 ? "up" : "down"}` }, Number.isFinite(u) ? `${fmtMoney(u)} (${pct.toFixed(2)}%)` : ""),
          el("td", {}, `${n(t.targetPrice) > 0 ? fmtPrice(n(t.targetPrice)) : "-"} / ${n(t.stopLossPrice) > 0 ? fmtPrice(n(t.stopLossPrice)) : "-"}`),
          el("td", {}, fmtDate(t.openedAt)),
          el("td", { class: "num" }, el("button", { class: "link", onclick: () => openEdit(key, t) }, "Edit"), el("button", { class: "link danger", onclick: () => openClose(key, t) }, "Close")),
        );
      }),
    );
  }

  async function refreshPrices(): Promise<void> {
    const syms = [...new Set(Object.values(positions).map((t) => t.symbol))];
    await Promise.all(
      syms.map(async (s) => {
        try {
          prices.set(s, (await fetchQuote(s)).price);
        } catch {
          /* keep the previous price */
        }
      }),
    );
    if (alive) render();
  }

  const unsub = onValue(ref(db, userPath), (snap) => {
    const v = (snap.val() ?? {}) as Record<string, unknown>;
    positions = (v["portfolio-stocks"] ?? {}) as Record<string, Trade>;
    cash = n(v["portfolio-cash"]);
    render();
    void refreshPrices();
  });
  timer = window.setInterval(() => void refreshPrices(), 30000);

  // ---- dialogs -------------------------------------------------------------
  function openCash(): void {
    const input = el("input", { class: "input", type: "number", step: "0.01", value: cash.toFixed(2) });
    modal("Cash balance", el("div", { class: "form" }, field("Available cash ($)", input)), [
      { label: "Cancel" },
      {
        label: "Save",
        primary: true,
        onClick: async () => {
          const v = parseFloat(input.value);
          if (!Number.isFinite(v) || v < 0) return toast("Enter a valid amount"), false;
          await set(ref(db, `${userPath}/portfolio-cash`), v);
        },
      },
    ]);
  }

  function tradeForm(t?: Trade) {
    const f = {
      symbol: el("input", { class: "input", placeholder: "AAPL, BTC, EURUSD", value: t ? displaySymbol(t.symbol) : "" }),
      buy: el("input", { class: "input", type: "number", step: "any", value: t ? String(n(t.buyPrice)) : "" }),
      amount: el("input", { class: "input", type: "number", step: "0.01", value: t ? String(n(t.tradeAmount)) : "" }),
      fees: el("input", { class: "input", type: "number", step: "0.01", value: String(n(t?.entryFees)) }),
      target: el("input", { class: "input", type: "number", step: "any", value: n(t?.targetPrice) > 0 ? String(t?.targetPrice) : "" }),
      stop: el("input", { class: "input", type: "number", step: "any", value: n(t?.stopLossPrice) > 0 ? String(t?.stopLossPrice) : "" }),
      strategy: el("input", { class: "input", value: t?.strategyTag ?? "" }),
      sector: el("input", { class: "input", value: t?.sector ?? "" }),
      notes: el("textarea", { class: "input", rows: 3 }, t?.notes ?? ""),
    };
    const body = el(
      "div",
      { class: "form" },
      field("Symbol", f.symbol),
      field("Entry price", f.buy),
      field("Amount invested ($)", f.amount),
      field("Entry fees ($)", f.fees),
      field("Target price (optional)", f.target),
      field("Stop loss (optional)", f.stop),
      field("Strategy", f.strategy),
      field("Sector", f.sector),
      field("Notes", f.notes),
    );
    const read = (): Trade | null => {
      const symbol = normalizeSymbol(f.symbol.value);
      const buy = parseFloat(f.buy.value);
      const amount = parseFloat(f.amount.value);
      if (!symbol || !(buy > 0) || !(amount > 0)) {
        toast("Symbol, entry price and amount are required");
        return null;
      }
      return {
        ...(t ?? {}),
        symbol,
        buyPrice: buy,
        tradeAmount: amount,
        shares: amount / buy,
        entryFees: Math.max(0, parseFloat(f.fees.value) || 0),
        targetPrice: parseFloat(f.target.value) || 0,
        stopLossPrice: parseFloat(f.stop.value) || 0,
        strategyTag: f.strategy.value.trim(),
        sector: f.sector.value.trim(),
        notes: f.notes.value.trim(),
        openedAt: t?.openedAt ?? Date.now(),
      };
    };
    return { body, read };
  }

  function openBuy(): void {
    const { body, read } = tradeForm();
    modal("New trade", body, [
      { label: "Cancel" },
      {
        label: "Add to portfolio",
        primary: true,
        onClick: async () => {
          const trade = read();
          if (!trade) return false;
          const key = firebaseKey(trade.symbol);
          const existing = positions[key];
          let merge = false;
          if (existing) {
            merge = confirm(`You already have an open trade in ${displaySymbol(trade.symbol)}.\nOK = merge into it (average entry), Cancel = replace it with the new data.`);
          }
          const res = await runTransaction(ref(db, userPath), (cur: UserData) => {
            if (cur === null) return cur;
            const pf = (cur["portfolio-stocks"] ?? {}) as Record<string, Trade>;
            const old = pf[key];
            const c = n(cur["portfolio-cash"]);
            const refund = old && !merge ? n(old.tradeAmount) + n(old.entryFees) : 0;
            const avail = c + refund;
            if (trade.tradeAmount + n(trade.entryFees) > avail + 1e-7) return undefined;
            pf[key] = old && merge ? combine(old, trade) : trade;
            cur["portfolio-stocks"] = pf;
            cur["portfolio-cash"] = Math.max(0, avail - trade.tradeAmount - n(trade.entryFees));
            return cur;
          });
          if (!res.committed) {
            toast(`Insufficient cash. Available: ${fmtMoney(cash)}`);
            return false;
          }
          toast("Added to portfolio");
        },
      },
    ]);
  }

  function openEdit(key: string, t: Trade): void {
    const { body, read } = tradeForm(t);
    modal(`Edit ${displaySymbol(t.symbol)}`, body, [
      { label: "Cancel" },
      {
        label: "Save",
        primary: true,
        onClick: async () => {
          const upd = read();
          if (!upd) return false;
          const newKey = firebaseKey(upd.symbol);
          const res = await runTransaction(ref(db, userPath), (cur: UserData) => {
            if (cur === null) return cur;
            const pf = (cur["portfolio-stocks"] ?? {}) as Record<string, Trade>;
            const prev = pf[key];
            if (!prev) return undefined;
            if (key !== newKey && pf[newKey]) return undefined;
            let avail = n(cur["portfolio-cash"]);
            const changed = Math.abs(n(prev.tradeAmount) - upd.tradeAmount) >= 0.005 || Math.abs(n(prev.entryFees) - n(upd.entryFees)) >= 0.005;
            if (!changed) {
              upd.tradeAmount = n(prev.tradeAmount);
              upd.entryFees = n(prev.entryFees);
            } else {
              avail += n(prev.tradeAmount) + n(prev.entryFees) - upd.tradeAmount - n(upd.entryFees);
              if (avail < -0.005) return undefined;
              cur["portfolio-cash"] = Math.max(0, avail);
            }
            if (key !== newKey) delete pf[key];
            pf[newKey] = upd;
            cur["portfolio-stocks"] = pf;
            return cur;
          });
          if (!res.committed) {
            toast("Update failed. Check the cash balance and the symbol.");
            return false;
          }
          toast("Trade updated");
        },
      },
    ]);
  }

  function openClose(key: string, t: Trade): void {
    const p = prices.get(t.symbol);
    const sell = el("input", { class: "input", type: "number", step: "any", value: p != null ? String(p) : "" });
    const reason = el("select", { class: "input" }, ...EXIT_REASONS.map((r) => el("option", { value: r }, r)));
    const fees = el("input", { class: "input", type: "number", step: "0.01", value: "0" });
    const taxes = el("input", { class: "input", type: "number", step: "0.01", value: "0" });
    modal(
      `Close ${displaySymbol(t.symbol)}`,
      el("div", { class: "form" }, field("Sell price", sell), field("Exit reason", reason), field("Exit fees ($)", fees), field("Taxes ($)", taxes)),
      [
        { label: "Cancel" },
        {
          label: "Close trade",
          primary: true,
          onClick: async () => {
            const sellPrice = parseFloat(sell.value);
            const exitFees = Math.max(0, parseFloat(fees.value) || 0);
            const tax = Math.max(0, parseFloat(taxes.value) || 0);
            if (!(sellPrice > 0)) return toast("Enter a valid sell price"), false;
            const closedAt = Date.now();
            const closedId = ref(db, `${userPath}/closed-trades`);
            const idKey = push(closedId).key as string;
            const evKey = push(ref(db, `${userPath}/daily-trade-events`)).key as string;
            const res = await runTransaction(ref(db, userPath), (cur: UserData) => {
              if (cur === null) return cur;
              const pf = (cur["portfolio-stocks"] ?? {}) as Record<string, Trade>;
              const open = pf[key];
              if (!open || !(n(open.buyPrice) > 0)) return undefined;
              const proceeds = (n(open.tradeAmount) > 0 ? (n(open.tradeAmount) * sellPrice) / n(open.buyPrice) : 0) - exitFees - tax;
              const closed: Trade = { ...open, sellPrice, exitReason: reason.value, closedAt, exitFees, taxes: tax, closedTradeId: idKey };
              const ct = (cur["closed-trades"] ?? {}) as Record<string, Trade>;
              const count = Object.values(ct).filter((x) => x.symbol?.toLowerCase() === closed.symbol.toLowerCase()).length;
              closed.tradeNumber = toRoman(count + 1);
              ct[idKey] = closed;
              cur["closed-trades"] = ct;
              const ev = (cur["daily-trade-events"] ?? {}) as Record<string, unknown>;
              ev[evKey] = { closedTradeId: idKey, symbol: closed.symbol, buyPrice: closed.buyPrice, sellPrice, tradeAmount: closed.tradeAmount, profitLoss: profitLoss(closed), closedAt };
              cur["daily-trade-events"] = ev;
              cur["portfolio-cash"] = n(cur["portfolio-cash"]) + proceeds;
              delete pf[key];
              cur["portfolio-stocks"] = pf;
              return cur;
            });
            if (!res.committed) return toast("Open trade was not found"), false;
            toast("Trade closed and saved to the journal");
          },
        },
      ],
    );
  }

  return () => {
    alive = false;
    clearInterval(timer);
    unsub();
  };
}
