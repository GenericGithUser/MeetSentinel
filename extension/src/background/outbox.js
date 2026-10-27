import { KEYS } from "../shared/constants.js";
import { serial } from "./queue.js";

export async function readOutbox() {
  const s = await chrome.storage.local.get({ [KEYS.OUTBOX]: [] });
  return s[KEYS.OUTBOX];
}

// Remove only the records that were actually accepted. Re-reads inside the lock, so sessions that
// finished while an upload was in flight are never lost.
export function removeFromOutbox(ids) {
  const drop = new Set(ids);
  return serial(async () => {
    const outbox = await readOutbox();
    await chrome.storage.local.set({ [KEYS.OUTBOX]: outbox.filter((s) => !drop.has(s.id)) });
  });
}
