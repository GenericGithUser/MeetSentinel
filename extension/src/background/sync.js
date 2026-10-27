import { KEYS, MEMBERSHIP_REFRESH_MS, UPLOAD_BATCH, INACTIVE_STATUSES } from "../shared/constants.js";
import { firebaseConfigured } from "../firebase/app.js";
import { refreshMembership } from "../firebase/classes.js";
import { uploadSession } from "../firebase/sessions.js";
import { getSignedInUser } from "../firebase/auth.js";
import { readOutbox, removeFromOutbox } from "./outbox.js";

let running = false;

// Called by the 5-minute alarm, right after a session ends, and after the options page changes anything.
//  - pending approval  -> re-check membership each run (2 Firestore reads)
//  - approved          -> re-check hourly, upload the outbox
//  - removed / left / no class -> do nothing
export async function syncAndUpload() {
  if (!firebaseConfigured || running) return;
  running = true;
  try {
    const s = await chrome.storage.local.get([KEYS.CLASS, KEYS.MEMBERSHIP]);
    const cls = s[KEYS.CLASS];
    if (!cls) return;

    let status = s[KEYS.MEMBERSHIP]?.status ?? "pending";
    if (INACTIVE_STATUSES.has(status)) return;

    const stale = !s[KEYS.MEMBERSHIP]?.checkedAt || Date.now() - s[KEYS.MEMBERSHIP].checkedAt > MEMBERSHIP_REFRESH_MS;
    if (status === "pending" || stale) {
      const fresh = await refreshMembership();
      status = fresh?.status ?? status;
    }
    if (status !== "approved") return;

    const user = await getSignedInUser();
    if (!user) return; // student has not signed in on the options page yet

    const batch = (await readOutbox()).slice(0, UPLOAD_BATCH);
    const accepted = [];
    for (const rec of batch) {
      const result = await uploadSession(cls.classId, user.uid, rec);
      if (result === "done") accepted.push(rec.id);
      else if (result === "removed") break; // refreshMembership will pick this up next run
      else break;                            // "retry": network trouble, try again next alarm
    }
    if (accepted.length) await removeFromOutbox(accepted);
  } catch (e) {
    console.error("[sync]", e);
  } finally {
    running = false;
  }
}
