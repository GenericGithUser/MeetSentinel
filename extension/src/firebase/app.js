import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth/web-extension"; // the MV3-safe entry point (no remote scripts, no popups)
import { initializeFirestore } from "firebase/firestore";

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// False until .env is filled in. Tracking still works locally; sync and upload are skipped.
export const firebaseConfigured = Boolean(cfg.apiKey && cfg.projectId && cfg.appId);

let instance = null;

// Lazily creates one Firebase app per context (options page, service worker).
// Auth persists in IndexedDB under the extension's origin, so both contexts see the same signed-in user.
export function getFirebase() {
  if (!firebaseConfigured) {
    throw new Error("Firebase is not configured. Copy .env.example to .env and fill it in.");
  }
  if (!instance) {
    const app = initializeApp(cfg);
    instance = {
      app,
      auth: getAuth(app),
      // Long-polling fallback helps in service workers and behind school proxies. Test on your target network.
      db: initializeFirestore(app, { experimentalAutoDetectLongPolling: true })
    };
  }
  return instance;
}

// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.