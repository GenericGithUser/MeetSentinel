// MeetSentinel attendance policy.
//
//   A student is PRESENT for a meeting when
//        focused time / meeting duration  >=  threshold          (default 90%)
//   where
//        focused time     = time in "active" + time in "notes_tab_focused", across the student's sessions,
//        meeting duration = end - start of the meeting window.
//
// The denominator is the WHOLE meeting, so anything that isn't focus time is deducted from the percentage:
// other tabs, minimized, another app, late arrival, early exit, the lobby, a dropped connection.
// "Meet visible but not focused" does not count as focus.


// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.


export const FOCUS_STATES = ["active", "notes_tab_focused"]; // keep in sync with extension/src/shared/constants.js
export const DEFAULT_THRESHOLD = 0.9;

const pad = (n) => String(n).padStart(2, "0");
export function localDateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const sumFocus = (totals) => FOCUS_STATES.reduce((s, k) => s + (Number(totals?.[k]) || 0), 0);

// Groups sessions into meetings: one meeting per (meeting code, calendar day in the teacher's timezone).
// The window defaults to the earliest session start .. latest session end, and the teacher can override it
// per meeting (overrides: { [meetingKey]: { start, end } }).
//   sessions: [{ uid, meetCode, start, end, totals }]
export function groupMeetings(sessions, overrides = {}) {
  const map = new Map();
  for (const s of sessions) {
    const key = `${s.meetCode}_${localDateKey(s.start)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  const meetings = [];
  for (const [key, list] of map) {
    const derivedStart = Math.min(...list.map((s) => s.start));
    const derivedEnd = Math.max(...list.map((s) => s.end));
    const ov = overrides[key];
    meetings.push({
      key,
      meetCode: list[0].meetCode,
      date: localDateKey(list[0].start),
      start: ov ? ov.start : derivedStart,
      end: ov ? ov.end : derivedEnd,
      derived: !ov,
      derivedStart, derivedEnd,
      sessions: list
    });
  }
  return meetings.sort((a, b) => a.start - b.start);
}

// Focus time of one session that falls inside the window. Sessions only store per-state totals (not a timeline),
// so a session that sticks out of the window is clipped proportionally.
export function focusedMsInWindow(session, windowStart, windowEnd) {
  const dur = session.end - session.start;
  if (dur <= 0) return 0;
  const overlap = Math.max(0, Math.min(session.end, windowEnd) - Math.max(session.start, windowStart));
  return sumFocus(session.totals) * (overlap / dur);
}

// Score one linked device (uid) for one meeting.
export function scoreDevice(sessions, meeting) {
  const duration = meeting.end - meeting.start;
  let focusedMs = 0, first = Infinity, last = -Infinity;
  for (const s of sessions) {
    if (s.meetCode !== meeting.meetCode) continue;
    if (Math.min(s.end, meeting.end) <= Math.max(s.start, meeting.start)) continue; // no overlap with the window
    focusedMs += focusedMsInWindow(s, meeting.start, meeting.end);
    first = Math.min(first, Math.max(s.start, meeting.start));
    last = Math.max(last, Math.min(s.end, meeting.end));
  }
  const pct = duration > 0 ? Math.min(1, focusedMs / duration) : 0;
  return {
    focusedMs, pct,
    joinedLateMs: Number.isFinite(first) ? Math.max(0, first - meeting.start) : null,
    leftEarlyMs: Number.isFinite(last) ? Math.max(0, meeting.end - last) : null
  };
}

// Attendance for every roster row across every meeting.
//   roster:  [{ id, name, universityEmail, personalEmail }]
//   members: students [{ uid, rosterId, status }]   (several devices may map to one roster row; former ones still count)
//   returns { meetings, rows: [{ roster, cells: [{ status, pct, ... }], presentCount, avgPct }] }
// status: "present" | "absent" | "no_device" (no approved device linked to this roster row, so nothing can be known)
export function computeAttendance({ sessions, members, roster, overrides = {}, threshold = DEFAULT_THRESHOLD }) {
  const meetings = groupMeetings(sessions, overrides);
  // Every device that was ever approved for a roster row counts (it has a rosterId), whatever its status now: a student
  // who left, or whom the teacher removed, keeps the attendance already earned. Pending requests have no rosterId.
  const uidsByRoster = new Map();
  const activeByRoster = new Map();
  for (const m of members) {
    if (!m.rosterId) continue;
    if (!uidsByRoster.has(m.rosterId)) uidsByRoster.set(m.rosterId, []);
    uidsByRoster.get(m.rosterId).push(m.uid);
    if (m.status === "approved") activeByRoster.set(m.rosterId, (activeByRoster.get(m.rosterId) ?? 0) + 1);
  }

  const rows = roster.map((r) => {
    const uids = uidsByRoster.get(r.id) ?? [];
    const cells = meetings.map((meeting) => {
      if (!uids.length) return { status: "no_device", pct: null };
      // Take the best device, never the sum: two devices open at once must not double-count focus time.
      let best = { focusedMs: 0, pct: 0, joinedLateMs: null, leftEarlyMs: null };
      for (const uid of uids) {
        const mine = meeting.sessions.filter((s) => s.uid === uid);
        const score = scoreDevice(mine, meeting);
        if (score.pct >= best.pct) best = score;
      }
      return { status: best.pct + 1e-9 >= threshold ? "present" : "absent", ...best };
    });
    const known = cells.filter((c) => c.pct !== null);
    return {
      roster: r,
      devices: uids.length,
      activeDevices: activeByRoster.get(r.id) ?? 0,
      cells,
      presentCount: cells.filter((c) => c.status === "present").length,
      avgPct: known.length ? known.reduce((s, c) => s + c.pct, 0) / known.length : null
    };
  });

  return { meetings, rows };
}

// CSV text for download.
export function attendanceToCsv({ meetings, rows }, formatWindow = (m) => `${m.date} ${m.meetCode}`) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["Name", "University email", "Personal email",
    ...meetings.map(formatWindow), "Meetings present", "Average focus %"];
  const lines = [header.map(esc).join(",")];
  for (const r of rows) {
    const cells = r.cells.map((c) => c.status === "no_device" ? "no device" : `${Math.round(c.pct * 100)}% ${c.status}`);
    lines.push([r.roster.name, r.roster.universityEmail, r.roster.personalEmail, ...cells,
      `${r.presentCount}/${meetings.length}`, r.avgPct === null ? "" : Math.round(r.avgPct * 100)].map(esc).join(","));
  }
  return lines.join("\n");
}
