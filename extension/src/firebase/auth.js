import { signInAnonymously, onAuthStateChanged } from "firebase/auth/web-extension";
import { getFirebase } from "./app.js";

// OPTIONS PAGE ONLY. Creates the student's anonymous identity the first time they join a class.
// The service worker never creates users, so the two contexts can't end up with different uids.
export async function ensureSignedIn() {
  const { auth } = getFirebase();
  await auth.authStateReady();
  return auth.currentUser ?? (await signInAnonymously(auth)).user;
}

// Service worker: returns the existing user, or null if the student hasn't joined yet.
// Waits briefly in case the options page signed in moments ago and persistence hasn't synced.
export async function getSignedInUser({ waitMs = 1500 } = {}) {
  const { auth } = getFirebase();
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser;
  if (!waitMs) return null;

  return new Promise((resolve) => {
    let unsub;
    const timer = setTimeout(() => { unsub?.(); resolve(null); }, waitMs);
    unsub = onAuthStateChanged(auth, (user) => {
      if (user) { clearTimeout(timer); unsub?.(); resolve(user); }
    });
  });
}

// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.