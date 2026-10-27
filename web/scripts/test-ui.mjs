// UI tests, run in jsdom against an in-memory mock of the database/auth layer (src/lib/db.js and src/lib/firebase.js
// are swapped out at bundle time). Two parts:
//   1. SPA shell: loads the real index.html and checks which section is visible (splash / hero / main) for each auth state.
//   2. Views: renders the real class views and exercises approvals, roster, settings and attendance.
// It catches runtime bugs in the DOM code and checks that student-supplied text can never become HTML.
// It does not check visual design, talk to Firebase, or run in a real browser.
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(WEB, "src");
const TMP = mkdtempSync(join(tmpdir(), "ms-ui-"));
const require = createRequire(import.meta.url);

const MOCK_DB = `
const S = globalThis.__mock;
export const listMyClasses = async () => S.classes ?? [S.cls];
export const getClass = async () => S.cls;
export const listStudents = async () => S.students.map(x => ({...x}));
export const listRoster = async () => S.roster.map(x => ({...x}));
export const createClass = async (a) => { S.log.push(["createClass", a.name, a.meetCodes]); return { id: "c1", joinCode: "ABCDEFGH23" }; };
export const updateClass = async (id, patch) => { Object.assign(S.cls, patch); S.log.push(["updateClass", patch]); };
export const rotateJoinCode = async () => { S.log.push(["rotate"]); return "ZZZZZZZZ22"; };
export const approveStudent = async (c, uid, rid) => { const s = S.students.find(x => x.uid === uid); s.status = "approved"; s.rosterId = rid; S.log.push(["approve", uid, rid]); };
export const rejectRequest = async (c, uid) => { S.students = S.students.filter(x => x.uid !== uid); S.log.push(["reject", uid]); };
export const setStudentStatus = async (c, uid, status) => { S.students.find(x => x.uid === uid).status = status; S.log.push(["status", uid, status]); };
export const countSessions = async (c, uid) => S.sessions.filter(x => x.uid === uid).length;
export const deleteStudentAndRecords = async (c, uid) => { const n = S.sessions.filter(x => x.uid === uid).length; S.sessions = S.sessions.filter(x => x.uid !== uid); S.students = S.students.filter(x => x.uid !== uid); S.log.push(["deleteRecords", uid, n]); return n; };
export const deleteSessions = async (c, items) => { S.sessions = S.sessions.filter(x => !items.some(i => i.id === x.id)); S.log.push(["deleteSessions", items.map(i => i.id).join()]); };
export const replaceRoster = async (c, rows) => { S.log.push(["replaceRoster", rows.length]); return { saved: rows.length, removed: 0 }; };
export const fetchSessions = async () => S.sessions;
export const listOverrides = async () => ({});
export const setOverride = async () => {};
export const deleteOverride = async () => {};
`;
const MOCK_FIREBASE = `
const F = globalThis.__fb;
export const configured = F.configured, usingEmulators = F.usingEmulators, auth = null, db = null;
export const signInWithGoogle = async () => { F.calls.push(["google"]); };
export const signInWithFakeGoogle = async (email) => { F.calls.push(["fake", email]); };
export const logOut = async () => { F.calls.push(["logout"]); };
export const watchAuth = (cb) => { F.cb = cb; };
`;
const mockPlugin = {
  name: "mock",
  setup(b) {
    b.onResolve({ filter: /lib\/db\.js$/ }, () => ({ path: "db", namespace: "mock" }));
    b.onResolve({ filter: /lib\/firebase\.js$/ }, () => ({ path: "fb", namespace: "mock" }));
    b.onLoad({ filter: /^db$/, namespace: "mock" }, () => ({ contents: MOCK_DB, loader: "js" }));
    b.onLoad({ filter: /^fb$/, namespace: "mock" }, () => ({ contents: MOCK_FIREBASE, loader: "js" }));
  }
};
let bundleN = 0;
async function bundle(opts) {
  const outfile = join(TMP, `b${bundleN++}.cjs`);
  await build({ bundle: true, platform: "node", format: "cjs", outfile, plugins: [mockPlugin], logLevel: "error", ...opts });
  return outfile;
}

function setupDom(html) {
  const dom = new JSDOM(html, { url: "http://localhost/" });
  const w = dom.window;
  w.scrollTo = () => {};
  globalThis.window = w;
  globalThis.document = w.document;
  globalThis.Node = w.Node;
  globalThis.HTMLElement = w.HTMLElement;
  Object.defineProperty(globalThis, "location", { value: w.location, configurable: true });
  globalThis.__confirms = [];
  globalThis.confirm = (m) => { globalThis.__confirms.push(String(m)); return true; };
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  return dom;
}

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } console.log("ok -", m); };
// Looks at each text node on its own: a stray "null" is glued to its neighbours in textContent, so a whole-page regex misses it.
const noStray = (el, label) => {
  const walker = document.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  const bad = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.data.trim();
    if (t === "null" || /\b(undefined|NaN)\b/.test(t)) bad.push(t);
  }
  ok(bad.length === 0, `no stray "null"/"undefined"/"NaN" text on ${label}${bad.length ? ` (found: ${bad.join(", ")})` : ""}`);
};
const click = async (root, label) => {
  const b = [...root.querySelectorAll("button")].find((x) => text(x).startsWith(label));
  if (!b) throw new Error("no button: " + label);
  b.click(); await tick(60);
};

// ===================================================================== 1. SPA shell
const INDEX_HTML = readFileSync(join(WEB, "index.html"), "utf8");
const visible = (id) => !document.getElementById(id).classList.contains("none");

async function runShell(flags, body) {
  globalThis.__fb = { ...flags, calls: [], cb: null };
  globalThis.__mock = { log: [], classes: [], cls: null, students: [], roster: [], sessions: [] };
  setupDom(INDEX_HTML);
  require(await bundle({ entryPoints: [join(SRC, "main.js")] }));  // executing main.js renders the shell
  await body(globalThis.__fb);
}

ok(/<link rel="stylesheet" href="\/src\/styles\.css">/.test(INDEX_HTML) && INDEX_HTML.includes("MeetSentinel-Stand.png") && INDEX_HTML.includes("MeetSentinel-flat.png"), "index.html links the stylesheet and both logos");

await runShell({ configured: true, usingEmulators: true }, async (F) => {
  ok(visible("splash") && !visible("hero") && !visible("view") && !visible("navUser"), "shell: before auth resolves only the splash shows");

  F.cb(null); await tick();
  ok(visible("hero") && !visible("splash") && !visible("view") && !visible("navUser"), "shell: signed out -> hero visible, main and user nav hidden (none class)");
  ok(visible("signInBtn") && !visible("setupNote") && visible("devSignIn"), "shell: sign-in button and emulator-only block shown, setup note hidden");

  document.getElementById("signInBtn").click(); await tick();
  ok(F.calls.some((c) => c[0] === "google"), "shell: Sign In button starts Google sign-in");
  document.getElementById("devBtn").click(); await tick();
  ok(F.calls.some((c) => c[0] === "fake" && c[1] === "teacher@uni.edu"), "shell: emulator button signs in as the fake teacher email");

  globalThis.__mock.classes = []; globalThis.__mock.cls = { id: "c1", name: "Math 101", ownerUid: "t1", joinCode: "ABCDEFGH23", meetCodes: [], threshold: 0.9 };
  F.cb({ uid: "t1", email: "maria.teacher@uni.edu", displayName: "Maria Teacher" }); await tick();
  ok(!visible("hero") && visible("navUser") && visible("view") && !visible("splash"), "shell: signed in -> hero hidden, user nav and main visible");
  ok(document.getElementById("greeting").textContent === "Hello, Maria!", "shell: greeting uses the first name");
  ok(text(document.getElementById("view")).includes("Your Classes") && text(document.getElementById("view")).includes("New Class"), "shell: signed-in home renders Your Classes and New Class");

  F.cb({ uid: "t1", email: "abril@uni.edu", displayName: "Abril, Gian" }); await tick();
  ok(document.getElementById("greeting").textContent === "Hello, Abril!", "shell: trailing punctuation in the display name is dropped (no 'Hello, Abril,!')");
  F.cb({ uid: "t1", email: "pat.smith@uni.edu", displayName: "" }); await tick();
  ok(document.getElementById("greeting").textContent === "Hello, pat.smith!", "shell: greeting falls back to the email name");
  F.cb({ uid: "t1", email: "x@uni.edu", displayName: "<img src=x onerror=alert(1)> Evil" }); await tick();
  ok(document.querySelectorAll("#navUser img, #greeting img").length === 0, "XSS: a hostile display name is rendered as text in the greeting");

  location.hash = "#/class/c1/settings"; await tick(80);
  ok(text(document.getElementById("view")).includes("Join code"), "shell: hash route opens the class settings tab");
  location.hash = "#/nope"; await tick(80);
  ok(text(document.getElementById("view")).includes("Page not found"), "shell: unknown route shows a not-found message");

  document.getElementById("signOutBtn").click(); await tick(80);
  ok(F.calls.some((c) => c[0] === "logout") && location.hash === "#/", "shell: Sign Out signs out and returns to #/");
  F.cb(null); await tick();
  ok(visible("hero") && !visible("view") && !visible("navUser") && document.getElementById("view").children.length === 0, "shell: after sign-out the hero returns and the main panel is emptied");
});

await runShell({ configured: false, usingEmulators: false }, async () => {
  ok(visible("hero") && visible("setupNote") && !visible("signInBtn") && !visible("splash") && !visible("view") && !visible("devSignIn"),
     "shell: without Firebase config the hero shows the setup note instead of a sign-in button");
});

// ===================================================================== 2. Views
setupDom("<!doctype html><body></body>");
const viewsOut = await bundle({
  stdin: { contents: `export * from "${SRC}/views/class.js"; export * from "${SRC}/views/classes.js";`, resolveDir: SRC, loader: "js" }
});
globalThis.__fb = { configured: true, usingEmulators: false, calls: [], cb: null };

const MIN = 60000, T0 = new Date(2026, 9, 14, 9, 0, 0).getTime();
const mkS = (uid, a, b, totals) => ({ id: uid + a, uid, classId: "c1", meetCode: "abc-defg-hij", start: T0 + a * MIN, end: T0 + b * MIN, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v * MIN])) });
globalThis.__mock = {
  log: [],
  cls: { id: "c1", name: "Math 101", ownerUid: "t1", joinCode: "ABCDEFGH23", meetCodes: ["abc-defg-hij"], threshold: 0.9 },
  roster: [
    { id: "r1", name: "Maria Santos", universityEmail: "maria@uni.edu", personalEmail: "maria@gmail.com" },
    { id: "r2", name: "Juan Cruz", universityEmail: "juan@uni.edu", personalEmail: "" },
    { id: "r3", name: "Ana Reyes", universityEmail: "ana@uni.edu", personalEmail: "" }
  ],
  students: [
    { uid: "u1", name: "Maria Santos", email: "maria@uni.edu", status: "pending" },
    { uid: "u2", name: "<img src=x onerror=alert(1)>", email: "juan@uni.edu", status: "pending" },
    { uid: "u3", name: "Typo Tina", email: "typo@uni.edu", status: "pending" },
    { uid: "u9", name: "Ana Reyes", email: "ana@uni.edu", status: "approved", rosterId: "r3" }
  ],
  sessions: [mkS("u9", 0, 60, { active: 60 }), mkS("u1", 0, 60, { active: 40, other_tab_focused: 20 })]
};
const { classView, classesView } = require(viewsOut);
const mount = async (tab) => { const main = document.createElement("main"); document.body.replaceChildren(main); await classView(main, { user: { uid: "t1" }, params: ["c1", tab] }); await tick(); return main; };

// ---- class list + new class form
let main = document.createElement("main"); document.body.replaceChildren(main);
await classesView(main, { user: { uid: "t1" } }); await tick();
noStray(main, "the class list");
ok(text(main).includes("Math 101") && text(main).includes("JoinCode:") && text(main).includes("ABCDE-FGH23") && text(main).includes("1 meeting code"), "classes: list shows name, meeting count and formatted join code");
ok(main.querySelector("a.classItem")?.getAttribute("href") === "#/class/c1/approvals", "classes: each class is a real link (keyboard accessible)");
ok(!!main.querySelector("label[for=className]") && !!main.querySelector("#className"), "classes: form labels are tied to their inputs");
await click(main, "Create Class");
ok(text(main).includes("Give the class a name."), "classes: empty name is rejected");
main.querySelector("#className").value = "Bio 201"; main.querySelector("#classCodes").value = "nonsense";
await click(main, "Create Class");
ok(text(main).includes("aren't Meet codes"), "classes: invalid Meet code is rejected");
main.querySelector("#classCodes").value = "https://meet.google.com/klm-nopq-rst, abc-defg-hij";
await click(main, "Create Class");
const made = __mock.log.find((l) => l[0] === "createClass");
ok(made && made[1] === "Bio 201" && made[2].join() === "klm-nopq-rst,abc-defg-hij" && location.hash === "#/class/c1/roster", "classes: valid form creates the class and opens its roster");
__mock.classes = [];

// ---- a class that registers no Meet codes tracks nothing, and the teacher is told
main = await mount("approvals");
ok(!text(main).includes("No Google Meet codes are registered"), "class with Meet codes: no warning banner");
noStray(main, "a class that has Meet codes (regression: append(null) printed the word null under the class name)");
__mock.cls.meetCodes = [];
main = await mount("approvals");
ok(text(main).includes("No Google Meet codes are registered for this class") && text(main).includes("Add them in Settings"), "class without Meet codes: the teacher is warned that nothing is tracked");
__mock.cls.meetCodes = ["abc-defg-hij"];

// ---- approvals
main = await mount("approvals");
noStray(main, "the approvals tab");
ok(text(main).includes("Approvals (3)"), "approvals tab badge shows 3 pending");
ok(text(main).includes("Clean match") && text(main).includes("Email not on roster") && text(main).includes("Name doesn't match roster"), "approvals: clean / unmatched / mismatch flags shown");
ok(main.querySelectorAll("img").length === 0 && text(main).includes("<img src=x onerror=alert(1)>"), "XSS: a student's HTML-looking name is shown as text, never as an element");
ok(/Conflict|Name doesn't match/.test(text([...main.querySelectorAll("tbody tr")][0])), "approvals: problems sorted first");
await click(main, "Approve 1 clean match");
ok(__mock.log.some((l) => l[0] === "approve" && l[1] === "u1" && l[2] === "r1"), "bulk approve links Maria to roster row r1");
main = document.querySelector("main");
ok(text(main).includes("Approved devices (2)"), "approved list grows after reload");
const tr = [...main.querySelectorAll("tbody tr")].find((r) => text(r).includes("Typo Tina"));
tr.querySelector("button").click(); await tick(60);
ok(!__mock.log.some((l) => l[0] === "approve" && l[1] === "u3"), "approve without choosing a roster entry is refused");
tr.querySelector("select").value = "r2";
tr.querySelector("button").click(); await tick(60);
ok(__mock.log.some((l) => l[0] === "approve" && l[1] === "u3" && l[2] === "r2"), "approve with a chosen roster entry works");

// ---- removing keeps the record; former devices; restore; delete records
__mock.roster.push({ id: "r5", name: "Fiona Former", universityEmail: "fiona@uni.edu", personalEmail: "" });
__mock.students.push({ uid: "u7", name: "Fiona Former", email: "fiona@uni.edu", status: "left", rosterId: "r5" });
__mock.students.push({ uid: "u8", name: "Dan Deleted", email: "dan@uni.edu", status: "removed", rosterId: "r2" });
__mock.sessions.push(mkS("u7", 0, 60, { active: 54, other_tab_focused: 6 }), mkS("u8", 0, 30, { active: 30 }), mkS("u8", 40, 60, { active: 20 }));
// match on the first cell (the typed name): pending rows also contain every roster name inside their <select>
const rowOf = (root, name) => [...root.querySelectorAll("tbody tr")].find((r) => text(r.querySelector("td")).replace(/^.*?(?=\S)/, "") .includes(name) && !r.querySelector("select"));
const rowClick = async (root, name, label) => { const b = [...rowOf(root, name).querySelectorAll("button")].find((x) => text(x).startsWith(label)); if (!b) throw new Error(`no "${label}" button for ${name}`); b.click(); await tick(80); };

main = await mount("approvals");
noStray(main, "the approvals tab with former devices");
ok(text(main).includes("Former devices (2)") && text(main).includes("Left the class") && text(main).includes("Removed by you"), "approvals: students who left or were removed are listed under Former devices");
ok([...rowOf(main, "Fiona Former").querySelectorAll("button")].map(text).join() === "Delete records", "a student who LEFT can rejoin by themselves, so the teacher is offered only Delete records");
ok([...rowOf(main, "Dan Deleted").querySelectorAll("button")].map(text).join() === "Restore,Delete records", "a REMOVED student can be restored or deleted");

__confirms.length = 0;
await rowClick(main, "Ana Reyes", "Remove");
ok(__mock.log.some((l) => l[0] === "status" && l[1] === "u9" && l[2] === "removed") && !__mock.log.some((l) => l[0] === "deleteRecords" && l[1] === "u9"), "Remove marks the device 'removed' and does NOT delete it");
ok(/still count toward their attendance/.test(__confirms.at(-1)), "the Remove confirmation tells the teacher their recorded meetings still count");
main = document.querySelector("main");
ok(text(main).includes("Former devices (3)") && __mock.sessions.some((x) => x.uid === "u9"), "the removed device moves to Former devices and its sessions are kept");

await rowClick(main, "Ana Reyes", "Restore");
ok(__mock.log.some((l) => l[0] === "status" && l[1] === "u9" && l[2] === "approved"), "Restore sets the device back to approved");

__confirms.length = 0;
main = document.querySelector("main");
await rowClick(main, "Dan Deleted", "Delete records");
ok(/2 recorded sessions/.test(__confirms.at(-1)), "Delete records says how many sessions will be deleted before doing it");
ok(__mock.log.some((l) => l[0] === "deleteRecords" && l[1] === "u8" && l[2] === 2) && !__mock.sessions.some((x) => x.uid === "u8"), "Delete records deletes the student's sessions along with the record");
main = document.querySelector("main");
ok(text(main).includes("Former devices (1)"), "after deleting, only Fiona remains under Former devices");

// ---- roster
main = await mount("roster");
ok(text(main).includes("Current roster (4)"), "roster tab lists current roster");
ok(text(main).includes("1 former only"), "roster tab: a roster row whose only device left says so");
noStray(main, "the roster tab");
main.querySelector("textarea").value = "name,university email,personal email\nNew Kid,new@uni.edu,\nBad,notanemail,\n";
await click(main, "Preview");
ok(text(main).includes("1 student ready to save") && text(main).includes("1 problem"), "roster preview: 1 valid row, 1 problem");
noStray(main, "the roster preview (regression: append(null) when there are 10 rows or fewer)");
await click(main, "Save roster");
ok(__mock.log.some((l) => l[0] === "replaceRoster" && l[1] === 1), "roster saved through the db layer");

// ---- settings
main = await mount("settings");
noStray(main, "the settings tab");
ok(text(main).includes("ABCDE-FGH23") && main.querySelector("#sthr").value === "90", "settings: join code + threshold 90 shown");
main.querySelector("#scodes").value = "https://meet.google.com/klm-nopq-rst\nabc-defg-hij";
main.querySelector("#sthr").value = "85";
await click(main, "Save settings");
const upd = __mock.log.find((l) => l[0] === "updateClass");
ok(upd && upd[1].threshold === 0.85 && upd[1].meetCodes.join() === "klm-nopq-rst,abc-defg-hij", "settings saved: codes normalized, threshold 0.85");
main = await mount("settings");
main.querySelector("#scodes").value = "garbage";
await click(main, "Save settings");
ok(text(main).includes("aren't Meet codes"), "settings: invalid Meet code rejected with a message");
await click(main, "Generate a new code");
ok(__mock.log.some((l) => l[0] === "rotate"), "join code rotation calls the db layer");

// ---- attendance
__mock.cls.threshold = 0.9;
__mock.roster.push({ id: "r4", name: "Unlinked Uma", universityEmail: "uma@uni.edu", personalEmail: "" });
__mock.sessions.push({ ...mkS("ghost", 0, 120, { active: 120 }), id: "orph1" });   // a session whose membership no longer exists, and which would stretch the window to two hours
main = await mount("attendance");
await click(main, "Load attendance");
const t = text(main);
noStray(main, "the attendance report");
ok(t.includes("Ana Reyes") && t.includes("Present 100%"), "attendance: Ana present at 100%");
ok(t.includes("Absent 67%"), "attendance: Maria absent at 67% (40 of 60 minutes focused)");
ok(t.includes("no device"), "attendance: roster rows without a linked device are marked");
ok(rowOf(main, "Fiona Former") && /Present 90%/.test(text(rowOf(main, "Fiona Former"))), "attendance: a student who LEFT still shows the attendance they earned (54 of 60 minutes)");
ok(text(rowOf(main, "Fiona Former")).includes("no active device"), "attendance: a row whose devices have all left says 'no active device'");
ok(/1 recorded session belongs to devices with no membership/.test(t), "attendance: an orphaned session is reported, not silently counted");
ok(/Present 100%/.test(t) && /Absent 67%/.test(t), "attendance: the orphan did NOT stretch the meeting window (percentages are still measured against the real 60 minutes)");
ok(t.includes("1/1") && t.includes("0/1"), "attendance: per-student present counts");
await click(main, "Delete this session");
ok(__mock.log.some((l) => l[0] === "deleteSessions" && l[1] === "orph1"), "attendance: the orphan cleanup deletes exactly the orphaned session");
ok(!text(main).includes("no membership"), "attendance: the banner disappears once cleaned up");
noStray(main, "the attendance report after cleanup");
await click(main, "Edit window");
ok(document.querySelector("dialog[open]"), "edit-window dialog opens");

console.log("\nUI TESTS PASSED");
process.exit(0);
