import {
  GRACE_MS, STALE_MS, MIN_SESSION_MS, MAX_SESSIONS, MAX_HISTORY, NOTE_HOSTS, UNTRACKED, OUTSIDE_CALL, KEYS
} from "../shared/constants.js";
import { getTrackingConfig, isTrackedMeet, extractMeetCode } from "./tracking.js";
import { serial } from "./queue.js";

// ---- Session model --------------------------------------------------------
// storage.local[KEYS.SESSION]: the open session, or null when no tracked Meet tab exists
//   { start, lastSeen, meetCode, totals: {state: ms}, current: {state, detail, since} }
// storage.local[KEYS.OUTBOX]: finished sessions waiting to be uploaded
//   { id, meetCode, start, end, totals: {state: ms} }   <- this is all that ever leaves the browser

let onSessionEnd = null;
export function setOnSessionEnd(fn) { onSessionEnd = fn; }

const isNotes = (tab) => {
  try { return NOTE_HOSTS.includes(new URL(tab.url).hostname); }
  catch { return false; }
};

async function pingTab(tab) {
  try { return await chrome.tabs.sendMessage(tab.id, { type: "ping" }); }
  catch { return null; }
}

// ---- State computation ----------------------------------------------------
export async function computeState(cfg) {
  const windows = await chrome.windows.getAll({ populate: true });
  const activeTabOf = (w) => (w.tabs || []).find((t) => t.active);

  const pings = new Map();
  const codeOf = new Map();
  for (const w of windows) {
    for (const t of w.tabs || []) {
      if (isTrackedMeet(t, cfg)) {
        codeOf.set(t.id, extractMeetCode(t.url));
        pings.set(t.id, await pingTab(t));
      }
    }
  }
  if (pings.size === 0) return { state: "no_meet_tab", detail: "No tracked Meet meeting is open", meetCode: null };

  // Prefer the code of a tab that is actually in a call
  let meetCode = null;
  for (const [id, r] of pings) { if (r?.inMeeting) { meetCode = codeOf.get(id); break; } }
  if (!meetCode) meetCode = codeOf.values().next().value ?? null;
  const out = (state, detail) => ({ state, detail, meetCode });

  if (![...pings.values()].some((r) => r && r.inMeeting)) {
    return out("not_in_meeting", "On Meet, but not in a call (lobby or call ended)");
  }
  const inCall = (tab) => !!tab && pings.get(tab.id)?.inMeeting === true;

  const focusedWin = windows.find((w) => w.focused);
  const minimizedMeet = windows.some((w) => w.state === "minimized" && inCall(activeTabOf(w)));

  if (focusedWin && focusedWin.state !== "minimized") {
    const tab = activeTabOf(focusedWin);
    if (inCall(tab)) {
      if (pings.get(tab.id)?.visibility === "hidden") return out("page_hidden", "Meet tab reports hidden");
      return out("active", "Meet tab focused and visible");
    }
    if (isNotes(tab)) return out("notes_tab_focused", "Taking notes in a web app");
    return out("other_tab_focused", "A different tab is in front");
  }

  // No Chrome window has focus, but Meet may still be on screen
  if (!focusedWin) {
    for (const w of windows) {
      const tab = activeTabOf(w);
      if (w.state !== "minimized" && inCall(tab) && pings.get(tab.id)?.visibility === "visible") {
        return out("visible_unfocused", "Meet is visible, another app has focus");
      }
    }
  }

  if (minimizedMeet) return out("minimized", "Browser window is minimized");
  if (!focusedWin) return out("browser_not_focused", "Another app (or no Chrome window) has focus");
  return out("other_tab_focused", "A different tab is in front");
}

// ---- State machine --------------------------------------------------------
let pending = null;

function closeSession(session, end) {
  const totals = { ...session.totals };
  const c = session.current;
  if (c) totals[c.state] = (totals[c.state] || 0) + Math.max(0, end - c.since);
  return { id: crypto.randomUUID(), meetCode: session.meetCode ?? null, start: session.start, end, totals };
}

export function evaluate(arg) {
  return serial(() => runEvaluate(arg)).catch((e) => console.error("[evaluate]", e));
}

async function runEvaluate(arg) {
  const confirmed = !!(arg && arg.confirmed === true);

  // Ignore focus changes caused by our own popup
  if (chrome.runtime.getContexts) {
    const popups = await chrome.runtime.getContexts({ contextTypes: ["POPUP"] });
    if (popups.length > 0) { clearTimeout(pending); return; }
  }

  const cfg = await getTrackingConfig();
  const { state, detail, meetCode } = await computeState(cfg);
  const now = Date.now();

  const store = await chrome.storage.local.get({ [KEYS.SESSION]: null, [KEYS.OUTBOX]: [], [KEYS.HISTORY]: [] });
  let session = store[KEYS.SESSION];
  const outbox = store[KEYS.OUTBOX];
  const history = store[KEYS.HISTORY];
  let ended = false;

  const finish = (s, end) => {
    const rec = closeSession(s, end);
    if (rec.end - rec.start >= MIN_SESSION_MS) {
      outbox.push(rec);       // to upload; removed once the server accepts it
      history.push({ ...rec }); // for the student to review; stays on this computer
      ended = true;
    }
  };
  const save = async () => {
    if (outbox.length > MAX_SESSIONS) outbox.splice(0, outbox.length - MAX_SESSIONS);
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
    // History only changes when a session ends, so heartbeats don't rewrite it.
    await chrome.storage.local.set(ended
      ? { [KEYS.SESSION]: session, [KEYS.OUTBOX]: outbox, [KEYS.HISTORY]: history }
      : { [KEYS.SESSION]: session, [KEYS.OUTBOX]: outbox });
    if (ended && onSessionEnd) { try { onSessionEnd(); } catch (e) { console.error(e); } }
  };

  // Browser was closed / computer slept: end the old session at the last time we were alive
  if (session && now - session.lastSeen > STALE_MS) {
    finish(session, session.lastSeen);
    session = null;
  }

  // Not tracked (no tracked Meet tab): close any open session and record nothing further
  if (UNTRACKED.has(state)) {
    clearTimeout(pending);
    if (session) { finish(session, now); session = null; }
    await save();
    return;
  }

  // Joined a different meeting than the open session: split into two sessions
  if (session && meetCode && session.meetCode && session.meetCode !== meetCode) {
    finish(session, now);
    session = null;
  }

  const cur = session && session.current;

  // Grace period: don't leave "active" until the new state has lasted GRACE_MS
  if (cur && cur.state === "active" && state !== "active" && !OUTSIDE_CALL.has(state) && !confirmed) {
    session.lastSeen = now;
    await save();
    clearTimeout(pending);
    pending = setTimeout(() => evaluate({ confirmed: true }), GRACE_MS);
    return;
  }
  clearTimeout(pending);

  if (!session) {
    session = { start: now, lastSeen: now, meetCode, totals: {}, current: { state, detail, since: now } };
  } else {
    if (cur.state !== state) {
      session.totals[cur.state] = (session.totals[cur.state] || 0) + (now - cur.since);
      session.current = { state, detail, since: now };
    } else {
      cur.detail = detail;
    }
    session.lastSeen = now;
  }
  await save();
}
