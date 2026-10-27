# MeetSentinel extension

Chromium (Manifest V3) extension built with Vite. See the repository root README for setup, the data model, the
attendance policy, and how student records work.

```bash
npm run dev -w extension    # from the repo root: rebuilds extension/dist on change
npm test -w extension       # state machine + student records tests (mocked chrome APIs)
```

Load `extension/dist` via chrome://extensions > Developer mode > Load unpacked. Reload open Meet tabs after each rebuild.

- `popup.html` / `src/popup/`: live status, "focus so far" meter against the class target, last meeting
- `options.html` / `src/options/`: **My records** (per-meeting focus) and **Class** (join / status / leave) tabs
- `src/shared/records.js`: per-meeting focus maths (pure, tested)
- `src/ui/theme.css`: shared look, matching the teacher site
