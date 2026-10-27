# MeetSentinel

Class attendance from Google Meet focus. A browser extension measures whether each student keeps the class
meeting in front of them; a teacher website turns that into an attendance report. Firebase (Spark plan, no server
code) sits in the middle.

```
extension/   Chromium (Manifest V3) extension, Vite        what students install
web/         Teacher dashboard, Vite static site            what teachers use (Firebase Hosting)
firestore.rules, firestore.indexes.json                     the backend: security rules ARE the server
tests/rules/ Firestore rules tests (Firebase emulator)
```

## The attendance policy

A student is **present** for a meeting when

```
focused time  /  meeting duration   >=   threshold        (90% by default, per class in Settings)
```

- **Focused time** = time in `active` (Meet tab focused and visible) + `notes_tab_focused` (a note-taking web app in front).
  Meet visible but another app focused does **not** count.
- **Meeting duration** = the meeting window. The denominator is the whole meeting, so everything that isn't focus is deducted:
  other tabs, minimized, other apps, arriving late, leaving early, the lobby, a dropped connection.
- **Window** defaults to the earliest student join to the latest student leave for that Meet code on that day. The teacher
  can edit it per meeting in the Attendance tab. *One student who stays connected long after class stretches the default
  window and lowers everyone's percentage, so check it.*
- Several approved devices for one student: the best device counts, never the sum.
- Sessions store per-state totals, not a timeline, so a session that overruns the window is clipped proportionally.
- The extension's 3-second grace period means a blip shorter than 3 s is not counted as lost focus.

The logic lives in `web/src/lib/attendance.js` and is covered by `web/scripts/test-lib.mjs`.

## Setup

1. **Firebase project** (Spark plan). Enable **Firestore**, and in Authentication enable the **Anonymous** and **Google** providers.
2. `npm install` at the repo root.
3. Put your project's web config in **both** `extension/.env` and `web/.env` (copy each `.env.example`).
4. `cp .firebaserc.example .firebaserc` and set your project id. `npx firebase login`.
5. **Run the rules tests first** (`npm run test:rules`, below), then `npm run deploy:rules` (rules + the index the report query needs).
6. `npm run dev:web` for the site; `npm run dev:ext`, then load `extension/dist` in `chrome://extensions` (Developer mode > Load unpacked).
7. Production: set `VITE_TRACK_ALL_MEETINGS=false` (or remove it) in `extension/.env`; `npm run build`; `npm run deploy:web`.

Local development without a real project: `npm run emulators`, and set `VITE_USE_EMULATORS=true` in `web/.env`.

## How a class runs

1. Teacher signs in (Google), creates a class with its Meet codes, uploads the roster CSV, and shares the **join code**.
2. Student installs the extension, enters name, email and the code, and consents. This creates a **pending** membership.
3. Teacher approves each request in **Approvals**. Requests are auto-matched to the roster by email (university or personal);
   conflicts, name mismatches and unmatched emails are listed first. Approval links the student to a roster row.
4. During class the extension tracks only the registered Meet codes. When a session ends it uploads
   `{ meetCode, start, end, totals }`. Nothing is recorded when no registered meeting is open.
5. Teacher opens **Attendance**, picks a date range, and gets present/absent per roster row per meeting, plus CSV export.
6. The student can see their own numbers at any time: the popup shows a live **focus so far** meter against the class target,
   and the **My records** page (popup > Records) lists every meeting with its focus %, a breakdown of where the time went,
   and whether it has been sent to the teacher.

## Which Meet links are tracked

The extension finds the meeting code (`abc-defg-hij`) by looking at **every segment of the link's path**, not at a fixed
position, and ignores the query string. So `meet.google.com/abc-defg-hij`, `meet.google.com/meet/abc-defg-hij`,
`.../abc-defg-hij?f&pli=1&authuser=0` and `.../u/1/abc-defg-hij` all work. (Meet links gained a `/meet/` prefix and the first
version of the matcher, which assumed the code came right after the host, silently stopped tracking them. That is covered by
`extension/scripts/test-tracking.mjs`.) The teacher site accepts pasted links in any of these shapes too.

Not tracked: links without a standard 10-letter code, such as meeting-nickname links (`meet.google.com/my-class-nickname`).
`/new` and `/lookup/…` links are fine once Meet redirects to the real code.

A meeting is also only tracked if its code is on the class's list. Nothing says so loudly, so both sides now explain it: the
popup says why it isn't tracking ("a Meet meeting is open, but it isn't one of your class's registered meetings"), and the
teacher site warns when a class has no Meet codes.

## Data model

```
joinCodes/{CODE}                                   { classId }                       get-only, never list
classes/{classId}                                  { name, ownerUid, joinCode, meetCodes[], threshold, createdAt }
classes/{classId}/roster/{rosterId}                { name, universityEmail, personalEmail }       teacher only
classes/{classId}/students/{uid}                   { name, email, joinCode, status, rosterId?, createdAt }
                                                   status: pending | approved | left | removed
classes/{classId}/students/{uid}/sessions/{uuid}   { classId, meetCode, start, end, totals, uploadedAt }   create-only
classes/{classId}/meetings/{key}                   { meetCode, date, start, end }                 teacher window overrides
```

## Tests

| Command | What it covers | Status when this was written |
|---|---|---|
| `npm test` | extension state machine (mocked `chrome`), student records maths, which Meet links are tracked, the popup (jsdom), and join/leave/rejoin against an in-memory Firestore; attendance policy, CSV/roster/matching, and jsdom tests of the teacher site: the SPA shell's `none`-class toggling for every sign-in state, plus every class tab, against a mocked database | **passes** |
| `npm run test:rules` | 38 Firestore rules tests with allowed **and** denied cases (needs Java; the CLI downloads the emulator) | **written, never run by the author** (the emulator can't be downloaded where this was built). The rules changed substantially when leave/remove was reworked, so run these before deploying. |

Not tested anywhere yet: the extension in a real browser and the real Meet page; Firebase sign-in sharing between the
extension's options page and its service worker; the Firestore service-worker connection on a school network;
the teacher site in a real browser against a real project.

## Leaving, removal, and the attendance record

A membership is never deleted by a student, because a student's sessions live under it: deleting it would orphan the record
and the attendance would vanish from the teacher's report (this is what happened before, and why it was reworked).

| Event | What happens | Records |
|---|---|---|
| Student **leaves** (extension) | Unsent meetings are uploaded first. The membership becomes `left`. Tracking stops. The signed-in identity is kept. | **Kept**, still linked to the roster row, still counted |
| Student **rejoins** with the class code | Back to `approved` if the teacher approved them before (they keep their roster link), otherwise `pending` | History continues under the same record |
| Teacher **removes** a device | Becomes `removed`. The student can't rejoin or upload, and can't change it. | **Kept**, still counted |
| Teacher **restores** a removed device | Back to `approved` | Continues |
| Teacher **deletes records** (Former devices) | The sessions and the membership are deleted, after a confirmation that shows the count | **Gone** (the only way records are erased) |
| Teacher **rejects** a pending request | The record is deleted (a pending student has nothing to keep) | n/a |

Students cannot delete or edit their memberships or sessions; only the teacher can delete records. The consent text on the
extension says this. If a student asks for their data to be erased, the teacher does it with Delete records.

Records from before this change (a student who left then had their membership deleted) have no membership to attach to. The
Attendance tab detects those, leaves them out of the report (including the meeting window), and offers one button to delete
them.

## Student records

The extension keeps a local copy of every finished session (`history` in `chrome.storage.local`, newest 300) so the student
can review it; the upload outbox is separate and is emptied as sessions are accepted. `extension/src/shared/records.js`
groups sessions into meetings the same way the teacher's report does (same Meet code, same day) and computes
`focus % = (active + notes) / span of the meeting`. A gap between two sessions of one meeting (a dropped connection)
counts against it, as in the teacher's report. The class's target comes from the class document (`threshold`).

**The student's number is not the official one.** It is measured against the student's own session. The teacher measures
against the whole class meeting (and can edit its window), so arriving after the others or leaving before them lowers the
official figure beyond what the student sees. The Records page says so. Records live only in this browser: another computer
or cleared browser data starts empty, and leaving the class deletes them. Logic: `extension/scripts/test-records.mjs`.

## Design (site and extension)

The look comes from the original mockup (`index.html` / `style.css`): the palette, the animated gradient, the nav / hero /
main-panel structure, and the `none` class that shows one of splash, hero (signed out) or main (signed in). The shell lives in
`web/index.html`; `web/src/main.js` toggles it; views render into `<main id="view">`.

Deliberate changes from the mockup, all for legibility (checked in Chromium, not just in code):

- **Logos sit on a white plate and text sits on dark panels.** The wordmark's grey "Meet" is 1.0 to 1.6:1 against the gradient's
  blue phases, and cream text falls to about 1.4:1 on its light-teal phase, so neither can sit directly on the animated gradient.
- **Button text is dark navy** on the light-blue buttons (cream on that blue is about 1.4:1).
- **Sizes are rem, not ch** (the mockup's 1.2ch hint text rendered at roughly 10px). Class rows are real links.
- **Motion:** the gradient animation stops for visitors who ask their system for reduced motion.
- **Small screens:** data tables become stacked cards, so Approve / Reject never scroll off-screen.

The extension popup and the options page ("My records" and "Class" tabs) use the same palette, logo plate, panels and
buttons (`extension/src/ui/theme.css`). Google Sans is bundled into the extension from `@fontsource/google-sans` (OFL
licence), so opening the popup never contacts Google Fonts; the teacher site still loads it from Google Fonts.

Assets: brand art and favicons are in `web/public/assets/` (served at `/assets/`), resized for the web from the originals.
Replace a file there to change a logo. The supplied `site.webmanifest` had an empty name and a white theme; both are fixed.
The extension's toolbar icons (`extension/public/icons/`) use the helmet.



## Known limitations

- The extension runs on the student's machine, so a determined student can tamper with their own data. Rules reject impossible
  data (totals longer than the session, unregistered meetings, edits after upload) and approval prevents cross-student forgery,
  but gaps are ambiguous: a missing session could be a disabled extension or a real absence.
- A student the teacher removed cannot rejoin by themselves. A student who merely left can rejoin with the class code; rotate the join code if you need to stop anyone new joining.
- A student's records are local to one browser (see Student records). The student can read their uploaded sessions from Firestore under the rules, but the extension does not fetch them yet.
- Deleting a class doesn't cascade to its memberships, roster and sessions. A teacher account can't yet delete a whole class cleanly.
- Someone who clears their browser data (or uses a new browser profile) gets a new anonymous identity, so rejoining from there is a new pending request, not a reconnection to their old record.
- Spark quota (50k reads / 20k writes per day, per project): see `SYNC_PERIOD_MIN` and `MEMBERSHIP_REFRESH_MS` in
  `extension/src/shared/constants.js` if you have many students.


## LICENSE
This file is part of MeetSentinel.

MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.