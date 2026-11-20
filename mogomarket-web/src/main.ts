import "./style.css";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { renderAuth } from "./auth";
import { mountChart } from "./chart";
import { auth } from "./firebase";
import { el } from "./ui";
import { mountWatchlist } from "./watchlist";

const app = document.getElementById("app") as HTMLElement;
let cleanup: (() => void) | null = null;
let user: User | null = null;

function route(): { view: "chart" | "watchlist"; symbol: string } {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  if (parts[0] === "watchlist") return { view: "watchlist", symbol: "" };
  return { view: "chart", symbol: decodeURIComponent(parts[1] ?? "") || localStorage.getItem("mm_last_symbol") || "SPY" };
}

function render(): void {
  cleanup?.();
  cleanup = null;
  if (!user) {
    renderAuth(app);
    return;
  }
  const { view, symbol } = route();
  const content = el("main", { class: "content" });
  const nav = el(
    "header",
    { class: "nav" },
    el("div", { class: "brand" }, "MogoMarket"),
    el("a", { href: `#/chart/${encodeURIComponent(symbol || "SPY")}`, class: view === "chart" ? "tab active" : "tab" }, "Chart"),
    el("a", { href: "#/watchlist", class: view === "watchlist" ? "tab active" : "tab" }, "Watchlist"),
    el("div", { class: "spacer" }),
    el("span", { class: "who" }, user.email ?? "Signed in"),
    el("button", { class: "btn", onclick: () => void signOut(auth) }, "Sign out"),
  );
  app.replaceChildren(nav, content);
  if (view === "watchlist") {
    cleanup = mountWatchlist(content, user.uid, (s) => {
      location.hash = `#/chart/${encodeURIComponent(s)}`;
    });
  } else {
    localStorage.setItem("mm_last_symbol", symbol);
    cleanup = mountChart(content, user.uid, symbol);
  }
}

onAuthStateChanged(auth, (u) => {
  user = u;
  render();
});
window.addEventListener("hashchange", () => {
  if (user) render();
});
