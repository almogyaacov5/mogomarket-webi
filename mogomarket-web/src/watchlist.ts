import { onValue, ref, remove, update } from "firebase/database";
import { openAlertDialog } from "./alerts";
import { fetchQuote, type Quote } from "./api";
import { db } from "./firebase";
import { displaySymbol, firebaseKey, normalizeSymbol } from "./symbols";
import { el, fmtPct, fmtPrice, modal, toast } from "./ui";

interface Item {
  symbol: string;
  alertEnabled?: boolean;
  alertTriggered?: boolean;
  alertTargetPrice?: number;
  alertDirection?: string;
}

export function mountWatchlist(root: HTMLElement, uid: string, openChart: (symbol: string) => void): () => void {
  const base = `users/${uid}/watchlist-stocks`;
  let items: Item[] = [];
  const quotes = new Map<string, Quote>();
  let timer = 0;
  let alive = true;

  const input = el("input", { class: "input", placeholder: "Add a symbol (AAPL, BTC, EURUSD...)" });
  const addBtn = el("button", { class: "btn primary" }, "Add");
  const tbody = el("tbody");
  const empty = el("p", { class: "muted" }, "Your watchlist is empty. Add a symbol above.");

  const add = async (): Promise<void> => {
    const s = normalizeSymbol(input.value);
    if (!s) return;
    await update(ref(db, `${base}/${firebaseKey(s)}`), { symbol: s });
    input.value = "";
  };
  addBtn.addEventListener("click", () => void add());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void add();
  });

  root.replaceChildren(
    el("div", { class: "toolbar" }, input, addBtn),
    el("table", { class: "table" }, el("thead", {}, el("tr", {}, el("th", {}, "Symbol"), el("th", { class: "num" }, "Price"), el("th", { class: "num" }, "Day"), el("th", {}, "Alert"), el("th", {}))), tbody),
    empty,
  );

  function render(): void {
    empty.style.display = items.length === 0 ? "" : "none";
    tbody.replaceChildren(
      ...items.map((it) => {
        const q = quotes.get(it.symbol);
        const alertText = it.alertEnabled && it.alertTargetPrice
          ? `${it.alertDirection === "BELOW" ? "↓" : "↑"} ${fmtPrice(it.alertTargetPrice)}`
          : it.alertTriggered ? "triggered" : "-";
        const price = q?.price ?? NaN;
        return el(
          "tr",
          {},
          el("td", {}, el("button", { class: "link", onclick: () => openChart(it.symbol) }, displaySymbol(it.symbol))),
          el("td", { class: "num" }, q ? fmtPrice(price) : "..."),
          el("td", { class: `num ${q ? (q.changePct >= 0 ? "up" : "down") : ""}` }, q ? fmtPct(q.changePct) : ""),
          el("td", {}, el("button", { class: "link", title: "Edit alert", onclick: () => openAlertDialog(uid, it.symbol, it.alertTargetPrice ?? price, price) }, "🔔 " + alertText)),
          el(
            "td",
            { class: "num" },
            el("button", {
              class: "link danger",
              title: "Remove",
              onclick: () =>
                modal("Remove from watchlist?", el("p", {}, displaySymbol(it.symbol)), [
                  { label: "Cancel" },
                  {
                    label: "Remove",
                    primary: true,
                    onClick: async () => {
                      await remove(ref(db, `${base}/${firebaseKey(it.symbol)}`));
                      toast("Removed");
                    },
                  },
                ]),
            }, "✕"),
          ),
        );
      }),
    );
  }

  async function refreshQuotes(): Promise<void> {
    await Promise.all(
      items.map(async (it) => {
        try {
          quotes.set(it.symbol, await fetchQuote(it.symbol));
        } catch {
          /* keep the previous quote */
        }
      }),
    );
    if (alive) render();
  }

  const unsub = onValue(ref(db, base), (snap) => {
    const val = snap.val() as Record<string, Item> | null;
    items = val ? Object.values(val).filter((x) => x && x.symbol).sort((a, b) => a.symbol.localeCompare(b.symbol)) : [];
    render();
    void refreshQuotes();
  }, (err) => toast(`Could not load watchlist: ${err.message}`));
  timer = window.setInterval(() => void refreshQuotes(), 20000);

  return () => {
    alive = false;
    unsub();
    clearInterval(timer);
  };
}
