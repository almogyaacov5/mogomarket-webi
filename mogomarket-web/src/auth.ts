import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { auth } from "./firebase";
import { el, toast } from "./ui";

function friendly(e: unknown): string {
  const code = (e as { code?: string }).code ?? "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "Wrong email or password.";
  if (code.includes("email-already-in-use")) return "This email is already registered. Try signing in.";
  if (code.includes("weak-password")) return "Password must be at least 6 characters.";
  if (code.includes("invalid-email")) return "That email address does not look right.";
  if (code.includes("popup-closed")) return "Sign-in window was closed.";
  if (code.includes("unauthorized-domain")) return "This site's domain is not authorized in Firebase Auth settings yet.";
  if (code.includes("api-key") || code.includes("requests-from-referer")) return "Firebase rejected the API key for the web. See the README (Firebase web config).";
  return e instanceof Error ? e.message : "Something went wrong.";
}

export function renderAuth(root: HTMLElement): void {
  const email = el("input", { class: "input", type: "email", placeholder: "Email", autocomplete: "email" });
  const pass = el("input", { class: "input", type: "password", placeholder: "Password", autocomplete: "current-password" });
  const err = el("div", { class: "error" });

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    err.textContent = "";
    try {
      await fn();
    } catch (e) {
      err.textContent = friendly(e);
    }
  };

  root.replaceChildren(
    el(
      "div",
      { class: "auth" },
      el("h1", {}, "MogoMarket"),
      el("p", { class: "muted" }, "Sign in with the same account you use in the app."),
      email,
      pass,
      err,
      el("button", { class: "btn primary wide", onclick: () => void run(() => signInWithEmailAndPassword(auth, email.value.trim(), pass.value)) }, "Sign in"),
      el("button", { class: "btn wide", onclick: () => void run(() => signInWithPopup(auth, new GoogleAuthProvider())) }, "Continue with Google"),
      el(
        "div",
        { class: "auth-links" },
        el("button", { class: "link", onclick: () => void run(() => createUserWithEmailAndPassword(auth, email.value.trim(), pass.value)) }, "Create account"),
        el(
          "button",
          {
            class: "link",
            onclick: () =>
              void run(async () => {
                if (!email.value.trim()) throw new Error("Type your email first.");
                await sendPasswordResetEmail(auth, email.value.trim());
                toast("Password reset email sent");
              }),
          },
          "Forgot password",
        ),
      ),
    ),
  );
  pass.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void run(() => signInWithEmailAndPassword(auth, email.value.trim(), pass.value));
  });
}
