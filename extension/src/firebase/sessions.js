import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { getFirebase } from "./app.js";

// Uploads one finished session. The document ID is the session's UUID, and rules allow create but not update,
// so a retried upload of the same session can never create a duplicate.
// Returns: "done" (stored, or already stored) | "removed" (no longer a class member) | "retry" (try again later)
export async function uploadSession(classId, uid, rec) {
  const { db } = getFirebase();
  const ref = doc(db, "classes", classId, "students", uid, "sessions", rec.id);

  try {
    await setDoc(ref, {
      classId,
      meetCode: rec.meetCode,
      start: rec.start,
      end: rec.end,
      totals: rec.totals,
      uploadedAt: serverTimestamp()
    });
    return "done";
  } catch (e) {
    if (e.code !== "permission-denied") return "retry";

    // Denied can mean "already uploaded" (update blocked by rules) or "removed from the class". Disambiguate.
    try {
      const member = await getDoc(doc(db, "classes", classId, "students", uid));
      if (member.exists() && member.data().status === "approved") return "done";
      return member.exists() ? "retry" : "removed";
    } catch {
      return "retry";
    }
  }
}

// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.
