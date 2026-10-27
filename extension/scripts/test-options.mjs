// Drives the real options.html + options.js in jsdom (join form, leave flow, notices), with the Firebase layer mocked.
// Also checks that every element id the scripts look up exists in their HTML page: a script and its page can drift
// apart (one file updated, the other not), and that mismatch crashes the page at runtime.
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
let n = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } n++; console.log("ok -", m); };
process.on("unhandledRejection", (e) => { console.error("FAIL: unhandled error in the page:", e && e.message); process.exit(1); });

// ---- static check: ids used by each script exist in its page
function idsUsed(js) {
  const ids = new Set([...js.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]));
  return ids;
}
const idsDefined = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
for (const [page, script, dynamic] of [
  ["popup.html", "src/popup/popup.js", []],
  ["options.html", "src/options/options.js", ["join-notice", "sec-records", "sec-class", "tab-records", "tab-class"]]   // built or templated at runtime
]) {
  const used = idsUsed(readFileSync(resolve(script), "utf8"));
  const defined = idsDefined(readFileSync(resolve(page), "utf8"));
  const missing = [...used].filter((id) => !defined.has(id) && !dynamic.includes(id));
  ok(missing.length === 0, `${script}: every element id it looks up exists in ${page}${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);
}

// ---- bundle options.js with the Firebase layer mocked
const MOCKS = {
  classes: `
    const G = globalThis.__g;
    export const normalizeEmail = (e) => String(e).trim().toLowerCase();
    export const refreshMembership = async () => ({ status: "approved" });
    export const joinClass = async (a) => { G.calls.push(["join", a.code, a.name]); await chrome.storage.local.set({ classConfig: { classId: "c1", className: "Test Class", meetCodes: [] }, membership: { status: "approved" }, profile: { name: a.name, email: a.email }, consent: { version: 1 } }); return { status: "approved" }; };
    export const leaveClass = async () => { G.calls.push(["leave"]); await chrome.storage.local.remove(["classConfig", "membership", "profile", "consent", "sessions", "session", "history"]); return G.leaveResult; };`,
  app: `export const firebaseConfigured = true;`
};
const plugin = { name: "mock", setup(b) {
  b.onResolve({ filter: /firebase\/(classes|app)\.js$/ }, (a) => ({ path: /classes/.test(a.path) ? "classes" : "app", namespace: "mock" }));
  b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: MOCKS[a.path], loader: "js" }));
}};
const outfile = join(mkdtempSync(join(tmpdir(), "mfm-opt-")), "options.cjs");
await build({ entryPoints: [resolve("src/options/options.js")], bundle: true, platform: "node", format: "cjs", outfile, plugins: [plugin], logLevel: "error",
  define: { "import.meta.env.VITE_TRACK_ALL_MEETINGS": '"false"' } });

const HTML = readFileSync(resolve("options.html"), "utf8");
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

// Loads the page fresh (the script renders and registers listeners on import) and hands back helpers.
async function openPage({ html = HTML, store = {}, leaveResult = { sent: 0, unsent: 0, markedLeft: true } } = {}) {
  const dom = new JSDOM(html, { url: "http://localhost/options.html" });
  const w = dom.window;
  globalThis.window = w; globalThis.document = w.document; globalThis.Node = w.Node; globalThis.HTMLElement = w.HTMLElement;
  Object.defineProperty(globalThis, "location", { value: w.location, configurable: true });
  w.confirm = () => true; globalThis.confirm = () => true;
  const listeners = [];
  globalThis.__g = { calls: [], leaveResult };
  const data = { ...structuredClone(store) };
  globalThis.chrome = {
    storage: { local: {
      get: async (keys) => { const o = {}; for (const k of [].concat(keys)) if (k in data) o[k] = structuredClone(data[k]); return o; },
      set: async (o) => { Object.assign(data, structuredClone(o)); listeners.forEach((f) => f(o)); },
      remove: async (ks) => { for (const k of [].concat(ks)) delete data[k]; listeners.forEach((f) => f({})); } },
      onChanged: { addListener: (f) => listeners.push(f) } },
    runtime: { sendMessage: async () => {} }
  };
  delete require.cache[outfile];
  require(outfile);
  await tick();
  const $ = (id) => w.document.getElementById(id);
  return { $, w, calls: globalThis.__g.calls, text: (id) => $(id).textContent.replace(/\s+/g, " ").trim(), data };
}

const JOINED = {
  classConfig: { classId: "c1", className: "Test Class", meetCodes: ["abc-defg-hij"], threshold: 0.9 },
  membership: { status: "approved", checkedAt: 1 }, profile: { name: "Gian", email: "g@uni.edu" }, consent: { version: 1 }
};

// ---- the leave flow, with the page as shipped
let p = await openPage({ store: JOINED, leaveResult: { sent: 2, unsent: 1, markedLeft: true } });
p.w.location.hash = "#class"; await tick();
ok(!p.$("class-section").hidden && p.text("class-name") === "Test Class", "joined: the Class tab shows the class");
p.$("leave-btn").click(); await tick(120);
ok(p.calls.some((c) => c[0] === "leave"), "Leave class calls the leave flow");
ok(!p.$("join-section").hidden && p.$("class-section").hidden, "after leaving, the join form is shown and the class details are hidden");
const note = p.$("join-notice");
ok(note && !note.hidden && /You left the class\./.test(note.textContent), "after leaving, a notice explains what happened");
ok(/2 meetings were sent to your teacher first/.test(note.textContent), "the notice reports how many meetings were sent first");
ok(/1 meeting couldn't be sent \(you seem to be offline\) and was discarded/.test(note.textContent), "the notice warns about meetings that couldn't be sent");
ok(/Your teacher keeps the meetings already sent/.test(note.textContent), "the notice says the teacher keeps what was sent");
ok(!/Couldn't reach the server/.test(note.textContent), "no server warning when the leave was recorded");

// rejoin hides the notice
p.$("name").value = "Gian"; p.$("email").value = "g@uni.edu"; p.$("code").value = "ABCDE-FGH23"; p.$("consent").checked = true;
p.$("join-form").dispatchEvent(new p.w.Event("submit", { cancelable: true, bubbles: true })); await tick(120);
ok(p.calls.some((c) => c[0] === "join" && c[1] === "ABCDE-FGH23"), "the join form submits the class code");
ok(p.$("join-notice").hidden === true && !p.$("class-section").hidden, "rejoining hides the notice and shows the class again");

// leave when the server couldn't be told
p = await openPage({ store: JOINED, leaveResult: { sent: 0, unsent: 0, markedLeft: false } });
p.w.location.hash = "#class"; await tick(); p.$("leave-btn").click(); await tick(120);
ok(/Couldn't reach the server to record that you left/.test(p.$("join-notice").textContent), "if the server couldn't be told, the student is told that too");
ok(!/meeting/.test(p.$("join-notice").textContent.replace("Your teacher keeps the meetings already sent.", "")), "and nothing is said about meetings when there were none");

// ---- regression: the leave flow must survive a page that doesn't define the notice element
// (the script and options.html can be out of step if only one of them was updated)
const staleHtml = HTML.replace(/<p id="join-notice"[^>]*><\/p>/, "");
p = await openPage({ html: staleHtml, store: JOINED, leaveResult: { sent: 1, unsent: 0, markedLeft: true } });
ok(p.$("join-notice") === null, "(setup) this page variant has no join-notice element");
p.w.location.hash = "#class"; await tick(); p.$("leave-btn").click(); await tick(120);
ok(p.$("join-notice") && /You left the class\./.test(p.$("join-notice").textContent) && !p.$("join-notice").hidden, "leaving still works and still shows the notice when the page lacks the element");
ok(!p.$("join-section").hidden, "and the join form is shown");

console.log(`\nALL ${n} OPTIONS PAGE CHECKS PASSED`);
process.exit(0);
