// Runs inside meet.google.com tabs. Reports page visibility and whether the user is actually inside a call.
// IMPORTANT: keep this file free of imports. Content scripts are classic scripts, not ES modules.

function detectInMeeting() {
  // English UI label on the hang-up button
  if (document.querySelector('button[aria-label*="Leave call" i]')) return true;
  // Language-independent fallback: icon ligature on the hang-up button
  for (const el of document.querySelectorAll("button i")) {
    if (el.textContent.trim() === "call_end") return true;
  }
  return false;
}

function snapshot() {
  return {
    visibility: document.visibilityState, // "visible" | "hidden"
    hasFocus: document.hasFocus(),
    inMeeting: detectInMeeting()
  };
}

function send(msg) {
  try { chrome.runtime.sendMessage(msg); } catch { /* extension was reloaded */ }
}

function reportVisibility() { send({ type: "visibility", ...snapshot() }); }
document.addEventListener("visibilitychange", reportVisibility);
window.addEventListener("focus", reportVisibility);
window.addEventListener("blur", reportVisibility);
window.addEventListener("pagehide", reportVisibility);

// Join/leave detection. "Joined" is immediate; "left" must hold for 2s because
// Meet's control bar can briefly disappear from the DOM.
let lastInMeeting = null;
let debounce = null;

function checkMeeting() {
  const now = detectInMeeting();
  if (now === lastInMeeting) return;
  if (now === false && lastInMeeting === true) {
    setTimeout(() => {
      if (!detectInMeeting()) {
        lastInMeeting = false;
        send({ type: "meeting", inMeeting: false });
      }
    }, 2000);
    return;
  }
  lastInMeeting = now;
  send({ type: "meeting", inMeeting: now });
}

new MutationObserver(() => {
  clearTimeout(debounce);
  debounce = setTimeout(checkMeeting, 500);
}).observe(document, { childList: true, subtree: true });

document.addEventListener("DOMContentLoaded", checkMeeting);
reportVisibility();

// Lets the background worker ask for the current state on demand.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "ping") sendResponse(snapshot());
});

// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.