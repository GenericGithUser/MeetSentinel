// Which Google Meet links are tracked, under each configuration. Pure logic against the real tracking.js.
// Regression: Meet links gained a "/meet/" path prefix (meet.google.com/meet/abc-defg-hij) and the old matcher,
// which assumed the code came straight after the host, silently stopped tracking them.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "mfm-trk-"));
const require = createRequire(import.meta.url);
async function load(flag) {
  const outfile = join(dir, `t-${flag}.cjs`);
  await build({
    stdin: { contents: 'export * from "./tracking.js";', resolveDir: resolve("src/background"), loader: "js" },
    bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error",
    define: { "import.meta.env.VITE_TRACK_ALL_MEETINGS": JSON.stringify(flag) }
  });
  return require(outfile);
}

let store = {};
globalThis.chrome = { storage: { local: { get: async (keys) => { const o = {}; for (const k of [].concat(keys)) if (k in store) o[k] = store[k]; return o; } } } };
let n = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } n++; console.log("ok -", m); };

const CODE = "cbx-etos-dxg";
const SHOULD_MATCH = [
  [`https://meet.google.com/${CODE}`, "classic link"],
  [`https://meet.google.com/meet/${CODE}`, "link with the /meet/ prefix"],
  [`https://meet.google.com/meet/${CODE}?f&pli=1&authuser=0`, "/meet/ link with ?f&pli=1&authuser=0"],
  [`https://meet.google.com/${CODE}?f&pli=1&authuser=0`, "classic link with ?f&pli=1&authuser=0"],
  [`https://meet.google.com/${CODE}?authuser=1`, "link with authuser"],
  [`https://meet.google.com/${CODE}/`, "trailing slash"],
  [`https://meet.google.com/${CODE}#x`, "fragment"],
  [`https://meet.google.com/u/1/${CODE}`, "account-indexed path"],
  [`https://meet.google.com/MEET/${CODE.toUpperCase()}`, "upper case"]
];
const SHOULD_NOT = [
  ["https://meet.google.com/", "the Meet home page"],
  ["https://meet.google.com/landing", "the landing page"],
  ["https://meet.google.com/new", "the instant-meeting redirect (becomes a code URL once loaded)"],
  ["https://meet.google.com/lookup/abcdef123", "a lookup redirect (becomes a code URL once loaded)"],
  ["https://meet.google.com/my-class-nickname", "a nickname link (not a code)"],
  [`https://example.com/meet/${CODE}`, "a code on a different site"],
  [`https://evilmeet.google.com.example.com/${CODE}`, "a look-alike host"],
  [`http://meet.google.com/${CODE}`, "plain http"],
  ["not a url", "garbage"]
];

// --- extraction
let T = await load("false");
for (const [url, label] of SHOULD_MATCH) ok(T.extractMeetCode(url) === CODE, `extracts the code from: ${label}`);
for (const [url, label] of SHOULD_NOT) ok(T.extractMeetCode(url) === null, `no code from: ${label}`);

// --- dev switch ON: every meeting code is tracked, no class needed
T = await load("true"); store = {};
let cfg = await T.getTrackingConfig();
ok(SHOULD_MATCH.every(([u]) => T.isTrackedMeet({ url: u }, cfg)), "dev switch on: every Meet link shape is tracked without a class");
ok(SHOULD_NOT.every(([u]) => !T.isTrackedMeet({ url: u }, cfg)), "dev switch on: non-meeting pages are still not tracked");

// --- dev switch OFF (the real configuration)
T = await load("false");
store = {};
cfg = await T.getTrackingConfig();
ok(!T.isTrackedMeet({ url: `https://meet.google.com/meet/${CODE}` }, cfg), "not in a class: nothing is tracked");

store = { classConfig: { classId: "c", meetCodes: [CODE] }, consent: { version: 1 }, membership: { status: "approved" } };
cfg = await T.getTrackingConfig();
ok(SHOULD_MATCH.every(([u]) => T.isTrackedMeet({ url: u }, cfg)), "in a class that registers the code: every link shape for that meeting is tracked");
ok(!T.isTrackedMeet({ url: "https://meet.google.com/meet/zzz-zzzz-zzz" }, cfg), "a different meeting is not tracked");
ok(!T.isTrackedMeet({ url: "https://meet.google.com/zzz-zzzz-zzz?authuser=0" }, cfg), "a different meeting is not tracked (classic link)");

store = { classConfig: { classId: "c", meetCodes: ["CBX-ETOS-DXG"] }, consent: { version: 1 } };
ok(T.isTrackedMeet({ url: `https://meet.google.com/meet/${CODE}` }, await T.getTrackingConfig()), "registered codes match regardless of case");
store = { classConfig: { classId: "c", meetCodes: ["cbxetosdxg"] }, consent: { version: 1 } };
ok(T.isTrackedMeet({ url: `https://meet.google.com/meet/${CODE}` }, await T.getTrackingConfig()), "registered codes match without hyphens");
store = { classConfig: { classId: "c", meetCodes: [CODE] } };
ok(!T.isTrackedMeet({ url: `https://meet.google.com/${CODE}` }, await T.getTrackingConfig()), "no recorded consent: nothing is tracked");
store = { classConfig: { classId: "c", meetCodes: [CODE] }, consent: { version: 1 }, membership: { status: "removed" } };
ok(!T.isTrackedMeet({ url: `https://meet.google.com/${CODE}` }, await T.getTrackingConfig()), "removed from the class: nothing is tracked");
store = { classConfig: { classId: "c", meetCodes: [] }, consent: { version: 1 } };
ok(!T.isTrackedMeet({ url: `https://meet.google.com/${CODE}` }, await T.getTrackingConfig()), "class with no registered meetings: nothing is tracked");

console.log(`\nALL ${n} TRACKING CHECKS PASSED`);
process.exit(0);
