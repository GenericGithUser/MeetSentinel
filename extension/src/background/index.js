import { SYNC_PERIOD_MIN } from "../shared/constants.js";
import { evaluate, setOnSessionEnd } from "./state.js";
import { syncAndUpload } from "./sync.js";

// ---- Event wiring ---------------------------------------------------------
chrome.tabs.onActivated.addListener(() => evaluate());
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.status === "complete") evaluate(); });
chrome.tabs.onRemoved.addListener(() => evaluate());
chrome.windows.onFocusChanged.addListener(() => evaluate());   // WINDOW_ID_NONE when Chrome loses focus
chrome.windows.onRemoved.addListener(() => evaluate());
chrome.windows.onBoundsChanged.addListener(() => evaluate());  // minimize / restore

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === "visibility" || msg.type === "meeting") evaluate();
  // The options page joined / left a class or changed settings
  if (msg.type === "config-changed") { evaluate(); syncAndUpload(); }
});

// Re-check shortly after the popup closes
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "popup") port.onDisconnect.addListener(() => setTimeout(() => evaluate(), 200));
});

// Upload as soon as a session finishes
setOnSessionEnd(() => { syncAndUpload(); });

// Alarms: heartbeat for tracking, and periodic sync/upload
chrome.alarms.create("poll", { periodInMinutes: 0.5 });
chrome.alarms.create("sync", { periodInMinutes: SYNC_PERIOD_MIN });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "poll") evaluate();
  if (a.name === "sync") syncAndUpload();
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.remove(["current", "totals", "log"]); // data from v1.x, no longer used
  if (details.reason === "install") chrome.runtime.openOptionsPage(); // first run: set up the class
  evaluate();
});
chrome.runtime.onStartup.addListener(() => { evaluate(); syncAndUpload(); });
