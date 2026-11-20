import { onValue, ref, runTransaction } from "firebase/database";
import { db } from "./firebase";
import { displaySymbol } from "./symbols";
import { fmtDate, fmtMoney, MOODS, n, profitLoss, profitLossPct, type Trade } from "./trades";
import { el, modal, toast } from "./ui";

type Sort = "date" | "pl";

function csvEscape(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

export function tradesToCsv(trades: Trade[]): string {
  const head = ["id", "symbol", "buy_price", "sell_price", "amount", "entry_fees", "exit_fees", "taxes", "exit_reason", "strategy", "notes", "opened_at", "closed_at", "missed_pnl", "sector", "mood"];
  const rows = trades.map((t) =>
    [t.closedTradeId, t.symbol, t.buyPrice, t.sellPrice, t.tradeAmount, t.entryFees, t.exitFees, t.taxes, t.exitReason, t.strategyTag, t.notes, t.openedAt, t.closedAt, t.missedProfitLoss, t.sector, t.moodTag]
      .map(csvEscape)
      .join(","),
  );
  return [head.map(csvEscape).join(","), ...rows].join("\n") + "\n";
}

interface Group {
  trades: number;
  wins: number;
  pl: number;
}

function groupBy(trades: Trade[], keyFn: (t: Trade) => string): Map<string, Group> {
  const m = new Map<string, Group>();
  for (const t of trades) {
    const k = keyFn(t) || "(none)";
    const g = m.get(k) ?? { trades: 0, wins: 0, pl: 0 };
    const p = profitLoss(t);
    g.trades++;
    g.pl += p;
    if (p > 0) g.wins++;
    m.set(k, g);
  }
  return m;
}

export function mountJournal(root: HTMLElement, uid: string, openChart: (symbol: string) => void): () => void {
  let trades: Trade[] = [];
  let sort: Sort = "date";
  let filter = "";

  const stats = el("div", { class: "cards" });
  const tbody = el("tbody");
  const empty = el("p", { class: "muted" }, "No closed trades yet. Close a trade from the Portfolio tab and it appears here.");
  const search = el("input", { class: "input", placeholder: "Filter by symbol, strategy, mood..." });
  const sortSel = el("select", { class: "input" }, el("option", { value: "date" }, "Newest first"), el("option", { value: "pl" }, "Best P/L first"));
  const insightsBtn = el("button", { class: "btn", onclick: () => showInsights() }, "Insights");
  const csvBtn = el("button", { class: "btn", onclick: () => exportCsv() }, "Export CSV");
  search.addEventListener("input", () => {
    filter = search.value.trim().toLowerCase();
    render();
  });
  sortSel.addEventListener("change", () => {
    sort = sortSel.value as Sort;
    render();
  });

  root.replaceChildren(
    el("div", { class: "toolbar" }, search, sortSel, insightsBtn, csvBtn),
    stats,
    el("table", { class: "table" }, el("thead", {}, el("tr", {}, ...["Symbol", "Entry", "Exit", "Amount", "P/L", "Closed", "Tags", ""].map((h, i) => el("th", { class: i > 0 && i < 5 ? "num" : "" }, h)))), tbody),
    empty,
  );

  const visible = (): Trade[] => {
    let list = trades.filter((t) => !filter || [t.symbol, t.strategyTag, t.moodTag, t.sector, t.exitReason, t.notes].some((s) => String(s ?? "").toLowerCase().includes(filter)));
    list = [...list].sort((a, b) => (sort === "pl" ? profitLoss(b) - profitLoss(a) : n(b.closedAt) - n(a.closedAt)));
    return list;
  };

  function card(label: string, value: string, cls = ""): HTMLElement {
    return el("div", { class: "card" }, el("div", { class: "muted small" }, label), el("div", { class: `card-v ${cls}` }, value));
  }

  function render(): void {
    const list = visible();
    empty.style.display = trades.length ? "none" : "";
    const total = list.reduce((s, t) => s + profitLoss(t), 0);
    const wins = list.filter((t) => profitLoss(t) > 0);
    const losses = list.filter((t) => profitLoss(t) < 0);
    const gw = wins.reduce((s, t) => s + profitLoss(t), 0);
    const gl = -losses.reduce((s, t) => s + profitLoss(t), 0);
    stats.replaceChildren(
      card("Trades", String(list.length)),
      card("Net P/L", fmtMoney(total), total >= 0 ? "up" : "down"),
      card("Win rate", list.length ? `${((wins.length / list.length) * 100).toFixed(0)}%` : "-"),
      card("Profit factor", gl > 0 ? (gw / gl).toFixed(2) : gw > 0 ? "∞" : "-"),
      card("Avg win", wins.length ? fmtMoney(gw / wins.length) : "-", "up"),
      card("Avg loss", losses.length ? fmtMoney(-gl / losses.length) : "-", "down"),
    );
    tbody.replaceChildren(
      ...list.map((t) => {
        const p = profitLoss(t);
        const tags = [t.strategyTag, t.moodTag && t.moodTag !== "None" ? t.moodTag : "", t.exitReason].filter(Boolean).join(" · ");
        return el(
          "tr",
          {},
          el("td", {}, el("button", { class: "link", onclick: () => openChart(t.symbol) }, displaySymbol(t.symbol) + (t.tradeNumber ? ` ${t.tradeNumber}` : ""))),
          el("td", { class: "num" }, n(t.buyPrice).toFixed(2)),
          el("td", { class: "num" }, n(t.sellPrice).toFixed(2)),
          el("td", { class: "num" }, fmtMoney(n(t.tradeAmount))),
          el("td", { class: `num ${p >= 0 ? "up" : "down"}` }, `${fmtMoney(p)} (${profitLossPct(t).toFixed(2)}%)`),
          el("td", {}, fmtDate(t.closedAt)),
          el("td", { class: "muted" }, tags),
          el("td", { class: "num" }, el("button", { class: "link", onclick: () => openEdit(t) }, "Notes")),
        );
      }),
    );
  }

  const unsub = onValue(ref(db, `users/${uid}/closed-trades`), (snap) => {
    const v = (snap.val() ?? {}) as Record<string, Trade>;
    trades = Object.entries(v).map(([id, t]) => ({ ...t, closedTradeId: t.closedTradeId ?? id }));
    render();
  });

  function exportCsv(): void {
    if (!trades.length) return toast("Nothing to export");
    const blob = new Blob([tradesToCsv(visible())], { type: "text/csv;charset=utf-8" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `mogomarket-trades-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
  }

  function openEdit(t: Trade): void {
    const mood = el("select", { class: "input" }, ...MOODS.map((m) => el("option", { value: m, selected: m === (t.moodTag || "None") }, m)));
    const strat = el("input", { class: "input", value: t.strategyTag ?? "" });
    const notes = el("textarea", { class: "input", rows: 4 }, t.notes ?? "");
    const lab = (l: string, i: HTMLElement): HTMLElement => el("label", {}, el("span", { class: "muted" }, l), i);
    modal(`${displaySymbol(t.symbol)} journal`, el("div", { class: "form" }, lab("Mood", mood), lab("Strategy", strat), lab("Notes", notes)), [
      { label: "Cancel" },
      {
        label: "Save",
        primary: true,
        onClick: async () => {
          const id = t.closedTradeId as string;
          await runTransaction(ref(db, `users/${uid}/closed-trades/${id}`), (cur: Trade | null) => {
            if (!cur) return undefined;
            return { ...cur, moodTag: mood.value, strategyTag: strat.value.trim(), notes: notes.value.trim() };
          });
          toast("Saved");
        },
      },
    ]);
  }

  function showInsights(): void {
    if (!trades.length) return void toast("No closed trades yet");
    const sections: [string, (t: Trade) => string][] = [
      ["By mood", (t) => t.moodTag || "None"],
      ["By strategy", (t) => t.strategyTag ?? ""],
      ["By sector", (t) => t.sector ?? ""],
      ["By exit reason", (t) => t.exitReason ?? ""],
    ];
    const body = el("div", { class: "insights" });
    for (const [title, fn] of sections) {
      const rows = [...groupBy(trades, fn)].sort((a, b) => b[1].pl - a[1].pl);
      body.append(
        el("h4", {}, title),
        el(
          "table",
          { class: "table" },
          el("thead", {}, el("tr", {}, el("th", {}, "Group"), el("th", { class: "num" }, "Trades"), el("th", { class: "num" }, "Win rate"), el("th", { class: "num" }, "P/L"))),
          el(
            "tbody",
            {},
            ...rows.map(([k, g]) =>
              el("tr", {}, el("td", {}, k), el("td", { class: "num" }, String(g.trades)), el("td", { class: "num" }, `${((g.wins / g.trades) * 100).toFixed(0)}%`), el("td", { class: `num ${g.pl >= 0 ? "up" : "down"}` }, fmtMoney(g.pl))),
            ),
          ),
        ),
      );
    }
    modal("Journal insights", body, [{ label: "Close", primary: true }]);
  }

  return () => unsub();
}
