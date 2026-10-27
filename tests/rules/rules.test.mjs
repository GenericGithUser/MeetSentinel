// Firestore security-rules tests. Run with:  npm run test:rules   (needs Java; the Firebase CLI downloads the emulator)
// Every "allowed" case has matching "denied" cases: a rule that allows too much fails here.
import { readFileSync } from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, collectionGroup,
  query, where, serverTimestamp, writeBatch
} from "firebase/firestore";

let env;
const CODE = "ABCDEFGH23";   // valid join code for class c1
const CODE2 = "KMNPQRST45";  // valid join code for class c2 (owned by t2)
const MEET = "abc-defg-hij";

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-meetsentinel",
    firestore: { rules: readFileSync("firestore.rules", "utf8") }
  });
});
after(async () => { await env.cleanup(); });

const teacherDb = (uid) => env.authenticatedContext(uid, {
  email: `${uid}@uni.edu`, email_verified: true, firebase: { sign_in_provider: "google.com" }
}).firestore();
const studentDb = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }).firestore();

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "classes/c1"), { name: "Math 101", ownerUid: "t1", joinCode: CODE, meetCodes: [MEET], threshold: 0.9, createdAt: 1 });
    await setDoc(doc(db, "classes/c2"), { name: "Other", ownerUid: "t2", joinCode: CODE2, meetCodes: [], threshold: 0.9, createdAt: 1 });
    await setDoc(doc(db, `joinCodes/${CODE}`), { classId: "c1" });
    await setDoc(doc(db, `joinCodes/${CODE2}`), { classId: "c2" });
    await setDoc(doc(db, "classes/c1/roster/r1"), { name: "Maria Santos", universityEmail: "maria@uni.edu", personalEmail: "maria@gmail.com" });
    await setDoc(doc(db, "classes/c1/students/s1"), { name: "Maria Santos", email: "maria@uni.edu", joinCode: CODE, status: "approved", rosterId: "r1", createdAt: 1 });
    await setDoc(doc(db, "classes/c1/students/s2"), { name: "Pending Pat", email: "pat@uni.edu", joinCode: CODE, status: "pending", createdAt: 1 });
  });
});

const member = (over = {}) => ({ name: "New Student", email: "new@uni.edu", joinCode: CODE, status: "pending", createdAt: serverTimestamp(), ...over });
const session = (over = {}) => {
  const end = Date.now() - 1000, start = end - 600000;
  return { classId: "c1", meetCode: MEET, start, end, totals: { active: 500000, other_tab_focused: 90000 }, uploadedAt: serverTimestamp(), ...over };
};
const putSession = (db, id = "sess1", over = {}, uid = "s1") => setDoc(doc(db, `classes/c1/students/${uid}/sessions/${id}`), session(over));

// ------------------------------------------------------------------ classes + join codes
test("a Google teacher can create a class and its join code in one batch", async () => {
  const db = teacherDb("t3"); const b = writeBatch(db);
  b.set(doc(db, "classes/c3"), { name: "Bio", ownerUid: "t3", joinCode: "ZZZZZZZZ22", meetCodes: [], threshold: 0.9, createdAt: serverTimestamp() });
  b.set(doc(db, "joinCodes/ZZZZZZZZ22"), { classId: "c3" });
  await assertSucceeds(b.commit());
});
test("an anonymous (student) user cannot create a class", async () => {
  await assertFails(setDoc(doc(studentDb("s9"), "classes/c3"), { name: "Bio", ownerUid: "s9", joinCode: "ZZZZZZZZ22", meetCodes: [], threshold: 0.9, createdAt: serverTimestamp() }));
});
test("a teacher cannot create a class owned by someone else", async () => {
  await assertFails(setDoc(doc(teacherDb("t3"), "classes/c3"), { name: "Bio", ownerUid: "t1", joinCode: "ZZZZZZZZ22", meetCodes: [], threshold: 0.9, createdAt: serverTimestamp() }));
});
test("a teacher cannot point a join code at someone else's class", async () => {
  await assertFails(setDoc(doc(teacherDb("t3"), "joinCodes/ZZZZZZZZ22"), { classId: "c1" }));
});
test("a join code can be read by id but never listed", async () => {
  const db = studentDb("s9");
  await assertSucceeds(getDoc(doc(db, `joinCodes/${CODE}`)));
  await assertFails(getDocs(collection(db, "joinCodes")));
});
test("a teacher cannot overwrite an existing join code", async () => {
  await assertFails(setDoc(doc(teacherDb("t1"), `joinCodes/${CODE}`), { classId: "c1" }));
});
test("class reads: owner and members yes, strangers and other teachers no", async () => {
  await assertSucceeds(getDoc(doc(teacherDb("t1"), "classes/c1")));
  await assertSucceeds(getDoc(doc(studentDb("s2"), "classes/c1")));      // pending member
  await assertFails(getDoc(doc(studentDb("s9"), "classes/c1")));         // not a member
  await assertFails(getDoc(doc(teacherDb("t2"), "classes/c1")));
});
test("a teacher can list only their own classes", async () => {
  await assertSucceeds(getDocs(query(collection(teacherDb("t1"), "classes"), where("ownerUid", "==", "t1"))));
  await assertFails(getDocs(collection(teacherDb("t1"), "classes")));
});
test("class settings: owner can update, threshold out of range is rejected, others cannot", async () => {
  const ref = (db) => doc(db, "classes/c1");
  await assertSucceeds(updateDoc(ref(teacherDb("t1")), { meetCodes: [MEET, "klm-nopq-rst"], threshold: 0.8 }));
  await assertFails(updateDoc(ref(teacherDb("t1")), { threshold: 0.2 }));
  await assertFails(updateDoc(ref(teacherDb("t1")), { ownerUid: "t2" }));
  await assertFails(updateDoc(ref(teacherDb("t2")), { name: "hijack" }));
  await assertFails(updateDoc(ref(studentDb("s1")), { meetCodes: [] }));
});

// ------------------------------------------------------------------ joining + approval
test("a student can create their own pending membership with a valid code", async () => {
  await assertSucceeds(setDoc(doc(studentDb("s3"), "classes/c1/students/s3"), member()));
});
test("join is denied for: wrong class code, forged uid, self-approval, extra fields, bad email, unknown code", async () => {
  const db = studentDb("s3"); const ref = doc(db, "classes/c1/students/s3");
  await assertFails(setDoc(ref, member({ joinCode: CODE2 })));                 // code belongs to another class
  await assertFails(setDoc(doc(db, "classes/c1/students/s4"), member()));      // not your uid
  await assertFails(setDoc(ref, member({ status: "approved" })));              // self-approval
  await assertFails(setDoc(ref, member({ rosterId: "r1" })));                  // extra field
  await assertFails(setDoc(ref, member({ email: "not-an-email" })));
  await assertFails(setDoc(ref, member({ joinCode: "AAAAAAAAAA" })));          // code does not exist
  await assertFails(setDoc(ref, member({ createdAt: 5 })));                    // client-chosen timestamp
});
test("a student cannot approve themselves or edit their record after joining", async () => {
  const ref = doc(studentDb("s2"), "classes/c1/students/s2");
  await assertFails(updateDoc(ref, { status: "approved", rosterId: "r1" }));
  await assertFails(updateDoc(ref, { name: "Someone Else" }));
});
test("the owner can approve with a roster link, but not without one, and cannot rewrite other fields", async () => {
  const ref = doc(teacherDb("t1"), "classes/c1/students/s2");
  await assertFails(updateDoc(ref, { status: "approved" }));                   // no rosterId
  await assertFails(updateDoc(ref, { status: "approved", rosterId: "r1", email: "x@y.com" }));
  await assertSucceeds(updateDoc(ref, { status: "approved", rosterId: "r1" }));
});
test("another teacher cannot approve students in a class they don't own", async () => {
  await assertFails(updateDoc(doc(teacherDb("t2"), "classes/c1/students/s2"), { status: "approved", rosterId: "r1" }));
});
test("students: a student reads only their own record; the owner reads and lists all", async () => {
  await assertSucceeds(getDoc(doc(studentDb("s2"), "classes/c1/students/s2")));
  await assertFails(getDoc(doc(studentDb("s2"), "classes/c1/students/s1")));
  await assertFails(getDocs(collection(studentDb("s2"), "classes/c1/students")));
  await assertSucceeds(getDocs(collection(teacherDb("t1"), "classes/c1/students")));
  await assertFails(getDocs(collection(teacherDb("t2"), "classes/c1/students")));
});
const ok = (c, m) => assert.ok(c, m);

// ------------------------------------------------------------------ leaving, removal and coming back
const studentRef = (db, uid) => doc(db, `classes/c1/students/${uid}`);
const seedSession = (uid = "s1", id = "seed") => env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), `classes/c1/students/${uid}/sessions/${id}`), { ...session(), uploadedAt: 1 });
});

test("a student can mark themselves as having left (pending or approved)", async () => {
  await assertSucceeds(updateDoc(studentRef(studentDb("s1"), "s1"), { status: "left" }));
  await assertSucceeds(updateDoc(studentRef(studentDb("s2"), "s2"), { status: "left" }));
});
test("a student can NOT delete their own membership, which would orphan their sessions", async () => {
  await assertFails(deleteDoc(studentRef(studentDb("s1"), "s1")));
  await assertFails(deleteDoc(studentRef(studentDb("s2"), "s2")));
});
test("leaving keeps the sessions and the roster link; a left student cannot upload", async () => {
  await seedSession();
  await updateDoc(studentRef(studentDb("s1"), "s1"), { status: "left" });
  await assertSucceeds(getDoc(doc(teacherDb("t1"), "classes/c1/students/s1/sessions/seed")));   // still there for the teacher
  const kept = await getDoc(studentRef(teacherDb("t1"), "s1"));
  ok(kept.exists() && kept.data().rosterId === "r1" && kept.data().status === "left");
  await assertFails(putSession(studentDb("s1"), "while-away"));
});
test("a left student who WAS approved comes back approved, with no new approval; any other status is denied", async () => {
  await updateDoc(studentRef(studentDb("s1"), "s1"), { status: "left" });
  await assertFails(updateDoc(studentRef(studentDb("s1"), "s1"), { status: "pending" }));
  await assertFails(updateDoc(studentRef(studentDb("s1"), "s1"), { status: "removed" }));
  await assertSucceeds(updateDoc(studentRef(studentDb("s1"), "s1"), { status: "approved" }));
  await assertSucceeds(putSession(studentDb("s1"), "after-return"));
});
test("a student who left while still pending can only come back as pending, never approved", async () => {
  await updateDoc(studentRef(studentDb("s2"), "s2"), { status: "left" });
  await assertFails(updateDoc(studentRef(studentDb("s2"), "s2"), { status: "approved" }));
  await assertSucceeds(updateDoc(studentRef(studentDb("s2"), "s2"), { status: "pending" }));
});
test("nobody approves themselves: pending -> approved and every other self-chosen status is denied", async () => {
  for (const status of ["approved", "removed", "pending"]) {
    await assertFails(updateDoc(studentRef(studentDb("s2"), "s2"), { status }));
  }
  await assertFails(updateDoc(studentRef(studentDb("s1"), "s1"), { status: "removed" }));
});
test("a student can't change anything else while changing status", async () => {
  await assertFails(updateDoc(studentRef(studentDb("s1"), "s1"), { status: "left", rosterId: "r9" }));
  await assertFails(updateDoc(studentRef(studentDb("s1"), "s1"), { status: "left", name: "Someone Else" }));
  await assertFails(updateDoc(studentRef(studentDb("s2"), "s2"), { status: "left", rosterId: "r1" }));
});
test("a student can't change another student's status", async () => {
  await assertFails(updateDoc(studentRef(studentDb("s2"), "s1"), { status: "left" }));
});
test("the teacher can remove (the record is kept) and restore, but can never set 'left'", async () => {
  await seedSession();
  const t = teacherDb("t1");
  await assertSucceeds(updateDoc(studentRef(t, "s1"), { status: "removed" }));
  const kept = await getDoc(studentRef(t, "s1"));
  ok(kept.exists() && kept.data().rosterId === "r1");
  await assertSucceeds(getDoc(doc(t, "classes/c1/students/s1/sessions/seed")));
  await assertFails(updateDoc(studentRef(t, "s1"), { status: "left" }));
  await assertSucceeds(updateDoc(studentRef(t, "s1"), { status: "approved" }));   // restored: the roster link is still there
});
test("a student the teacher removed cannot change their status, upload, or read the class; they can still read their own record", async () => {
  await updateDoc(studentRef(teacherDb("t1"), "s1"), { status: "removed" });
  const s = studentDb("s1");
  await assertFails(updateDoc(studentRef(s, "s1"), { status: "left" }));
  await assertFails(updateDoc(studentRef(s, "s1"), { status: "approved" }));
  await assertFails(putSession(s, "sneaky"));
  await assertFails(getDoc(doc(s, "classes/c1")));
  await assertSucceeds(getDoc(studentRef(s, "s1")));                               // so the extension can see it was removed
});
test("a student who left can no longer read the class document, but still reads their own record", async () => {
  await updateDoc(studentRef(studentDb("s1"), "s1"), { status: "left" });
  await assertFails(getDoc(doc(studentDb("s1"), "classes/c1")));
  await assertSucceeds(getDoc(studentRef(studentDb("s1"), "s1")));
});
test("only the class owner can delete a membership", async () => {
  await assertFails(deleteDoc(studentRef(studentDb("s2"), "s1")));
  await assertFails(deleteDoc(studentRef(teacherDb("t2"), "s1")));
  await assertSucceeds(deleteDoc(studentRef(teacherDb("t1"), "s2")));
});
test("only the class owner can delete sessions; a student cannot erase their own", async () => {
  await seedSession();
  const path = "classes/c1/students/s1/sessions/seed";
  await assertFails(deleteDoc(doc(studentDb("s1"), path)));
  await assertFails(deleteDoc(doc(teacherDb("t2"), path)));
  await assertSucceeds(deleteDoc(doc(teacherDb("t1"), path)));
});
test("the owner can delete orphaned sessions whose membership no longer exists", async () => {
  await seedSession("ghost", "orphan");
  await assertSucceeds(deleteDoc(doc(teacherDb("t1"), "classes/c1/students/ghost/sessions/orphan")));
});

// ------------------------------------------------------------------ roster + meeting overrides
test("the roster (student emails) is readable and writable only by the class owner", async () => {
  await assertFails(getDoc(doc(studentDb("s1"), "classes/c1/roster/r1")));
  await assertFails(getDocs(collection(studentDb("s1"), "classes/c1/roster")));
  await assertFails(getDoc(doc(teacherDb("t2"), "classes/c1/roster/r1")));
  await assertSucceeds(getDocs(collection(teacherDb("t1"), "classes/c1/roster")));
  await assertSucceeds(setDoc(doc(teacherDb("t1"), "classes/c1/roster/r2"), { name: "Ana", universityEmail: "ana@uni.edu", personalEmail: "" }));
  await assertFails(setDoc(doc(teacherDb("t1"), "classes/c1/roster/r3"), { name: "Ana", universityEmail: "a@u.edu", personalEmail: "", extra: 1 }));
  await assertFails(setDoc(doc(studentDb("s1"), "classes/c1/roster/r4"), { name: "Fake", universityEmail: "f@u.edu", personalEmail: "" }));
});
test("meeting window overrides are owner-only", async () => {
  const path = `classes/c1/meetings/${MEET}_2026-10-14`;
  const body = { meetCode: MEET, date: "2026-10-14", start: 1000, end: 5000 };
  await assertSucceeds(setDoc(doc(teacherDb("t1"), path), body));
  await assertFails(setDoc(doc(teacherDb("t1"), path), { ...body, end: 500 }));
  await assertFails(setDoc(doc(studentDb("s1"), path), body));
  await assertFails(getDoc(doc(studentDb("s1"), path)));
});

// ------------------------------------------------------------------ sessions
test("an approved student can upload a valid session", async () => {
  await assertSucceeds(putSession(studentDb("s1")));
});
test("a pending student cannot upload sessions", async () => {
  await assertFails(putSession(studentDb("s2"), "p1", {}, "s2"));
});
test("a student cannot upload into someone else's sessions", async () => {
  await assertFails(putSession(studentDb("s2"), "x1", {}, "s1"));
});
test("sessions can't be edited after upload, but a retried identical create is just denied (client treats as done)", async () => {
  const db = studentDb("s1");
  await assertSucceeds(putSession(db, "once"));
  await assertFails(putSession(db, "once"));
  await assertFails(updateDoc(doc(db, "classes/c1/students/s1/sessions/once"), { totals: { active: 999999 } }));
});
test("invalid sessions are rejected: unregistered meeting, wrong classId, extra field, inflated totals, bad shape, future, too long", async () => {
  const db = studentDb("s1");
  await assertFails(putSession(db, "a", { meetCode: "zzz-zzzz-zzz" }));
  await assertFails(putSession(db, "b", { classId: "c2" }));
  await assertFails(putSession(db, "c", { isPresent: true }));
  await assertFails(putSession(db, "d", { totals: { active: 9999999 } }));                     // more than the session lasted
  await assertFails(putSession(db, "e", { totals: { active: -5 } }));
  await assertFails(putSession(db, "f", { totals: { cheating: 1 } }));
  await assertFails(putSession(db, "g", { start: Date.now() + 600000, end: Date.now() + 1200000 }));
  await assertFails(putSession(db, "h", { start: Date.now() - 50000000, end: Date.now() - 1000, totals: {} })); // > 12h
  await assertFails(putSession(db, "i", { start: 5, end: 5 }));
  await assertFails(putSession(db, "j", { uploadedAt: 123 }));
});
test("session reads: student sees own, not others'; owner sees all; other teachers see none", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "classes/c1/students/s1/sessions/seed"), { ...session(), uploadedAt: 1 });
  });
  const path = "classes/c1/students/s1/sessions/seed";
  await assertSucceeds(getDoc(doc(studentDb("s1"), path)));
  await assertFails(getDoc(doc(studentDb("s2"), path)));
  await assertSucceeds(getDoc(doc(teacherDb("t1"), path)));
  await assertFails(getDoc(doc(teacherDb("t2"), path)));
});
test("the report query (collection group, classId == X): owner yes; other teacher and students no", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "classes/c1/students/s1/sessions/seed"), { ...session(), uploadedAt: 1 });
  });
  const q = (db, classId) => query(collectionGroup(db, "sessions"), where("classId", "==", classId), where("start", ">=", 0));
  await assertSucceeds(getDocs(q(teacherDb("t1"), "c1")));
  await assertFails(getDocs(q(teacherDb("t2"), "c1")));
  await assertFails(getDocs(q(studentDb("s1"), "c1")));
  await assertFails(getDocs(collectionGroup(teacherDb("t1"), "sessions")));   // unfiltered query is not allowed
});
