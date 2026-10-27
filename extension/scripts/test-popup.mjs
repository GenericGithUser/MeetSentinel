// Renders the real popup.html + popup.js in jsdom against a mocked chrome API.
// Checks the "why am I not being tracked?" messages, the live focus meter, and the last-meeting summary.
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const outfile = join(mkdtempSync(join(tmpdir(), "mfm-pop-")), "popup.cjs");
await build({
  entryPoints: [resolve("src/popup/popup.js")], bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error",
  define: { "import.meta.env.VITE_TRACK_ALL_MEETINGS": '"false"' }
});

const dom = new JSDOM(readFileSync(resolve("popup.html"), "utf8"), { url: "http://localhost/" });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
window.close = () => {};

const store = {};
let meetTabs = [];
let onChanged = null;
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => { const o = {}; for (const k of [].concat(keys)) if (k in store) o[k] = structuredClone(store[k]); return o; }
    },
    onChanged: { addListener: (f) => { onChanged = f; } }
  },
  runtime: { connect: () => ({}) },
  tabs: { query: async () => meetTabs }
};
createRequire(import.meta.url)(outfile); // runs popup.js, which renders immediately

const $ = (id) => document.getElementById(id);
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } n++; console.log("ok -", m); };
const refresh = async () => { await onChanged({}, "local"); await tick(); };
const set = async (state, tabs) => { for (const k of Object.keys(store)) delete store[k]; Object.assign(store, state); meetTabs = tabs; await refresh(); };

const CLS = { classId: "c", className: "CS 101", meetCodes: ["cbx-etos-dxg"], threshold: 0.9 };
const IN_CLASS = { classConfig: CLS, consent: { version: 1 }, membership: { status: "approved" } };
const tab = (url) => ({ id: 1, url });

await tick();
await set({}, []);
ok($("state").textContent === "Not tracking" && $("detail").textContent === "No class meeting is open", "no Meet tab: plain 'Not tracking'");

await set(IN_CLASS, [tab("https://meet.google.com/meet/zzz-zzzz-zzz?authuser=0")]);
ok(/isn't one of your class's registered meetings/.test($("detail").textContent), "unregistered meeting open: the popup explains it isn't one of the class's meetings");

await set({}, [tab("https://meet.google.com/meet/cbx-etos-dxg")]);
ok(/haven't joined a class/.test($("detail").textContent), "meeting open but no class joined: the popup says so");

await set(IN_CLASS, [tab("https://meet.google.com/landing")]);
ok(/isn't a meeting link/.test($("detail").textContent), "a non-meeting Meet page: the popup says so");

await set(IN_CLASS, [tab("https://meet.google.com/meet/cbx-etos-dxg?f&pli=1&authuser=0")]);
ok($("detail").textContent === "No class meeting is open", "the registered meeting (new /meet/ link) is recognised: no 'not registered' warning");

// live meter
const now = Date.now(), MIN = 60000;
await set({ ...IN_CLASS, session: { start: now - 35 * MIN, lastSeen: now, meetCode: "cbx-etos-dxg",
  totals: { active: 28 * MIN, other_tab_focused: 3 * MIN, notes_tab_focused: 2 * MIN },
  current: { state: "active", detail: "Meet tab focused and visible", since: now - 2 * MIN } } }, [tab("https://meet.google.com/meet/cbx-etos-dxg")]);
ok($("state").textContent === "Focused on Meet" && !$("live").classList.contains("none"), "tracking: live section shown with the state");
ok($("livePct").textContent === "91%", "live focus % = (28 + 2 + 2 min current) / 35 min = 91%");
ok($("liveHint").textContent.startsWith("Target 90%"), "live hint shows the class target");
ok(!$("liveFill").classList.contains("below"), "on target: the meter is not in the 'below' colour");
ok($("last").classList.contains("none"), "while tracking, the last-meeting block is hidden");

await set({ ...IN_CLASS, session: { start: now - 35 * MIN, lastSeen: now, meetCode: "cbx-etos-dxg",
  totals: { active: 15 * MIN, other_tab_focused: 14 * MIN },
  current: { state: "other_tab_focused", detail: "A different tab is in front", since: now - 2 * MIN } } }, []);
ok($("liveFill").classList.contains("below"), "below target: the meter switches to the warning colour");

// last meeting
const T0 = now - 86400000;
await set({ ...IN_CLASS, history: [{ id: "a", meetCode: "cbx-etos-dxg", start: T0, end: T0 + 60 * MIN, totals: { active: 54 * MIN, other_tab_focused: 6 * MIN } }] }, []);
ok(!$("last").classList.contains("none") && $("lastPct").textContent === "90%", "idle: the last meeting is shown with its focus %");
ok($("lastBadge").textContent === "Meets 90% target", "exactly 90% shows as meeting a 90% target");
ok($("classLine").textContent === "Reporting to CS 101.", "approved: the class line says it is reporting");

console.log(`\nALL ${n} POPUP CHECKS PASSED`);
process.exit(0);
