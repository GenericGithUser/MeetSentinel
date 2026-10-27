import { h, clear } from "../shared/dom.js";
import { groupMeetings, summarize, meetsTarget, GROUPS } from "../shared/records.js";
import { fmtDay, fmtClock, fmtDuration, fmtHMS, pctText } from "../shared/format.js";
import { STATE_LABELS } from "../shared/constants.js";

// The student's own records, one card per meeting.
//   history: finished sessions kept on this computer   outbox: ones not yet uploaded
//   cls: class config or null                           threshold: the target (0..1)
export function renderRecords(root, { history, outbox, cls, threshold, onClear }) {
  clear(root);
  const meetings = groupMeetings(history);
  const waiting = new Set((outbox || []).map((s) => s.id));

  if (!meetings.length) {
    root.append(h("div", { class: "empty" },
      h("h2", {}, "No meetings recorded yet"),
      h("p", {}, cls
        ? "After you attend a class meeting with MeetSentinel installed, it appears here with how focused you were."
        : "Join a class first (Class tab). After you attend one of its meetings, it appears here with how focused you were.")));
    return;
  }

  const sum = summarize(meetings, threshold);
  root.append(
    h("div", { class: "stats" },
      stat(String(sum.count), sum.count === 1 ? "meeting recorded" : "meetings recorded"),
      stat(pctText(sum.avgPct), "average focus"),
      cls ? stat(`${sum.meetsCount} of ${sum.count}`, `meet the ${pctText(threshold)} target`) : null),
    h("p", { class: "note" },
      "Focus is the share of the meeting that the Meet tab (or a note-taking web app) was in front of you. ",
      "Your teacher measures against the whole class meeting, so arriving late or leaving early can lower the official figure below what's shown here. ",
      "These records are stored on this computer only.")
  );

  for (const m of meetings) root.append(card(m, { cls, threshold, waiting }));

  root.append(h("div", { class: "dataRow" },
    h("span", { class: "hint" }, "Deleting removes these records from this computer. Meetings already sent to your teacher stay with your teacher."),
    h("button", { type: "button", class: "danger small", onclick: onClear }, "Delete records on this computer")));
}

const stat = (big, label) => h("div", { class: "stat" }, h("strong", {}, big), h("span", {}, label));

function card(m, { cls, threshold, waiting }) {
  const meets = meetsTarget(m.pct, threshold);
  const pending = m.ids.filter((id) => waiting.has(id)).length;
  const dot = (id) => h("span", { class: `sw g-${id}` });

  // Every state with time in it, plus the gap between sessions if there was one.
  const rows = Object.entries(m.byState).filter(([, ms]) => ms > 0).sort((a, b) => b[1] - a[1])
    .map(([k, ms]) => {
      const g = GROUPS.find((x) => x.states.includes(k));
      return h("tr", {}, h("td", {}, dot(g ? g.id : "outside"), STATE_LABELS[k] || k), h("td", { class: "num" }, fmtHMS(ms)), h("td", { class: "num" }, pctText(ms / m.span)));
    });
  if (m.gapMs > 0) rows.push(h("tr", {}, h("td", {}, dot("outside"), "Between sessions (disconnected)"), h("td", { class: "num" }, fmtHMS(m.gapMs)), h("td", { class: "num" }, pctText(m.gapMs / m.span))));

  return h("article", { class: "meeting", "aria-label": `Meeting on ${fmtDay(m.start)}` },
    h("div", { class: "mHead" },
      h("div", {},
        h("div", { class: "mWhen" }, fmtDay(m.start)),
        h("div", { class: "mMeta" }, `${fmtClock(m.start)}–${fmtClock(m.end)} · ${fmtDuration(m.span)} · ${m.meetCode}`)),
      h("div", { class: "mScore" },
        h("span", { class: `pctBig ${cls ? (meets ? "meets" : "below") : ""}` }, pctText(m.pct)),
        cls ? h("span", { class: `badge ${meets ? "ok" : "warn"}` }, meets ? `Meets ${pctText(threshold)} target` : `Below ${pctText(threshold)} target`) : null)),
    h("div", { class: "bar", role: "img", "aria-label": m.parts.map((p) => `${p.label} ${pctText(p.share)}`).join(", ") },
      m.parts.filter((p) => p.ms > 0).map((p) => h("span", { class: `g-${p.id}`, style: `flex: ${p.ms} 0 0`, title: `${p.label}: ${pctText(p.share)}` }))),
    h("ul", { class: "legend" }, m.parts.filter((p) => p.ms > 0).map((p) =>
      h("li", {}, dot(p.id), `${p.label} ${pctText(p.share)} (${fmtDuration(p.ms)})`))),
    h("details", {}, h("summary", {}, "Details"),
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "State"), h("th", { class: "num" }, "Time"), h("th", { class: "num" }, "Share"))), h("tbody", {}, rows))),
    h("div", { class: "mFoot" },
      h("span", {}, m.sessions > 1 ? `${m.sessions} sessions (you reconnected)` : "1 session"),
      h("span", {}, !cls ? "" : pending ? `${pending} waiting to upload` : "Sent to your teacher"))
  );
}


// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.