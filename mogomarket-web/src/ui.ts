type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

/** Tiny DOM helper: el("button", { class: "btn", onclick: fn }, "Label", child...) */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2), v as EventListener);
    } else if (k === "class") {
      node.className = String(v);
    } else if (v === true) {
      node.setAttribute(k, "");
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export function toast(message: string, ms = 3200): void {
  const t = el("div", { class: "toast" }, message);
  document.body.append(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, ms);
}

export interface ModalButton {
  label: string;
  primary?: boolean;
  /** Return false to keep the dialog open. */
  onClick?: () => boolean | void | Promise<boolean | void>;
}

export function modal(title: string, body: Node, buttons: ModalButton[]): () => void {
  const overlay = el("div", { class: "overlay" });
  const close = (): void => overlay.remove();
  const row = el("div", { class: "modal-actions" });
  for (const b of buttons) {
    row.append(
      el(
        "button",
        {
          class: b.primary ? "btn primary" : "btn",
          onclick: async () => {
            const keep = b.onClick ? await b.onClick() : undefined;
            if (keep !== false) close();
          },
        },
        b.label,
      ),
    );
  }
  overlay.append(el("div", { class: "modal" }, el("h3", {}, title), body, row));
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  document.body.append(overlay);
  return close;
}

export const fmtPrice = (p: number): string => {
  if (!Number.isFinite(p)) return "--";
  const abs = Math.abs(p);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 3 : abs >= 0.1 ? 4 : 6;
  return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits });
};

export const fmtPct = (p: number): string => (Number.isFinite(p) ? `${p >= 0 ? "+" : ""}${p.toFixed(2)}%` : "--");
