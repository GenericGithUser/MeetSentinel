import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { getFirebase } from "./app.js";
import { ensureSignedIn, getSignedInUser } from "./auth.js";
import { uploadSession } from "./sessions.js";
import { KEYS, CONSENT_VERSION, INACTIVE_STATUSES } from "../shared/constants.js";

// Firestore data model (see README for what the security rules must enforce):
//   joinCodes/{code}                              { classId }                      get-only, never list
//   classes/{classId}                             { name, ownerUid, joinCode, meetCodes[], threshold, createdAt }
//   classes/{classId}/students/{uid}              { name, email, joinCode, status, rosterId?, createdAt }
//       status: pending | approved | left (the student left) | removed (the teacher removed them)
//   classes/{classId}/students/{uid}/sessions/{id}{ classId, meetCode, start, end, totals, uploadedAt }
//
// A membership is NEVER deleted from here. Its sessions live under it, so deleting it would orphan the student's
// attendance record. Leaving marks it "left"; the record and its roster link stay, and rejoining picks them up again.

export const normalizeJoinCode = (raw) => String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
export const normalizeEmail = (raw) => String(raw).trim().toLowerCase();

// OPTIONS PAGE. Creates this install's pending membership, or re-opens the one it already has:
//   left + was approved before -> approved again (the teacher already vetted this identity and roster link)
//   left + never approved      -> pending
//   removed by the teacher     -> refused: only the teacher can let them back in
export async function joinClass({ code, name, email }) {
  const { db } = getFirebase();
  const user = await ensureSignedIn();

  const joinCode = normalizeJoinCode(code);
  const codeSnap = await getDoc(doc(db, "joinCodes", joinCode));
  if (!codeSnap.exists()) throw new Error("That class code wasn't found. Check it and try again.");
  const classId = codeSnap.data().classId;

  const memberRef = doc(db, "classes", classId, "students", user.uid);
  const existing = await getDoc(memberRef);
  let status = "pending";
  let profile = { name: name.trim(), email: normalizeEmail(email) };

  if (!existing.exists()) {
    await setDoc(memberRef, {
      name: profile.name,
      email: profile.email,
      joinCode,
      status: "pending", // only the teacher can approve (enforced by the rules)
      createdAt: serverTimestamp()
    });
  } else {
    const d = existing.data();
    if (d.status === "removed") throw new Error("Your teacher removed you from this class. Ask them to let you back in.");
    status = d.status;
    if (d.status === "left") {
      status = d.rosterId ? "approved" : "pending";
      await updateDoc(memberRef, { status });
    }
    profile = { name: d.name, email: d.email }; // what the teacher matched, not whatever was typed this time
  }

  await chrome.storage.local.set({
    [KEYS.PROFILE]: profile,
    [KEYS.CONSENT]: { version: CONSENT_VERSION, acceptedAt: Date.now() },
    [KEYS.CLASS]: { classId, className: "", meetCodes: [] },
    [KEYS.MEMBERSHIP]: { status, checkedAt: 0 }
  });
  return refreshMembership();
}

// Reads this student's membership + the class config (name, registered Meet codes) into chrome.storage.
// Costs 2 Firestore reads plus rule-evaluation reads, so callers throttle it.
export async function refreshMembership() {
  const s = await chrome.storage.local.get(KEYS.CLASS);
  const cls = s[KEYS.CLASS];
  if (!cls) return null;

  const user = await getSignedInUser();
  if (!user) return null;
  const { db } = getFirebase();

  const memberSnap = await getDoc(doc(db, "classes", cls.classId, "students", user.uid));
  const status = memberSnap.exists() ? memberSnap.data().status : "removed"; // no record at all: the teacher rejected the request
  const membership = { status, checkedAt: Date.now() };
  await chrome.storage.local.set({ [KEYS.MEMBERSHIP]: membership });

  if (!INACTIVE_STATUSES.has(status)) {
    try {
      const classSnap = await getDoc(doc(db, "classes", cls.classId));
      if (classSnap.exists()) {
        const d = classSnap.data();
        await chrome.storage.local.set({
          [KEYS.CLASS]: {
            classId: cls.classId, className: d.name || "", meetCodes: d.meetCodes || [],
            threshold: typeof d.threshold === "number" ? d.threshold : undefined
          }
        });
      }
    } catch (e) {
      // Rules may hide the class document until approval; keep the previous config.
      console.warn("[classes] class config not readable yet:", e.code || e.message);
    }
  }
  return membership;
}

// OPTIONS PAGE. Leaves the class. Order matters:
//   1. while still approved, send any finished meetings that haven't been uploaded (after leaving they could never be)
//   2. mark the membership "left". It is KEPT, with its sessions and roster link. The signed-in identity is kept too,
//      so rejoining reconnects to the same record.
//   3. wipe this browser's class data, local records and queue.
// Returns { sent, unsent, markedLeft } so the page can tell the student what happened.
export async function leaveClass() {
  const s = await chrome.storage.local.get([KEYS.CLASS, KEYS.MEMBERSHIP, KEYS.OUTBOX]);
  const cls = s[KEYS.CLASS];
  const outbox = s[KEYS.OUTBOX] || [];
  let sent = 0;
  let markedLeft = false;

  try {
    if (cls) {
      const user = await getSignedInUser({ waitMs: 0 });
      if (user) {
        if (s[KEYS.MEMBERSHIP]?.status === "approved") {
          for (const rec of outbox) {
            if ((await uploadSession(cls.classId, user.uid, rec)) !== "done") break; // offline: stop, report the rest as unsent
            sent++;
          }
        }
        const { db } = getFirebase();
        const ref = doc(db, "classes", cls.classId, "students", user.uid);
        const snap = await getDoc(ref);
        if (snap.exists() && ["pending", "approved"].includes(snap.data().status)) {
          await updateDoc(ref, { status: "left" });
          markedLeft = true;
        }
      }
    }
  } catch (e) {
    console.warn("[classes] couldn't tell the server you left; clearing local data anyway:", e.code || e.message);
  }

  await chrome.storage.local.remove([KEYS.CLASS, KEYS.MEMBERSHIP, KEYS.PROFILE, KEYS.CONSENT, KEYS.OUTBOX, KEYS.SESSION, KEYS.HISTORY]);
  return { sent, unsent: outbox.length - sent, markedLeft };
}


// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.