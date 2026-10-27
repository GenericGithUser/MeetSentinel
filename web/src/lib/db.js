import {
  collection, collectionGroup, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch,
  query, where, serverTimestamp
} from "firebase/firestore";
import { db } from "./firebase.js";
import { generateJoinCode } from "./codes.js";
import { rosterIdFor } from "./csv.js";
import { DEFAULT_THRESHOLD } from "./attendance.js";

// Data model and the rules that protect it: see ../../../firestore.rules

const withId = (snap) => ({ id: snap.id, ...snap.data() });
const CHUNK = 400; // Firestore allows 500 operations per batch

async function commitInChunks(ops) {
  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + CHUNK)) op(batch);
    await batch.commit();
  }
}

// ---------------------------------------------------------------- classes
export async function listMyClasses(uid) {
  const snap = await getDocs(query(collection(db, "classes"), where("ownerUid", "==", uid)));
  return snap.docs.map(withId).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getClass(classId) {
  const snap = await getDoc(doc(db, "classes", classId));
  return snap.exists() ? withId(snap) : null;
}

// The class and its join code are written in one batch. If the random code collides with an existing one the
// rules reject the batch (join codes are create-only), so we simply try a new code.
export async function createClass({ uid, name, meetCodes }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const classRef = doc(collection(db, "classes"));
    const joinCode = generateJoinCode();
    const batch = writeBatch(db);
    batch.set(classRef, { name, ownerUid: uid, joinCode, meetCodes, threshold: DEFAULT_THRESHOLD, createdAt: serverTimestamp() });
    batch.set(doc(db, "joinCodes", joinCode), { classId: classRef.id });
    try {
      await batch.commit();
      return { id: classRef.id, joinCode };
    } catch (e) {
      if (e.code !== "permission-denied") throw e;
    }
  }
  throw new Error("Couldn't create the class. If this keeps happening, check that the Firestore rules are deployed.");
}

export const updateClass = (classId, patch) => updateDoc(doc(db, "classes", classId), patch);

// New students need the new code; students already in the class are unaffected.
export async function rotateJoinCode(classId, oldCode) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const joinCode = generateJoinCode();
    const batch = writeBatch(db);
    batch.delete(doc(db, "joinCodes", oldCode));
    batch.set(doc(db, "joinCodes", joinCode), { classId });
    batch.update(doc(db, "classes", classId), { joinCode });
    try {
      await batch.commit();
      return joinCode;
    } catch (e) {
      if (e.code !== "permission-denied") throw e;
    }
  }
  throw new Error("Couldn't generate a new code. Try again.");
}

// ---------------------------------------------------------------- students
export async function listStudents(classId) {
  const snap = await getDocs(collection(db, "classes", classId, "students"));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}
export const approveStudent = (classId, uid, rosterId) =>
  updateDoc(doc(db, "classes", classId, "students", uid), { status: "approved", rosterId });

// "removed" keeps the record and its sessions (attendance already earned still counts); "approved" restores it.
// Students set "left" themselves; the rules don't let a teacher write it.
export const setStudentStatus = (classId, uid, status) =>
  updateDoc(doc(db, "classes", classId, "students", uid), { status });

// Rejecting a PENDING request: there is nothing to keep, so the record is deleted.
export const rejectRequest = (classId, uid) => deleteDoc(doc(db, "classes", classId, "students", uid));

export async function countSessions(classId, uid) {
  const snap = await getDocs(collection(db, "classes", classId, "students", uid, "sessions"));
  return snap.size;
}

// Deletes a student's record AND all their sessions. Sessions go first: they live under the membership, and once the
// membership is gone they can no longer be attributed to anyone. Returns how many sessions were deleted.
export async function deleteStudentAndRecords(classId, uid) {
  const snap = await getDocs(collection(db, "classes", classId, "students", uid, "sessions"));
  await commitInChunks(snap.docs.map((d) => (b) => b.delete(d.ref)));
  await deleteDoc(doc(db, "classes", classId, "students", uid));
  return snap.size;
}

// items: [{ uid, id }]. Used to clear orphaned sessions (their membership no longer exists).
export const deleteSessions = (classId, items) =>
  commitInChunks(items.map(({ uid, id }) => (b) => b.delete(doc(db, "classes", classId, "students", uid, "sessions", id))));

// ---------------------------------------------------------------- roster
export async function listRoster(classId) {
  const snap = await getDocs(collection(db, "classes", classId, "roster"));
  return snap.docs.map(withId).sort((a, b) => a.name.localeCompare(b.name));
}

// Upserts by stable id (primary email) and deletes rows that are gone, so existing student links stay valid.
export async function replaceRoster(classId, rows) {
  const existing = await listRoster(classId);
  const keep = new Set(rows.map(rosterIdFor));
  const ops = [];
  for (const row of rows) {
    ops.push((b) => b.set(doc(db, "classes", classId, "roster", rosterIdFor(row)), {
      name: row.name, universityEmail: row.universityEmail, personalEmail: row.personalEmail
    }));
  }
  for (const old of existing) {
    if (!keep.has(old.id)) ops.push((b) => b.delete(doc(db, "classes", classId, "roster", old.id)));
  }
  await commitInChunks(ops);
  return { saved: rows.length, removed: existing.filter((o) => !keep.has(o.id)).length };
}

// ---------------------------------------------------------------- sessions + meeting overrides
// One collection-group query for the whole class. Needs the composite index in firestore.indexes.json.
export async function fetchSessions(classId, fromMs, toMs) {
  const q = query(
    collectionGroup(db, "sessions"),
    where("classId", "==", classId),
    where("start", ">=", fromMs),
    where("start", "<=", toMs)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, uid: d.ref.parent.parent.id, ...d.data() }));
}

export async function listOverrides(classId) {
  const snap = await getDocs(collection(db, "classes", classId, "meetings"));
  return Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
}
export const setOverride = (classId, key, data) => setDoc(doc(db, "classes", classId, "meetings", key), data);
export const deleteOverride = (classId, key) => deleteDoc(doc(db, "classes", classId, "meetings", key));


// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.