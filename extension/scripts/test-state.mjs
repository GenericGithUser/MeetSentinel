// Logic tests for the tracking state machine. Bundles src/background/state.js with esbuild and runs it in Node
// against an in-memory mock of the chrome.* APIs. It does NOT test real browser behaviour or Firebase.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "mfm-"));
const outfile = join(dir, "state.cjs");
await build({
  entryPoints: [resolve("src/background/state.js")],
  bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error",
  define: { "import.meta.env.VITE_TRACK_ALL_MEETINGS": '"false"' }
});

// ---- mock chrome ----
const store = {};
let windows = [];
let ping = { inMeeting: true, visibility: "visible" };
let T = 0;
Date.now = () => T;
const noop = { addListener() {} };
const clone = (v) => structuredClone(v);
globalThis.chrome = {
  runtime: { getContexts: async () => [] },
  storage: {
    local: {
      get: async (arg) => {
        const out = {};
        if (typeof arg === "string") arg = [arg];
        if (Array.isArray(arg)) { for (const k of arg) if (k in store) out[k] = clone(store[k]); }
        else for (const [k, d] of Object.entries(arg)) out[k] = k in store ? clone(store[k]) : d;
        return out;
      },
      set: async (o) => Object.assign(store, clone(o)),
      remove: async (ks) => { for (const k of [].concat(ks)) delete store[k]; }
    }
  },
  tabs: { sendMessage: async () => ping },
  windows: { getAll: async () => windows }
};

const { evaluate, setOnSessionEnd } = createRequire(import.meta.url)(outfile);

const REG_A = "abc-defg-hij", REG_B = "klm-nopq-rst", OTHER = "xyz-wxyz-abc";
const meetWin = (code, focused = true) => [{
  focused, state: "normal",
  tabs: [{ id: 1, active: true, url: `https://meet.google.com/${code}` }]
}];
const setClass = (codes) => { store.classConfig = { classId: "c1", className: "Test", meetCodes: codes }; store.consent = { version: 1, acceptedAt: 1 }; store.membership = { status: "approved" }; };
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } console.log("ok -", m); };

let ended = 0;
setOnSessionEnd(() => { ended++; });

// 1. nothing open
setClass([REG_A, REG_B]);
T = 500; windows = []; await evaluate();
ok(!store.session && (store.sessions || []).length === 0, "no Meet tab -> nothing stored");

// 2. registered meeting starts a session with its code
T = 1000; windows = meetWin(REG_A); await evaluate();
ok(store.session?.current.state === "active" && store.session.meetCode === REG_A, "registered meeting -> session starts with meetCode");

// 3. state change accumulates, close moves to outbox with the right shape
T = 11000; await evaluate();
T = 21000; windows = meetWin(REG_A, false); await evaluate({ confirmed: true });
ok(store.session.totals.active === 20000 && store.session.current.state === "visible_unfocused", "state change adds totals");
T = 31000; windows = []; await evaluate();
const rec = store.sessions[0];
ok(!store.session && store.sessions.length === 1 && ended === 1, "tab closed -> session in outbox, onSessionEnd fired");
ok(Object.keys(rec).sort().join() === "end,id,meetCode,start,totals", "outbox record has only id/meetCode/start/end/totals");
ok(rec.totals.active === 20000 && rec.totals.visible_unfocused === 10000 && /^[0-9a-f-]{36}$/.test(rec.id), "outbox totals and uuid correct");
ok(store.history?.length === 1 && store.history[0].id === rec.id && store.history[0].totals.active === 20000, "the finished session is also kept in local history for the student");
store.sessions = []; // pretend the upload succeeded and the outbox was cleared
ok(store.history.length === 1, "local history survives the outbox being cleared after upload");
store.sessions = [rec];

// 4. unregistered meeting is ignored entirely
T = 40000; windows = meetWin(OTHER); await evaluate();
T = 60000; await evaluate();
ok(!store.session && store.sessions.length === 1, "unregistered meeting is not tracked");

// 5. no consent -> nothing tracked even for a registered meeting
const consent = store.consent; delete store.consent;
T = 70000; windows = meetWin(REG_A); await evaluate();
ok(!store.session, "no consent -> not tracked");
store.consent = consent;

// 6. removed from class -> not tracked
store.membership = { status: "removed" };
T = 71000; await evaluate();
ok(!store.session, "removed from class -> not tracked");
store.membership = { status: "approved" };

// 7. stale session ends at lastSeen, not at wake-up time
T = 100000; windows = meetWin(REG_A); await evaluate();
T = 130000; await evaluate();
T = 1000000; windows = []; await evaluate();
const stale = store.sessions[1];
ok(store.sessions.length === 2 && stale.end === 130000 && stale.totals.active === 30000, "stale session ends at lastSeen");

// 8. concurrent events -> exactly one record
T = 2000000; windows = meetWin(REG_A); await evaluate();
T = 2020000; windows = [];
await Promise.all([evaluate(), evaluate(), evaluate(), evaluate(), evaluate()]);
ok(store.sessions.length === 3, "concurrent events -> exactly one session recorded");

// 9. sub-5s session discarded
T = 3000000; windows = meetWin(REG_A); await evaluate();
T = 3001000; windows = []; await evaluate();
ok(store.sessions.length === 3, "sub-5s session discarded");

// 10. switching to another registered meeting splits sessions
T = 4000000; windows = meetWin(REG_A); await evaluate();
T = 4020000; windows = meetWin(REG_B); await evaluate();
T = 4040000; windows = []; await evaluate();
const [s1, s2] = store.sessions.slice(-2);
ok(store.sessions.length === 5 && s1.meetCode === REG_A && s2.meetCode === REG_B, "changing meeting splits into two sessions");

// 11. lobby time is recorded as not_in_meeting, call time separately
ping = { inMeeting: false, visibility: "visible" };
T = 5000000; windows = meetWin(REG_A); await evaluate();
ping = { inMeeting: true, visibility: "visible" };
T = 5010000; await evaluate();
T = 5030000; windows = []; await evaluate();
const last = store.sessions.at(-1);
ok(last.totals.not_in_meeting === 10000 && last.totals.active === 20000, "lobby and call time recorded separately");

ok(store.history.length === store.sessions.length, "every finished session is in both the outbox and the history");
console.log("ALL PASSED");
process.exit(0);
