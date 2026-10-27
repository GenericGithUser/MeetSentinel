import { initializeApp } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithCredential, signOut, onAuthStateChanged, connectAuthEmulator
} from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

const useEmulators = import.meta.env.VITE_USE_EMULATORS === "true";

const cfg = useEmulators
  ? { apiKey: "demo", authDomain: "localhost", projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "demo-meetsentinel", appId: "demo" }
  : {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID
    };

export const configured = Boolean(cfg.apiKey && cfg.projectId && cfg.appId);

let auth = null;
let db = null;
if (configured) {
  const app = initializeApp(cfg);
  auth = getAuth(app);
  db = getFirestore(app);
  if (useEmulators) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
}
export { auth, db };

export const usingEmulators = useEmulators;

// EMULATOR ONLY. Signs in as a fake Google user without the popup: the Auth emulator accepts an unsigned JSON
// "ID token". The resulting user has sign_in_provider "google.com" and a verified email, so the rules treat them
// as a teacher. Refuses to run against a real project.
export function signInWithFakeGoogle(email) {
  if (!useEmulators) throw new Error("Dev sign-in only works with the Firebase emulators.");
  const token = JSON.stringify({ sub: `dev-${email}`, email, email_verified: true, name: email.split("@")[0] });
  return signInWithCredential(auth, GoogleAuthProvider.credential(token));
}

export const signInWithGoogle = () => signInWithPopup(auth, new GoogleAuthProvider());
export const logOut = () => signOut(auth);
export const watchAuth = (cb) => onAuthStateChanged(auth, cb);


// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.