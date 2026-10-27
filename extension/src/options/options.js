import { KEYS, DEFAULT_THRESHOLD } from "../shared/constants.js";
import { firebaseConfigured } from "../firebase/app.js";
import { joinClass, refreshMembership, leaveClass, normalizeEmail } from "../firebase/classes.js";
import { renderRecords } from "./records.js";
import { pctText } from "../shared/format.js";

const $ = (id) => document.getElementById(id);
const TABS = ["records", "class"];

const STATUS_TEXT = {
  pending: "Waiting for your teacher to approve you. Attendance is saved on this computer and uploads once you're approved.",
  approved: "Approved. Your attendance is reported to your teacher.",
  removed: "You were removed from this class. Nothing is being tracked.",
  left: "You left this class. Nothing is being tracked."
};
const STATUS_SHORT = { pending: "Waiting for approval", approved: "Approved", removed: "Removed", left: "Left" };

const requestedTab = () => { const t = location.hash.replace("#", ""); return TABS.includes(t) ? t : null; };

async function render() {
  const s = await chrome.storage.local.get([KEYS.PROFILE, KEYS.CLASS, KEYS.MEMBERSHIP, KEYS.HISTORY, KEYS.OUTBOX]);
  const cls = s[KEYS.CLASS];
  const profile = s[KEYS.PROFILE] || {};
  const status = s[KEYS.MEMBERSHIP]?.status ?? "pending";
  const threshold = cls?.threshold ?? DEFAULT_THRESHOLD;

  // header + tabs
  $("navClass").textContent = cls ? `${cls.className || "Your class"} · ${STATUS_SHORT[status] || status}` : "No class joined";
  const tab = requestedTab() ?? (cls ? "records" : "class");
  for (const t of TABS) {
    $(`sec-${t}`).classList.toggle("none", t !== tab);
    const a = $(`tab-${t}`);
    if (t === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  $("config-banner").hidden = firebaseConfigured || tab !== "class";

  // class tab
  $("join-section").hidden = !!cls;
  $("class-section").hidden = !cls;
  if (cls) {
    $("class-name").textContent = cls.className || "Your class";
    $("status-line").textContent = STATUS_TEXT[status] || status;
    $("status-line").className = "status " + status;
    $("p-name").textContent = profile.name || "";
    $("p-email").textContent = profile.email || "";
    $("p-meets").textContent = cls.meetCodes?.length ? cls.meetCodes.join(", ") : "None registered yet";
    $("p-target").textContent = `Focused for at least ${pctText(threshold)} of each meeting`;
  }

  // records tab
  if (tab === "records") {
    renderRecords($("sec-records"), {
      history: s[KEYS.HISTORY] || [],
      outbox: s[KEYS.OUTBOX] || [],
      cls, threshold,
      onClear: async () => {
        if (!confirm("Delete your meeting records from this computer?\n\nMeetings already sent to your teacher are not affected, and meetings still waiting to upload will still be sent.")) return;
        await chrome.storage.local.remove(KEYS.HISTORY);
      }
    });
  }
}

function notifyBackground() {
  // The service worker re-evaluates tracking scope and tries to sync. Ignore "no receiver" errors.
  chrome.runtime.sendMessage({ type: "config-changed" }).catch(() => {});
}

$("join-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("join-error");
  err.hidden = true;
  const fail = (msg) => { err.textContent = msg; err.hidden = false; };

  const name = $("name").value.trim();
  const email = normalizeEmail($("email").value);
  const code = $("code").value.trim();

  if (!name) return fail("Enter your full name.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("Enter a valid email address.");
  if (!code) return fail("Enter the class code from your teacher.");
  if (!$("consent").checked) return fail("Tick the box to agree to share attendance with your teacher.");
  if (!firebaseConfigured) return fail("This build isn't connected to Firebase yet.");

  const btn = $("join-btn");
  btn.disabled = true;
  btn.textContent = "Joining…";
  try {
    await joinClass({ code, name, email });
    $("join-notice").hidden = true;
    notifyBackground();
    location.hash = "#class";
    await render();
  } catch (ex) {
    fail(ex.message || "Couldn't join the class. Check your connection and try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Join class";
  }
});

$("check-btn").addEventListener("click", async () => {
  const msg = $("class-msg");
  const btn = $("check-btn");
  btn.disabled = true;
  msg.textContent = "Checking…";
  try {
    const m = await refreshMembership();
    msg.textContent = m ? "Status updated." : "Couldn't check right now.";
    notifyBackground();
  } catch {
    msg.textContent = "Couldn't reach the server. Try again in a moment.";
  } finally {
    btn.disabled = false;
    await render();
  }
});

$("leave-btn").addEventListener("click", async () => {
  if (!confirm("Leave this class?\n\nMeetings you've already attended stay with your teacher, linked to you, and count toward your attendance. Any not yet sent are sent now if you're online. Your records on this computer are then deleted.\n\nYou can rejoin later with the class code.")) return;
  const btn = $("leave-btn");
  btn.disabled = true;
  btn.textContent = "Leaving…";
  let result;
  try { result = await leaveClass(); }
  finally { btn.disabled = false; btn.textContent = "Leave class"; }
  notifyBackground();
  location.hash = "#class";
  await render();

  const note = $("join-notice");
  const parts = ["You left the class."];
  if (result.sent) parts.push(`${result.sent} meeting${result.sent === 1 ? " was" : "s were"} sent to your teacher first.`);
  if (result.unsent) parts.push(`${result.unsent} meeting${result.unsent === 1 ? " couldn't" : "s couldn't"} be sent (you seem to be offline) and ${result.unsent === 1 ? "was" : "were"} discarded.`);
  if (!result.markedLeft) parts.push("Couldn't reach the server to record that you left; your teacher may still see you as a member.");
  parts.push("Your teacher keeps the meetings already sent. Rejoin any time with the class code.");
  note.textContent = parts.join(" ");
  note.hidden = false;
});

chrome.storage.onChanged.addListener(render);
window.addEventListener("hashchange", render);
render();

// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.
