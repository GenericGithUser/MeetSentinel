// The student's own view of how focused they were, per meeting. Pure functions, no browser APIs (tested in Node).
//
//   focus % = (time in "active" + "notes_tab_focused") / the span of the meeting
//
// "Span" runs from the first moment this browser had the meeting open to the last. A gap between sessions
// (a dropped connection, closing and reopening the tab) counts against the percentage, exactly as it does in the
// teacher's report. IMPORTANT: the teacher measures against the whole class meeting, which can start earlier or end
// later than this student's own session, so the teacher's official figure can be lower than this one.
import { FOCUS_STATES } from "./constants.js";

const pad = (n) => String(n).padStart(2, "0");
export function localDateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// How time is grouped in the breakdown bar. Every tracked state belongs to exactly one group.
export const GROUPS = [
  { id: "focused", label: "Focused on Meet",           states: ["active"] },
  { id: "notes",   label: "Taking notes",              states: ["notes_tab_focused"] },
  { id: "visible", label: "Meet visible, not focused", states: ["visible_unfocused"] },
  { id: "away",    label: "Away from Meet",            states: ["other_tab_focused", "minimized", "browser_not_focused", "page_hidden"] },
  { id: "outside", label: "Not in the call",           states: ["not_in_meeting"] } // plus any gap between sessions
];

const sumStates = (byState, states) => states.reduce((a, k) => a + (Number(byState[k]) || 0), 0);

// Time per group for a set of per-state totals (used for the popup's live view too).
export function groupTotals(byState, extraOutsideMs = 0) {
  return GROUPS.map((g) => ({ id: g.id, label: g.label, ms: sumStates(byState, g.states) + (g.id === "outside" ? extraOutsideMs : 0) }));
}

function buildMeeting(list) {
  const start = Math.min(...list.map((s) => s.start));
  const end = Math.max(...list.map((s) => s.end));
  const span = end - start;

  const byState = {};
  let attended = 0;
  for (const s of list) {
    attended += s.end - s.start;
    for (const [k, v] of Object.entries(s.totals || {})) byState[k] = (byState[k] || 0) + (Number(v) || 0);
  }
  const gapMs = Math.max(0, span - attended);
  const focusedMs = sumStates(byState, FOCUS_STATES);

  return {
    key: `${list[0].meetCode}_${localDateKey(list[0].start)}`,
    meetCode: list[0].meetCode,
    date: localDateKey(list[0].start),
    start, end, span,
    sessions: list.length,
    ids: list.map((s) => s.id),
    byState, gapMs, focusedMs,
    pct: span > 0 ? Math.min(1, focusedMs / span) : 0,
    parts: groupTotals(byState, gapMs).map((p) => ({ ...p, share: span > 0 ? p.ms / span : 0 }))
  };
}

// One meeting per (Meet code, calendar day), newest first. Same grouping as the teacher's report.
export function groupMeetings(history) {
  const map = new Map();
  for (const s of history || []) {
    if (!(s.end > s.start)) continue;
    const key = `${s.meetCode}_${localDateKey(s.start)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  return [...map.values()].map(buildMeeting).sort((a, b) => b.start - a.start);
}

export const meetsTarget = (pct, threshold) => pct + 1e-9 >= threshold;

export function summarize(meetings, threshold) {
  const count = meetings.length;
  return {
    count,
    avgPct: count ? meetings.reduce((a, m) => a + m.pct, 0) / count : null,
    meetsCount: meetings.filter((m) => meetsTarget(m.pct, threshold)).length
  };
}

// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.