import { KEYS, STATE_LABELS, FOCUS_STATES, OUTSIDE_CALL, DEV_TRACK_ALL, DEFAULT_THRESHOLD } from "../shared/constants.js";
import { groupMeetings, groupTotals, meetsTarget } from "../shared/records.js";
import { h, clear } from "../shared/dom.js";
import { fmtHMS, fmtDay, fmtClock, fmtDuration, pctText } from "../shared/format.js";
import { openPage } from "../shared/nav.js";
import { getTrackingConfig, isTrackedMeet, extractMeetCode } from "../background/tracking.js";

// Tell the background worker the popup is open, so it ignores the focus change the popup itself causes
chrome.runtime.connect({ name: "popup" });

const GOOD = new Set(["active"]);
const WARN = new Set(["visible_unfocused", "notes_tab_focused"]);
const $ = (id) => document.getElementById(id);

function classLine(cls, membership) {
  if (!cls) return DEV_TRACK_ALL ? "Dev mode: tracking every Meet meeting." : "You haven't joined a class yet. Open Settings to join one.";
  const name = cls.className || "your class";
  const status = membership?.status ?? "pending";
  if (status === "approved") return `Reporting to ${name}.`;
  if (status === "removed") return `You were removed from ${name}. Nothing is being tracked.`;
  if (status === "left") return `You left ${name}. Nothing is being tracked.`;
  return `Waiting for your teacher to approve you in ${name}. Meetings are saved and upload after approval.`;
}

// When nothing is being tracked but a Meet tab is open, explain why instead of just saying "Not tracking".
async function whyNotTracking(cls) {
  let tabs;
  try { tabs = await chrome.tabs.query({ url: "https://meet.google.com/*" }); } catch { return ""; }
  if (!tabs.length) return "";
  const cfg = await getTrackingConfig();
  if (tabs.some((t) => isTrackedMeet(t, cfg))) return "";          // a tracked meeting is open; the session starts momentarily
  if (!tabs.some((t) => extractMeetCode(t.url))) return "A Meet tab is open, but it isn't a meeting link.";
  if (!cls) return "A Meet meeting is open, but you haven't joined a class yet.";
  return "A Meet meeting is open, but it isn't one of your class's registered meetings. Ask your teacher to add its code.";
}

function renderLive(session, threshold) {
  const cur = session && session.current;
  $("live").classList.toggle("none", !cur);
  if (!cur) return;

  const live = { ...session.totals };
  live[cur.state] = (live[cur.state] || 0) + (Date.now() - cur.since);
  const elapsed = Date.now() - session.start;
  const focused = FOCUS_STATES.reduce((sum, k) => sum + (live[k] || 0), 0);
  const pct = elapsed >= 5000 ? Math.min(1, focused / elapsed) : null;

  $("livePct").textContent = pct === null ? "—" : pctText(pct);
  $("liveFill").style.width = `${Math.round((pct ?? 0) * 100)}%`;
  $("liveFill").classList.toggle("below", pct !== null && !meetsTarget(pct, threshold));
  $("liveMark").style.left = `calc(${threshold * 100}% - 1px)`;
  const meter = $("meter");
  meter.setAttribute("aria-valuenow", String(Math.round((pct ?? 0) * 100)));
  $("liveHint").textContent = `Target ${pctText(threshold)} · focused ${fmtHMS(focused)} of ${fmtHMS(elapsed)}`;

  const rows = groupTotals(live).filter((g) => g.ms > 0 || g.id === "focused");
  clear($("liveTable")).append(h("tbody", {}, rows.map((g) =>
    h("tr", {}, h("td", {}, h("span", { class: `sw g-${g.id}` }), g.label), h("td", { class: "num" }, fmtHMS(g.ms))))));
}

function renderLast(session, history, cls, threshold) {
  const meetings = groupMeetings(history);
  const show = !session && meetings.length > 0;
  $("last").classList.toggle("none", !show);
  if (!show) return;

  const m = meetings[0];
  $("lastWhen").textContent = fmtDay(m.start);
  $("lastMeta").textContent = `${fmtClock(m.start)}–${fmtClock(m.end)} · ${fmtDuration(m.span)}`;
  $("lastPct").textContent = pctText(m.pct);
  const badge = $("lastBadge");
  badge.className = "badge";
  if (cls) {
    const ok = meetsTarget(m.pct, threshold);
    badge.textContent = ok ? `Meets ${pctText(threshold)} target` : `Below ${pctText(threshold)} target`;
    badge.classList.add(ok ? "ok" : "warn");
  } else badge.textContent = "";
  clear($("lastBar")).append(...m.parts.filter((p) => p.ms > 0).map((p) => h("span", { class: `g-${p.id}`, style: `flex: ${p.ms} 0 0` })));
}

async function render() {
  const s = await chrome.storage.local.get([KEYS.SESSION, KEYS.OUTBOX, KEYS.HISTORY, KEYS.CLASS, KEYS.MEMBERSHIP]);
  const session = s[KEYS.SESSION];
  const cls = s[KEYS.CLASS];
  const threshold = cls?.threshold ?? DEFAULT_THRESHOLD;
  const cur = session && session.current;

  $("state").textContent = cur ? STATE_LABELS[cur.state] || cur.state : "Not tracking";
  $("detail").textContent = cur ? cur.detail : (await whyNotTracking(cls)) || "No class meeting is open";
  $("dot").className = "dot " + (!cur ? "" : GOOD.has(cur.state) ? "active" : WARN.has(cur.state) ? "warn" : OUTSIDE_CALL.has(cur.state) ? "" : "bad");
  $("classLine").textContent = classLine(cls, s[KEYS.MEMBERSHIP]);

  renderLive(session, threshold);
  renderLast(session, s[KEYS.HISTORY] || [], cls, threshold);

  const n = (s[KEYS.OUTBOX] || []).length;
  $("outbox").textContent = n ? `${n} meeting${n === 1 ? "" : "s"} waiting to upload` : "";
}

$("recordsBtn").onclick = () => openPage("#records");
$("allRecords").onclick = () => openPage("#records");
$("settingsBtn").onclick = () => openPage("#class");

// Developer convenience only: lets you restart the counters while testing. Hidden in real builds because resetting
// mid-meeting only throws away the student's own focus time.
if (DEV_TRACK_ALL) {
  $("resetBtn").classList.remove("none");
  $("resetBtn").onclick = async () => {
    const { session } = await chrome.storage.local.get(KEYS.SESSION);
    if (session) {
      const now = Date.now();
      session.start = now; session.totals = {};
      if (session.current) session.current.since = now;
      await chrome.storage.local.set({ [KEYS.SESSION]: session });
    }
    render();
  };
}

chrome.storage.onChanged.addListener(render);
setInterval(render, 1000);
render();


// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.