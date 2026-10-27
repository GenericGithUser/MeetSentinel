import { DEV_TRACK_ALL, KEYS, INACTIVE_STATUSES } from "../shared/constants.js";

const CODE_SHAPE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

// Returns the meeting code ("abc-defg-hij") of a Google Meet URL, or null.
// The code can sit at different places in the path (meet.google.com/abc-defg-hij, .../meet/abc-defg-hij, .../u/1/...),
// so this looks at every path segment instead of assuming a position. Query strings and fragments never matter.
export function extractMeetCode(url = "") {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" || u.hostname !== "meet.google.com") return null;
  for (const segment of u.pathname.split("/")) {
    const s = segment.toLowerCase();
    if (CODE_SHAPE.test(s)) return s;
  }
  return null;
}

// Teachers may register codes with or without hyphens, in any case.
export const normalizeCode = (c) => String(c).toLowerCase().replace(/[^a-z]/g, "");

// Decides which Meet meetings are tracked at all:
//  - dev switch on            -> all meetings
//  - no class or no consent   -> nothing
//  - removed from / left class -> nothing
//  - otherwise                -> only the meeting codes the teacher registered for the class
export async function getTrackingConfig() {
  if (DEV_TRACK_ALL) return { all: true, codes: new Set() };

  const s = await chrome.storage.local.get([KEYS.CLASS, KEYS.CONSENT, KEYS.MEMBERSHIP]);
  const cls = s[KEYS.CLASS];
  if (!cls || !s[KEYS.CONSENT]) return { all: false, codes: new Set() };
  if (INACTIVE_STATUSES.has(s[KEYS.MEMBERSHIP]?.status)) return { all: false, codes: new Set() };

  return { all: false, codes: new Set((cls.meetCodes || []).map(normalizeCode)) };
}

export function isTrackedMeet(tab, cfg) {
  const code = extractMeetCode(tab?.url);
  if (!code) return false;
  return cfg.all || cfg.codes.has(normalizeCode(code));
}
