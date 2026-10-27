// Children that are strings become TEXT nodes, so teacher-supplied class names can never be interpreted as HTML.
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
    else if (k === "value") deferredValue = v;
    else if (k === "style") el.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== "list") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  add(el, ...children);
  if (deferredValue !== undefined) el.value = deferredValue;
  return el;
}

export const clear = (node) => { node.replaceChildren(); return node; };


// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.