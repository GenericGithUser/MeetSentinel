import { h, toast, friendlyError } from "../ui/dom.js";
import { signInWithGoogle } from "../lib/firebase.js";

export function signInView() {
  const btn = h("button", {}, "Sign in with Google");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try { await signInWithGoogle(); }
    catch (e) { if (e?.code !== "auth/popup-closed-by-user") toast(friendlyError(e), true); }
    finally { btn.disabled = false; }
  });
  return h("main", { class: "narrow" },
    h("h1", {}, "MeetSentinel"),
    h("p", { class: "muted" }, "Class attendance from Google Meet focus. Sign in with your Google account to manage your classes."),
    h("div", { class: "row" }, btn),
    h("p", { class: "hint" }, "Students don't sign in here. They join from the MeetSentinel browser extension using the class code you give them.")
  );
}

export function setupView() {
  return h("main", { class: "narrow" },
    h("h1", {}, "MeetSentinel"),
    h("p", { class: "banner" }, "Firebase isn't configured. Copy web/.env.example to web/.env, fill in your project's web config, and restart the dev server.")
  );
}
