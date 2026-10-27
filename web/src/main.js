import { configured, watchAuth, logOut, signInWithGoogle, signInWithFakeGoogle, usingEmulators } from "./lib/firebase.js";
import { clear, toast, friendlyError } from "./ui/dom.js";
import { classesView } from "./views/classes.js";
import { classView } from "./views/class.js";

// The page shell lives in index.html. Exactly one of splash / hero / main is visible at a time, via the "none" class.
const $ = (id) => document.getElementById(id);
const el = {
  splash: $("splash"), hero: $("hero"), view: $("view"),
  navUser: $("navUser"), greeting: $("greeting"),
  signIn: $("signInBtn"), signOut: $("signOutBtn"), setup: $("setupNote"),
  dev: $("devSignIn"), devEmail: $("devEmail"), devBtn: $("devBtn")
};
const show = (node, on) => node.classList.toggle("none", !on);

let user = null;
let authReady = false;

const routes = [
  { re: /^#\/class\/([^/]+)(?:\/([a-z]+))?$/, view: classView },
  { re: /^#\/?$/, view: classesView }
];

// First word of the display name, without stray punctuation ("Abril," -> "Abril"); falls back to the email name.
const firstName = (u) => {
  const word = (u.displayName || "").trim().split(/\s+/)[0] || "";
  const clean = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  return clean || (u.email || "").split("@")[0] || "there";
};

function render() {
  const signedIn = authReady && !!user;

  show(el.splash, configured && !authReady);                 // waiting for Firebase to say who is signed in
  show(el.hero, !signedIn && (authReady || !configured));    // signed out (or not configured): show the landing card
  show(el.navUser, signedIn);
  show(el.view, signedIn);

  show(el.setup, !configured);
  show(el.signIn, configured);
  show(el.dev, configured && usingEmulators);

  if (!signedIn) return void clear(el.view);

  el.greeting.textContent = `Hello, ${firstName(user)}!`;
  clear(el.view);
  const hash = location.hash || "#/";
  for (const r of routes) {
    const m = r.re.exec(hash);
    if (m) return void r.view(el.view, { user, params: m.slice(1) });
  }
  const back = document.createElement("a");
  back.href = "#/"; back.textContent = "Back to your classes";
  el.view.append("Page not found. ", back);
}

async function guarded(button, fn) {
  button.disabled = true;
  try { await fn(); }
  catch (e) {
    if (e?.code !== "auth/popup-closed-by-user" && e?.code !== "auth/cancelled-popup-request") toast(friendlyError(e), true);
  } finally { button.disabled = false; }
}

el.signIn.addEventListener("click", () => guarded(el.signIn, () => signInWithGoogle()));
el.devBtn.addEventListener("click", () => guarded(el.devBtn, () => signInWithFakeGoogle(el.devEmail.value.trim())));
el.signOut.addEventListener("click", () => guarded(el.signOut, async () => { await logOut(); location.hash = "#/"; }));

if (configured) watchAuth((u) => { user = u; authReady = true; render(); });
window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
render();


// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.