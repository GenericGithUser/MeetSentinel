import { h, clear, toast, action, friendlyError, fmtTime, pct, mins } from "../ui/dom.js";
import { fetchSessions, listOverrides, setOverride, deleteOverride, deleteSessions } from "../lib/db.js";
import { computeAttendance, attendanceToCsv, DEFAULT_THRESHOLD } from "../lib/attendance.js";

const dayInput = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const toLocalInput = (ms) => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export function attendanceTab(body, state, api) {
  const threshold = state.cls.threshold ?? DEFAULT_THRESHOLD;
  const today = new Date();
  const from = h("input", { type: "date", id: "afrom", value: dayInput(new Date(today.getTime() - 14 * 86400000)) });
  const to = h("input", { type: "date", id: "ato", value: dayInput(today) });
  const out = h("div");
  let sessions = null;
  let overrides = {};
  let result = null;

  // Every device that was ever approved for a roster row (it has a rosterId) counts, including students who left or were removed.
  const members = state.students.filter((s) => s.rosterId);
  const knownUids = new Set(state.students.map((s) => s.uid));

  function paintResult() {
    clear(out);
    // Sessions whose membership no longer exists (left or removed under the old behaviour, which deleted memberships) can't
    // be attributed to anyone: leave them out of the report (including the meeting window) and offer to clear them.
    const orphans = sessions.filter((s) => !knownUids.has(s.uid));
    result = computeAttendance({ sessions: sessions.filter((s) => knownUids.has(s.uid)), members, roster: state.roster, overrides, threshold });
    if (orphans.length) {
      out.append(h("div", { class: "banner", role: "status" },
        h("p", {}, `${orphans.length} recorded session${orphans.length === 1 ? " belongs" : "s belong"} to devices with no membership, so ${orphans.length === 1 ? "it isn't" : "they aren't"} counted. This happens to records from before leaving kept a student's membership. They can't be linked to a student any more.`),
        action(h("button", { class: "small danger" }, `Delete ${orphans.length === 1 ? "this session" : `these ${orphans.length} sessions`}`), async () => {
          if (!confirm(`Permanently delete ${orphans.length} unattributable session${orphans.length === 1 ? "" : "s"}? This can't be undone.`)) return;
          await deleteSessions(state.classId, orphans.map((s) => ({ uid: s.uid, id: s.id })));
          sessions = sessions.filter((s) => knownUids.has(s.uid));
          toast("Deleted.");
          paintResult();
        })));
    }
    const { meetings, rows } = result;
    if (!meetings.length) return void out.append(h("p", { class: "muted" }, "No sessions in this date range."));
    if (!state.roster.length) out.append(h("p", { class: "banner" }, "The roster is empty, so there are no rows to report. Upload it in the Roster tab."));

    out.append(
      h("p", { class: "muted small" }, `Present = focused for at least ${pct(threshold)} of the meeting window. Focus counts time on Meet and in note-taking web apps; everything else, including arriving late and leaving early, is deducted. Check each meeting's window: it defaults to the earliest join to the latest leave among students, and one student who stays long after class would stretch it. Edit it if needed.`),
      h("div", { class: "table-wrap" }, h("table", { class: "matrix" },
        h("thead", {}, h("tr", {},
          h("th", {}, "Student"),
          meetings.map((m) => h("th", { class: "meetHead" },
            h("div", {}, m.date), h("div", { class: "muted" }, m.meetCode),
            h("div", {}, `${fmtTime(m.start)}–${fmtTime(m.end)}`, m.derived ? "" : h("span", { class: "badge ok" }, "edited")),
            h("button", { class: "secondary small", onclick: () => editWindow(m) }, "Edit window"))),
          h("th", { class: "num" }, "Present"), h("th", { class: "num" }, "Avg focus")
        )),
        h("tbody", {}, rows.map((r) => h("tr", {},
          h("td", {}, r.roster.name, r.devices > 0 && r.activeDevices === 0 ? h("span", { class: "badge warn", style: "margin-left:8px", title: "Every device linked to this student has left or been removed; recorded meetings still count." }, "no active device") : null),
          r.cells.map((c) => c.status === "no_device"
            ? h("td", { class: "no_device", title: "No approved device is linked to this student" }, "no device")
            : h("td", { class: c.status, title: titleFor(c) }, `${c.status === "present" ? "Present" : "Absent"} ${pct(c.pct)}`)),
          h("td", { class: "num" }, `${r.presentCount}/${meetings.length}`),
          h("td", { class: "num" }, r.avgPct === null ? "—" : pct(r.avgPct))
        )))
      )),
      h("div", { class: "row" }, h("button", { class: "secondary", onclick: () => exportCsv() }, "Download CSV"))
    );
  }

  const titleFor = (c) => [
    c.joinedLateMs ? `Joined ${mins(c.joinedLateMs)} after the start` : null,
    c.leftEarlyMs ? `Left ${mins(c.leftEarlyMs)} before the end` : null,
    c.pct === 0 && c.joinedLateMs === null ? "No session recorded in this meeting" : null
  ].filter(Boolean).join(". ");

  function exportCsv() {
    const csv = attendanceToCsv(result, (m) => `${m.date} ${m.meetCode} ${fmtTime(m.start)}-${fmtTime(m.end)}`);
    const a = h("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `attendance-${from.value}-to-${to.value}.csv` });
    document.body.append(a); a.click(); a.remove();
  }

  function editWindow(m) {
    const start = h("input", { type: "datetime-local", id: "wstart", value: toLocalInput(m.start) });
    const end = h("input", { type: "datetime-local", id: "wend", value: toLocalInput(m.end) });
    const dlg = h("dialog", {},
      h("h3", {}, `${m.date} · ${m.meetCode}`),
      h("p", { class: "hint" }, "Set when the meeting really started and ended. Everyone's focus is measured against this window."),
      h("label", { for: "wstart" }, "Start"), start,
      h("label", { for: "wend" }, "End"), end,
      h("div", { class: "row" },
        action(h("button", {}, "Save"), async () => {
          const s = new Date(start.value).getTime(), e = new Date(end.value).getTime();
          if (!(e > s)) return toast("The end must be after the start.", true);
          const data = { meetCode: m.meetCode, date: m.date, start: s, end: e };
          await setOverride(state.classId, m.key, data);
          overrides[m.key] = data; dlg.close(); dlg.remove(); paintResult();
        }),
        m.derived ? null : action(h("button", { class: "secondary" }, "Reset to automatic"), async () => {
          await deleteOverride(state.classId, m.key);
          delete overrides[m.key]; dlg.close(); dlg.remove(); paintResult();
        }),
        h("button", { class: "secondary", onclick: () => { dlg.close(); dlg.remove(); } }, "Cancel")));
    document.body.append(dlg);
    dlg.showModal();
  }

  const load = action(h("button", {}, "Load attendance"), async () => {
    clear(out).append(h("p", { class: "muted" }, "Loading…"));
    try {
      const fromMs = new Date(`${from.value}T00:00:00`).getTime();
      const toMs = new Date(`${to.value}T23:59:59.999`).getTime();
      if (!(toMs >= fromMs)) throw new Error("The end date must be on or after the start date.");
      [sessions, overrides] = await Promise.all([fetchSessions(state.classId, fromMs, toMs), listOverrides(state.classId)]);
      paintResult();
    } catch (e) {
      clear(out).append(h("p", { class: "error-text" }, friendlyError(e)));
    }
  }, "Loading…");

  body.append(
    h("p", { class: "muted" }, `A student is present when focused for at least ${pct(threshold)} of the meeting. Change this in Settings.`),
    h("div", { class: "row" },
      h("label", { for: "afrom", style: "margin:0" }, "From"), from,
      h("label", { for: "ato", style: "margin:0" }, "To"), to,
      load),
    out
  );
}
