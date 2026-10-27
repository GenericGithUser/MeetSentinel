import { h, add, clear, friendlyError } from "../ui/dom.js";
import { getClass, listStudents, listRoster } from "../lib/db.js";
import { approvalsTab } from "./tab-approvals.js";
import { rosterTab } from "./tab-roster.js";
import { attendanceTab } from "./tab-attendance.js";
import { settingsTab } from "./tab-settings.js";

const TABS = [
  { id: "approvals", label: "Approvals", render: approvalsTab },
  { id: "roster", label: "Roster", render: rosterTab },
  { id: "attendance", label: "Attendance", render: attendanceTab },
  { id: "settings", label: "Settings", render: settingsTab }
];

export async function classView(main, { user, params }) {
  const [classId, tabId = "approvals"] = params;
  const state = { classId, cls: null, students: [], roster: [] };
  main.append(h("p", {}, "Loading…"));

  async function reload() {
    const [cls, students, roster] = await Promise.all([getClass(classId), listStudents(classId), listRoster(classId)]);
    Object.assign(state, { cls, students, roster });
  }

  try { await reload(); }
  catch (e) { return void clear(main).append(h("p", { class: "error-text" }, friendlyError(e)), h("a", { href: "#/" }, "Back")); }

  if (!state.cls || state.cls.ownerUid !== user.uid) {
    return void clear(main).append(h("p", {}, "Class not found. "), h("a", { href: "#/" }, "Back to your classes"));
  }

  const tab = TABS.find((t) => t.id === tabId) ?? TABS[0];

  function paint() {
    clear(main);
    const body = h("section");
    const pending = state.students.filter((s) => s.status === "pending").length;
    add(main,
      h("a", { class: "backLink", href: "#/" }, "← All classes"),
      h("h2", {}, state.cls.name),
      state.cls.meetCodes.length ? null
        : h("p", { class: "banner", role: "status" }, "No Google Meet codes are registered for this class, so no student's meetings are being tracked. Add them in Settings."),
      h("nav", { class: "tabs", "aria-label": "Class sections" }, TABS.map((t) =>
        h("a", { href: `#/class/${classId}/${t.id}`, "aria-current": t.id === tab.id ? "page" : null },
          t.label + (t.id === "approvals" && pending ? ` (${pending})` : ""))
      )),
      body
    );
    tab.render(body, state, { user, classId, reload: async () => { await reload(); paint(); } });
  }
  paint();
}
