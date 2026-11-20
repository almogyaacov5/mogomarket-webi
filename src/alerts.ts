import { ref, update } from "firebase/database";
import { db } from "./firebase";
import { displaySymbol, firebaseKey } from "./symbols";
import { el, modal, toast } from "./ui";

/**
 * Price alerts live in the same place the Android app reads them
 * (users/{uid}/watchlist-stocks/{key}), so an alert set on the web also fires on the phone.
 */
export function openAlertDialog(uid: string, symbol: string, price: number, lastPrice: number, onSaved?: () => void): void {
  const input = el("input", { type: "number", step: "any", class: "input", value: price > 0 ? String(+price.toFixed(6)) : "" });
  const above = el("input", { type: "radio", name: "dir", value: "ABOVE" });
  const below = el("input", { type: "radio", name: "dir", value: "BELOW" });
  if (price > 0 && lastPrice > 0 && price < lastPrice) below.checked = true;
  else above.checked = true;
  const body = el(
    "div",
    { class: "form" },
    el("label", {}, "Target price", input),
    el("label", { class: "radio" }, above, " Alert when the price rises to or above"),
    el("label", { class: "radio" }, below, " Alert when the price falls to or below"),
  );
  const path = (): string => `users/${uid}/watchlist-stocks/${firebaseKey(symbol)}`;
  modal(`Price alert - ${displaySymbol(symbol)}`, body, [
    { label: "Cancel" },
    {
      label: "Disable alert",
      onClick: async () => {
        await update(ref(db, path()), { alertEnabled: false, alertTargetPrice: 0, alertTriggered: false });
        toast("Alert disabled");
        onSaved?.();
      },
    },
    {
      label: "Set alert",
      primary: true,
      onClick: async () => {
        const target = parseFloat(input.value);
        if (!Number.isFinite(target) || target <= 0) {
          toast("Enter a price greater than 0");
          return false;
        }
        await update(ref(db, path()), {
          symbol,
          alertTargetPrice: target,
          alertDirection: below.checked ? "BELOW" : "ABOVE",
          alertEnabled: true,
          alertTriggered: false,
        });
        toast("Alert saved (the stock is also on your watchlist)");
        onSaved?.();
      },
    },
  ]);
}
