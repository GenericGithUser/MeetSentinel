// Shared by background, popup and options. NOT imported by the content script (it must stay import-free).

// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.

// DEV ONLY switch (see .env.example). When true, every Meet meeting is tracked, with no class or consent required.
export const DEV_TRACK_ALL = import.meta.env.VITE_TRACK_ALL_MEETINGS === "true";

// Bump this when the consent text in options.html changes; students will be asked to accept again.
export const CONSENT_VERSION = 1;

// chrome.storage.local keys
export const KEYS = {
  SESSION: "session",        // the open session, or null
  OUTBOX: "sessions",        // finished sessions waiting to upload
  HISTORY: "history",        // finished sessions kept on this computer so the student can review them (never uploaded from here)
  CLASS: "classConfig",      // { classId, className, meetCodes: [] }
  MEMBERSHIP: "membership",  // { status: "pending" | "approved" | "removed", checkedAt }
  PROFILE: "profile",        // { name, email }
  CONSENT: "consent"         // { version, acceptedAt }
};

export const NOTE_HOSTS = [
  "docs.google.com", "keep.google.com", "www.notion.so", "notion.so",
  "evernote.com", "www.onenote.com", "onenote.com"
];

// ---- Tracking tunables ----
export const GRACE_MS = 3000;        // a non-active state must last this long before we leave "active"
export const STALE_MS = 90000;       // no heartbeat for this long (sleep / browser closed) -> end session at last known time
export const MIN_SESSION_MS = 5000;  // shorter sessions are discarded as noise
export const MAX_SESSIONS = 200;     // cap on the unsent outbox
export const MAX_HISTORY = 300;      // cap on the local records the student can review
export const DEFAULT_THRESHOLD = 0.9; // used until the class's own target has been fetched

// States that are never recorded: no session exists and nothing is stored.
// Add "not_in_meeting" to also drop lobby / post-call time.
export const UNTRACKED = new Set(["no_meet_tab"]);
// States that are not inside a call; these switch immediately (no grace period).
export const OUTSIDE_CALL = new Set(["no_meet_tab", "not_in_meeting"]);

// ---- Sync tunables ----
export const SYNC_PERIOD_MIN = 5;                 // how often the sync alarm fires
export const MEMBERSHIP_REFRESH_MS = 60 * 60e3;   // re-read class config this often once approved (Firestore reads are quota-limited)
export const UPLOAD_BATCH = 25;                   // max sessions uploaded per sync run

// States that count as "focused" for attendance. Keep in sync with web/src/lib/attendance.js and firestore.rules.
export const FOCUS_STATES = ["active", "notes_tab_focused"];

// Membership statuses in which this install tracks nothing and uploads nothing.
export const INACTIVE_STATUSES = new Set(["removed", "left"]);

export const STATE_LABELS = {
  active: "Focused on Meet",
  visible_unfocused: "Meet visible (not focused)",
  notes_tab_focused: "Taking notes (web)",
  page_hidden: "Meet tab hidden",
  other_tab_focused: "Other tab focused",
  minimized: "Browser minimized",
  browser_not_focused: "Browser not focused",
  not_in_meeting: "Not in a call",
  no_meet_tab: "No Meet tab open"
};
