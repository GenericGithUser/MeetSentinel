// Tests for the pure logic of the teacher site: codes, emails, CSV roster, matching, and the attendance policy.
import { generateJoinCode, normalizeMeetCode, parseMeetCodes, formatJoinCode } from "../src/lib/codes.js";
import { normalizeEmail } from "../src/lib/email.js";
import { parseCsv, parseRoster, rosterIdFor } from "../src/lib/csv.js";
import { nameSimilarity, buildApprovalQueue } from "../src/lib/matching.js";
import { computeAttendance, groupMeetings, scoreDevice, focusedMsInWindow, attendanceToCsv } from "../src/lib/attendance.js";

let n = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } n++; console.log("ok -", m); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}  (got ${JSON.stringify(a)})`);

// ---- codes
const codes = new Set(Array.from({ length: 500 }, () => generateJoinCode()));
ok(codes.size === 500 && [...codes].every((c) => /^[A-HJ-NP-Z2-9]{10}$/.test(c)), "join codes: unique, 10 chars, rules-compatible alphabet");
eq(formatJoinCode("ABCDEFGHJK"), "ABCDE-FGHJK", "join code display format");
eq(normalizeMeetCode("https://meet.google.com/ABC-defg-hij?authuser=1"), "abc-defg-hij", "meet code from URL");
eq(normalizeMeetCode("meet.google.com/abcdefghij"), "abc-defg-hij", "meet code without hyphens");
eq(normalizeMeetCode("nope"), null, "meet code invalid");
eq(normalizeMeetCode("https://meet.google.com/meet/cbx-etos-dxg"), "cbx-etos-dxg", "meet code from a /meet/ link");
eq(normalizeMeetCode("https://meet.google.com/meet/cbx-etos-dxg?f&pli=1&authuser=0"), "cbx-etos-dxg", "meet code from a /meet/ link with ?f&pli=1&authuser=0");
eq(normalizeMeetCode("meet.google.com/meet/cbx-etos-dxg"), "cbx-etos-dxg", "meet code from a /meet/ link without the scheme");
eq(normalizeMeetCode("https://meet.google.com/u/1/CBX-ETOS-DXG"), "cbx-etos-dxg", "meet code from an account-indexed, upper-case link");
eq(normalizeMeetCode("https://example.com/meet/cbx-etos-dxg"), null, "a code on another site is not accepted");
eq(normalizeMeetCode("https://meet.google.com/landing"), null, "a Meet page that has no code is not accepted");
eq(parseMeetCodes("abc-defg-hij, klm-nopq-rst\nabc-defg-hij bad").codes, ["abc-defg-hij", "klm-nopq-rst"], "meet codes: split + dedupe");
eq(parseMeetCodes("abc-defg-hij bad").invalid, ["bad"], "meet codes: invalid reported");

// ---- email
eq(normalizeEmail("  Maria.Santos+class@Gmail.com "), "mariasantos@gmail.com", "gmail: lowercase, dots, +tag");
eq(normalizeEmail("Maria.Santos+x@uni.edu.ph"), "maria.santos@uni.edu.ph", "non-gmail: keep dots, drop +tag");

// ---- csv
eq(parseCsv('a,"b,c","d ""q"""\r\n1,2,3\n'), [["a", "b,c", 'd "q"'], ["1", "2", "3"]], "csv: quotes, commas, CRLF");
const csv = '\uFEFFFull Name,University Email,Personal Email\nMaria Santos,Maria.Santos@Uni.edu,maria@gmail.com\n"Cruz, Juan",juan@uni.edu,\nNoEmail Person,,\nDupe Dan,juan@uni.edu,\nBad Email,bad,\n';
const roster = parseRoster(csv);
eq(roster.rows.map((r) => r.name), ["Maria Santos", "Cruz, Juan"], "roster: valid rows kept");
eq(roster.errors.map((e) => e.line), [4, 5, 6], "roster: missing email, duplicate email, bad email flagged with line numbers");
eq(parseRoster("first name,last name,school email\nAna,Reyes,ana@uni.edu\n").rows[0].name, "Ana Reyes", "roster: first/last name columns");
ok(parseRoster("x,y\n1,2\n").errors.length > 0, "roster: unknown headers produce an error");
eq(rosterIdFor({ universityEmail: "", personalEmail: "a@b.com" }), "a@b.com", "roster id falls back to personal email");

// ---- matching
ok(nameSimilarity("Santos, Maria", "Maria Santos") === 1, "name similarity: reordered");
ok(nameSimilarity("María Santos", "Maria L. Santos") > 0.5, "name similarity: accent + middle initial");
ok(nameSimilarity("Maria Cruz", "Maria Santos") < 0.5, "name similarity: different surname is a mismatch");
const R = [
  { id: "r1", name: "Maria Santos", universityEmail: "maria@uni.edu", personalEmail: "maria@gmail.com" },
  { id: "r2", name: "Juan Cruz", universityEmail: "juan@uni.edu", personalEmail: "" },
  { id: "r3", name: "Ana Reyes", universityEmail: "ana@uni.edu", personalEmail: "" }
];
const M = [
  { uid: "u1", name: "Maria Santos", email: "Maria@Uni.edu", status: "pending" },     // clean
  { uid: "u2", name: "Juan Cruz", email: "juan@uni.edu", status: "pending" },         // clean until rival below
  { uid: "u3", name: "Totally Different", email: "juan@uni.edu", status: "pending" }, // rival claim on r2 + name mismatch
  { uid: "u4", name: "Pat", email: "typo@uni.edu", status: "pending" },               // unmatched
  { uid: "u5", name: "Ana Reyes", email: "ana@uni.edu", status: "approved", rosterId: "r3" },
  { uid: "u6", name: "Ana Reyes", email: "ana@uni.edu", status: "pending" }           // second device of an approved student
];
const q = buildApprovalQueue(M, R).entries;
const cat = Object.fromEntries(q.map((e) => [e.member.uid, e.category]));
eq(Object.fromEntries(Object.entries(cat).sort()), { u1: "clean", u2: "conflict", u3: "conflict", u4: "unmatched", u6: "conflict" }, "queue categories");
ok(q[0].category === "conflict" && q.at(-1).category === "clean", "queue sorted: problems first, clean last");
ok(q.find((e) => e.member.uid === "u3").flags.includes("name_mismatch"), "queue: name mismatch flagged alongside the conflict");
ok(q.find((e) => e.member.uid === "u6").info.alreadyLinked[0] === "Ana Reyes", "queue: already-linked student reported");

// ---- attendance policy
const MIN = 60000;
const T0 = new Date(2026, 9, 14, 9, 0, 0).getTime();        // 09:00 local
const meetCode = "abc-defg-hij";
const mk = (uid, startMin, endMin, totalsMin) => ({
  uid, meetCode, start: T0 + startMin * MIN, end: T0 + endMin * MIN,
  totals: Object.fromEntries(Object.entries(totalsMin).map(([k, v]) => [k, v * MIN]))
});
const roster2 = [
  { id: "A", name: "Full focus" }, { id: "B", name: "Notes count as focus" }, { id: "C", name: "Exactly 90%" },
  { id: "D", name: "Just under" }, { id: "E", name: "Late arrival" }, { id: "F", name: "Visible-but-unfocused" },
  { id: "G", name: "Two devices" }, { id: "H", name: "No device" }, { id: "I", name: "Linked, never attended" }
];
const members = [
  ...["A","B","C","D","E","F","I"].map((id) => ({ uid: "u" + id, rosterId: id, status: "approved" })),
  { uid: "uG1", rosterId: "G", status: "approved" }, { uid: "uG2", rosterId: "G", status: "approved" }
];
const sessions = [
  mk("uA", 0, 60, { active: 60 }),                                            // 100%
  mk("uB", 0, 60, { active: 30, notes_tab_focused: 30 }),                     // 100%: notes count
  mk("uC", 0, 60, { active: 54, other_tab_focused: 6 }),                      // exactly 90% -> present
  mk("uD", 0, 60, { active: 53, other_tab_focused: 7 }),                      // 88.3% -> absent
  mk("uE", 10, 60, { active: 50 }),                                           // joined 10 min late: 83% -> absent
  mk("uF", 0, 60, { active: 40, visible_unfocused: 20 }),                     // 66.7% -> absent
  mk("uG1", 0, 60, { active: 30, other_tab_focused: 30 }),                    // device 1: 50%
  mk("uG2", 0, 60, { active: 55, minimized: 5 }),                             // device 2: 91.7% -> present (best, not sum)
  mk("uA", 0, 60, { active: 60 }),                                            // a duplicate record must not push anyone above 100%
];
const att = computeAttendance({ sessions, members, roster: roster2 });
eq(att.meetings.length, 1, "one meeting grouped (same code, same day)");
eq(att.meetings[0].end - att.meetings[0].start, 60 * MIN, "default window = earliest start .. latest end");
const st = Object.fromEntries(att.rows.map((r) => [r.roster.id, r.cells[0].status]));
eq(Object.fromEntries(Object.entries(st).sort()), { A: "present", B: "present", C: "present", D: "absent", E: "absent", F: "absent", G: "present", H: "no_device", I: "absent" },
   "policy: 90% of the whole meeting, notes count, visible-unfocused does not, late arrival deducts, best device wins");
ok(Math.abs(att.rows[0].cells[0].pct - 1) < 1e-9, "focus percentage is capped at 100%");
ok(att.rows[4].cells[0].joinedLateMs === 10 * MIN, "late arrival reported (10 min)");
ok(att.rows[7].cells[0].pct === null, "no linked device -> no percentage");

// threshold is configurable; teacher window override changes the denominator
eq(computeAttendance({ sessions, members, roster: roster2, threshold: 0.8 }).rows.find((r) => r.roster.id === "E").cells[0].status, "present", "threshold 80%: the 83% late student is present");
const key = att.meetings[0].key;
const short = computeAttendance({ sessions, members, roster: roster2, overrides: { [key]: { start: T0 + 10 * MIN, end: T0 + 60 * MIN } } });
eq(short.rows.find((r) => r.roster.id === "E").cells[0].status, "present", "window override to 09:10-10:00: the late student attended all of it");
ok(short.rows.find((r) => r.roster.id === "C").cells[0].pct < 1, "override: clipped proportionally, others scaled to the new window");

// sessions that overrun the window are clipped, not credited
const over = mk("uA", 0, 120, { active: 120 });
ok(Math.abs(focusedMsInWindow(over, T0, T0 + 60 * MIN) - 60 * MIN) < 1, "session longer than the window is clipped to the window");

// devices that left or were removed keep the attendance they earned; pending requests (no roster link) never count
const fRoster = [{ id: "L", name: "Left" }, { id: "R", name: "Removed" }, { id: "P", name: "Pending only" }, { id: "A", name: "Active" }];
const fMembers = [
  { uid: "uL", rosterId: "L", status: "left" }, { uid: "uR", rosterId: "R", status: "removed" },
  { uid: "uP", status: "pending" }, { uid: "uA", rosterId: "A", status: "approved" }
];
const fSessions = [mk("uL", 0, 60, { active: 60 }), mk("uR", 0, 60, { active: 30, other_tab_focused: 30 }), mk("uA", 0, 60, { active: 60 }), mk("uP", 0, 60, { active: 60 })];
const fAtt = computeAttendance({ sessions: fSessions, members: fMembers, roster: fRoster });
const fRow = Object.fromEntries(fAtt.rows.map((r) => [r.roster.id, r]));
eq(fRow.L.cells[0].status, "present", "a student who LEFT keeps the attendance already earned");
eq(fRow.R.cells[0].status, "absent", "a REMOVED student's recorded meetings are still scored (30 of 60 minutes = absent)");
eq(fRow.P.cells[0].status, "no_device", "a pending request with no roster link counts for nobody");
eq([fRow.L.devices, fRow.L.activeDevices, fRow.A.devices, fRow.A.activeDevices], [1, 0, 1, 1], "rows report linked and currently-active device counts");

// separate days / meeting codes are separate meetings
const day2 = { ...mk("uA", 0, 60, { active: 60 }), start: T0 + 86400000, end: T0 + 86400000 + 60 * MIN };
eq(groupMeetings([sessions[0], day2]).length, 2, "two days -> two meetings");
eq(groupMeetings([sessions[0], { ...sessions[0], meetCode: "klm-nopq-rst" }]).length, 2, "two codes -> two meetings");

// csv export
const out = attendanceToCsv(att);
ok(out.split("\n").length === roster2.length + 1 && out.includes('"100% present"') && out.includes('"no device"'), "csv export has a row per student with status text");

console.log(`\nALL ${n} CHECKS PASSED`);
