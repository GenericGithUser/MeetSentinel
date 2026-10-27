// Tests for the student's records view (src/shared/records.js): per-meeting focus %, grouping, gaps, and the breakdown.
// Pure logic, no browser. Bundles the module with esbuild like test-state.mjs does.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const outfile = join(mkdtempSync(join(tmpdir(), "mfm-rec-")), "records.cjs");
await build({
  stdin: {
    contents: 'export * from "./records.js"; export { STATE_LABELS, FOCUS_STATES } from "./constants.js";',
    resolveDir: resolve("src/shared"), loader: "js"
  },
  bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error",
  define: { "import.meta.env.VITE_TRACK_ALL_MEETINGS": '"false"' }
});
const R = createRequire(import.meta.url)(outfile);

let n = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } n++; console.log("ok -", m); };
const near = (a, b) => Math.abs(a - b) < 1e-9;

const MIN = 60000;
const T0 = new Date(2026, 9, 14, 9, 0, 0).getTime();
let id = 0;
const sess = (a, b, totalsMin, code = "abc-defg-hij", dayOffset = 0) => ({
  id: `s${++id}`, meetCode: code,
  start: T0 + dayOffset * 86400000 + a * MIN, end: T0 + dayOffset * 86400000 + b * MIN,
  totals: Object.fromEntries(Object.entries(totalsMin).map(([k, v]) => [k, v * MIN]))
});
const one = (s) => R.groupMeetings([s])[0];

// ---- the focus rule
let m = one(sess(0, 60, { active: 54, other_tab_focused: 6 }));
ok(near(m.pct, 0.9) && R.meetsTarget(m.pct, 0.9), "54 of 60 minutes focused = exactly 90%, which meets a 90% target");
m = one(sess(0, 60, { active: 53, other_tab_focused: 7 }));
ok(m.pct < 0.9 && !R.meetsTarget(m.pct, 0.9), "53 of 60 minutes = 88.3%, below the target");
ok(near(one(sess(0, 60, { active: 30, notes_tab_focused: 30 })).pct, 1), "time in a note-taking web app counts as focused");
ok(near(one(sess(0, 60, { active: 40, visible_unfocused: 20 })).pct, 40 / 60), "Meet visible but another app focused does not count");
ok(one(sess(0, 60, { active: 40, not_in_meeting: 20 })).pct < 0.7, "time in the lobby / after the call counts against focus");
ok(one(sess(0, 60, { active: 61 * 1 })).pct === 1, "percentage is capped at 100% even if totals overshoot");

// ---- gaps and grouping
const rejoin = R.groupMeetings([sess(0, 30, { active: 30 }), sess(40, 70, { active: 30 })]);
ok(rejoin.length === 1 && rejoin[0].sessions === 2, "two sessions of the same meeting on the same day are one meeting");
ok(rejoin[0].span === 70 * MIN && rejoin[0].gapMs === 10 * MIN, "the 10-minute gap between sessions is measured");
ok(near(rejoin[0].pct, 60 / 70), "the gap counts against the percentage (60 of 70 minutes), as in the teacher's report");
ok(rejoin[0].parts.reduce((a, p) => a + p.ms, 0) === rejoin[0].span, "breakdown groups add up to the whole meeting, gap included");
ok(rejoin[0].parts.find((p) => p.id === "outside").ms === 10 * MIN, "the gap is shown under 'Not in the call'");

const many = R.groupMeetings([
  sess(0, 60, { active: 60 }, "abc-defg-hij", 0),
  sess(0, 60, { active: 60 }, "abc-defg-hij", 2),
  sess(0, 60, { active: 60 }, "klm-nopq-rst", 2),
  sess(0, 60, { active: 60 }, "abc-defg-hij", 1)
]);
ok(many.length === 4, "different days and different meeting codes are different meetings");
ok(many.every((x, i) => i === 0 || many[i - 1].start >= x.start), "meetings are sorted newest first");
ok(R.groupMeetings([]).length === 0 && R.groupMeetings(undefined).length === 0, "empty history gives no meetings");
ok(R.groupMeetings([{ id: "z", meetCode: "a", start: T0, end: T0, totals: {} }]).length === 0, "zero-length sessions are ignored");

// ---- the breakdown can't silently drop a state
const allGrouped = R.GROUPS.flatMap((g) => g.states);
const tracked = Object.keys(R.STATE_LABELS).filter((k) => k !== "no_meet_tab");
ok(tracked.every((k) => allGrouped.filter((x) => x === k).length === 1), "every tracked state is in exactly one breakdown group");
ok(R.FOCUS_STATES.every((k) => R.GROUPS.filter((g) => g.id === "focused" || g.id === "notes").some((g) => g.states.includes(k))), "focus states map to the two 'focused' groups");
ok(R.groupTotals({ active: 5 * MIN, minimized: 2 * MIN, not_in_meeting: MIN }).map((g) => g.ms).join() === [5 * MIN, 0, 0, 2 * MIN, MIN].join(), "groupTotals (live view) buckets states correctly");

// ---- summary
const sum = R.summarize(R.groupMeetings([sess(0, 60, { active: 60 }, "a-a", 0), sess(0, 60, { active: 30 }, "a-a", 1)]), 0.9);
ok(sum.count === 2 && near(sum.avgPct, 0.75) && sum.meetsCount === 1, "summary: 2 meetings, average 75%, 1 meets the target");
ok(R.summarize([], 0.9).avgPct === null, "summary of nothing has no average");

console.log(`\nALL ${n} RECORD CHECKS PASSED`);
process.exit(0);
