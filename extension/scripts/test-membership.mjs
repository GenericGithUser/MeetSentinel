// Join / leave / rejoin / removal logic (src/firebase/classes.js) against an in-memory Firestore.
// The mock enforces a JavaScript copy of the STUDENT-side security rules (firestore.rules), so these tests also fail
// if the client ever attempts something the real rules would deny: deleting a membership, self-approving, and so on.
// It does not run the real rules (tests/rules does, in the emulator) and does not talk to Firebase.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const MOCKS = {
  "firebase/firestore": `
    const S = globalThis.__fs;
    const deny = () => Object.assign(new Error("permission-denied"), { code: "permission-denied" });
    export const doc = (_db, ...segs) => ({ path: segs.join("/") });
    export const serverTimestamp = () => "SERVER_TIME";
    export const getDoc = async (ref) => { const d = S.docs.get(ref.path); return { exists: () => !!d, data: () => d && structuredClone(d) }; };
    export const setDoc = async (ref, data) => {
      if (S.docs.has(ref.path)) throw deny();                       // create only; an existing record can't be overwritten
      if (data.status !== "pending") throw deny();                  // students can only create PENDING records
      S.docs.set(ref.path, structuredClone(data)); S.log.push(["create", ref.path]);
    };
    export const updateDoc = async (ref, patch) => {
      const prev = S.docs.get(ref.path); if (!prev) throw deny();
      const keys = Object.keys(patch);
      if (keys.length !== 1 || keys[0] !== "status") throw deny(); // a student may change nothing but status
      const next = patch.status;
      const leave = ["pending", "approved"].includes(prev.status) && next === "left";
      const back = prev.status === "left" && next === ("rosterId" in prev ? "approved" : "pending");
      if (!(leave || back)) throw deny();
      prev.status = next; S.log.push(["update", ref.path, next]);
    };
    export const deleteDoc = async () => { S.log.push(["DELETE-ATTEMPT"]); throw deny(); };   // students can never delete a membership
  `,
  "./app.js": `export const getFirebase = () => ({ db: {}, auth: {} }); export const firebaseConfigured = true;`,
  "./auth.js": `
    const S = globalThis.__fs;
    export const ensureSignedIn = async () => { S.signedIn = true; return { uid: S.uid }; };
    export const getSignedInUser = async () => (S.signedIn ? { uid: S.uid } : null);`,
  "./sessions.js": `
    const S = globalThis.__fs;
    export const uploadSession = async (classId, uid, rec) => { if (S.offline) return "retry"; S.uploaded.push(rec.id); return "done"; };`,
  "firebase/auth/web-extension": `export const signOut = async () => { globalThis.__fs.signedOut = true; };`
};
const plugin = {
  name: "mock",
  setup(b) {
    b.onResolve({ filter: /^(firebase\/firestore|firebase\/auth\/web-extension|\.\/app\.js|\.\/auth\.js|\.\/sessions\.js)$/ }, (a) => ({ path: a.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: MOCKS[a.path], loader: "js" }));
  }
};
const outfile = join(mkdtempSync(join(tmpdir(), "mfm-mem-")), "classes.cjs");
await build({
  stdin: { contents: 'export * from "./classes.js";', resolveDir: resolve("src/firebase"), loader: "js" },
  bundle: true, platform: "node", format: "cjs", outfile, plugins: [plugin], logLevel: "error",
  define: { "import.meta.env.VITE_TRACK_ALL_MEETINGS": '"false"' }
});

const store = {};
globalThis.chrome = { storage: { local: {
  get: async (keys) => { const o = {}; for (const k of [].concat(keys)) if (k in store) o[k] = structuredClone(store[k]); return o; },
  set: async (o) => Object.assign(store, structuredClone(o)),
  remove: async (ks) => { for (const k of [].concat(ks)) delete store[k]; }
} } };
const fs = globalThis.__fs = { docs: new Map(), log: [], uploaded: [], uid: "gian", signedIn: false, signedOut: false, offline: false };
const C = createRequire(import.meta.url)(outfile);

let n = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } n++; console.log("ok -", m); };
const rejects = async (p) => { try { await p; return null; } catch (e) { return e; } };

const CODE = "ABCDEFGH23", ME = "classes/c1/students/gian";
fs.docs.set(`joinCodes/${CODE}`, { classId: "c1" });
fs.docs.set("joinCodes/KMNPQRST45", { classId: "c2" });
const clear = () => { for (const k of Object.keys(store)) delete store[k]; };
const doc = () => fs.docs.get(ME);
const queue = (ids) => { store.sessions = ids.map((id) => ({ id, meetCode: "abc-defg-hij", start: 1, end: 2, totals: {} })); };

// ---- join
await C.joinClass({ code: "abcde-fgh23", name: " Gian ", email: "Gian@Uni.edu" });
ok(doc().status === "pending" && doc().name === "Gian" && doc().email === "gian@uni.edu", "joining creates a pending membership with the typed name and email (normalised)");
ok(store.membership.status === "pending" && store.consent && store.classConfig.classId === "c1", "join stores the class, consent and membership locally");

// ---- leave while pending
let r = await C.leaveClass();
ok(doc() && doc().status === "left", "leaving while pending keeps the membership, marked 'left'");
ok(!fs.log.some((l) => l[0] === "DELETE-ATTEMPT"), "leaving never tries to delete the membership");
ok(fs.signedIn && !fs.signedOut, "leaving keeps the signed-in identity, so rejoining reconnects to the same record");
ok(!store.classConfig && !store.membership && !store.consent && !store.history, "leaving wipes the class data and local records from this browser");
ok(r.markedLeft === true && r.sent === 0 && r.unsent === 0, "leave reports what happened");

// ---- rejoin: never approved -> pending again
await C.joinClass({ code: CODE, name: "Someone Else", email: "other@uni.edu" });
ok(doc().status === "pending" && doc().name === "Gian", "rejoining after leaving while pending: pending again, and the original name is kept");
ok(store.profile.name === "Gian", "the profile shown is what the teacher matched, not what was typed this time");

// ---- approved student, with unsent meetings, leaves
doc().status = "approved"; doc().rosterId = "r1";
store.membership = { status: "approved", checkedAt: Date.now() };
queue(["m1", "m2"]); store.history = [{ id: "m0" }];
r = await C.leaveClass();
ok(doc().status === "left" && doc().rosterId === "r1", "leaving while approved keeps the membership AND its roster link");
ok(fs.uploaded.join() === "m1,m2" && r.sent === 2 && r.unsent === 0, "meetings not yet sent are uploaded before leaving, so none is lost");
ok(!fs.log.some((l) => l[0] === "DELETE-ATTEMPT") && !fs.signedOut, "still no delete and no sign-out");

// ---- rejoin: approved before -> approved again, no new approval
await C.joinClass({ code: CODE, name: "Gian", email: "gian@uni.edu" });
ok(doc().status === "approved" && doc().rosterId === "r1", "rejoining after leaving while approved: approved again with the same roster link");
ok(store.membership.status === "approved", "the extension sees it is approved straight away");

// ---- leaving while offline
fs.offline = true; fs.uploaded.length = 0;
store.membership = { status: "approved", checkedAt: Date.now() }; queue(["m3", "m4"]);
r = await C.leaveClass();
ok(r.sent === 0 && r.unsent === 2 && doc().status === "left", "offline: the leave still goes through, and the unsent meetings are reported so the student is told");
fs.offline = false;

// ---- removed by the teacher
await C.joinClass({ code: CODE, name: "Gian", email: "gian@uni.edu" });   // back to approved
doc().status = "removed";                                                    // teacher action
clear();
const err = await rejects(C.joinClass({ code: CODE, name: "Gian", email: "gian@uni.edu" }));
ok(err && /removed you/.test(err.message), "a student the teacher removed can't rejoin by themselves");
ok(!store.classConfig, "a refused join leaves no class configured locally");
ok(doc().status === "removed", "and the membership is untouched");

// ---- refreshing membership
store.classConfig = { classId: "c1", className: "x", meetCodes: [] };
let m = await C.refreshMembership();
ok(m.status === "removed", "refresh reports 'removed' when the teacher removed this student");
doc().status = "left";
m = await C.refreshMembership();
ok(m.status === "left", "refresh reports 'left'");
fs.docs.delete(ME);
m = await C.refreshMembership();
ok(m.status === "removed", "no membership record at all (a rejected request) is treated as removed");

// ---- a different class has its own membership
clear(); fs.docs.set("classes/c1/students/gian", { name: "Gian", email: "g@u.edu", status: "approved", rosterId: "r1" });
await C.joinClass({ code: "KMNPQRST45", name: "Gian", email: "g@u.edu" });
ok(fs.docs.get("classes/c2/students/gian")?.status === "pending" && fs.docs.get("classes/c1/students/gian").status === "approved", "joining a second class creates a separate pending membership and leaves the first alone");

console.log(`\nALL ${n} MEMBERSHIP CHECKS PASSED`);
process.exit(0);
