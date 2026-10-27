// Tiny DOM helper. Children that are strings become TEXT nodes, so student-supplied names and emails
// can never be interpreted as HTML. Never use innerHTML with data from Firestore.
// Like Element.append, but skips null / undefined / false. The browser's own append() turns null into the TEXT "null".
export function add(parent, ...children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    parent.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return parent;
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  let deferredValue;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "value") deferredValue = v; // selects need their options first
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== "list") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  add(el, ...children);
  if (deferredValue !== undefined) el.value = deferredValue;
  return el;
}

export const clear = (node) => { node.replaceChildren(); return node; };

export function toast(message, isError = false) {
  const t = h("div", { class: "toast" + (isError ? " error" : ""), role: isError ? "alert" : "status" }, message);
  document.body.append(t);
  setTimeout(() => t.remove(), isError ? 7000 : 3500);
}

// Runs an async button action with a disabled state and an error toast.
export function action(button, fn, busyLabel) {
  button.addEventListener("click", async () => {
    const label = button.textContent;
    button.disabled = true;
    if (busyLabel) button.textContent = busyLabel;
    try { await fn(); }
    catch (e) { console.error(e); toast(friendlyError(e), true); }
    finally { button.disabled = false; button.textContent = label; }
  });
  return button;
}

export function friendlyError(e) {
  if (e?.code === "permission-denied") return "Permission denied. Check that the Firestore rules are deployed and you own this class.";
  if (e?.code === "failed-precondition") return "Firestore needs an index for this query. Deploy firestore.indexes.json (npm run deploy:rules).";
  return e?.message || "Something went wrong.";
}

export const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const pct = (x) => `${Math.round(x * 100)}%`;
export const mins = (ms) => `${Math.round(ms / 60000)} min`;


// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.