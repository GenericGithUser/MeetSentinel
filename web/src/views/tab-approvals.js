import { h, toast, action } from "../ui/dom.js";
import { approveStudent, rejectRequest, setStudentStatus, countSessions, deleteStudentAndRecords } from "../lib/db.js";
import { buildApprovalQueue } from "../lib/matching.js";

const FLAG_TEXT = {
  conflict: ["Conflict", "bad"],
  name_mismatch: ["Name doesn't match roster", "warn"],
  ambiguous: ["Email matches several roster rows", "warn"],
  unmatched: ["Email not on roster", "warn"]
};

export function approvalsTab(body, state, api) {
  const { entries } = buildApprovalQueue(state.students, state.roster);
  const approved = state.students.filter((s) => s.status === "approved");
  const former = state.students.filter((s) => s.status === "left" || s.status === "removed");
  const rosterById = new Map(state.roster.map((r) => [r.id, r]));
  const clean = entries.filter((e) => e.category === "clean");

  if (!state.roster.length) {
    body.append(h("p", { class: "banner" }, "Upload your roster first (Roster tab). Requests are matched against it, and every approval links a student to a roster row."));
  }

  // ---- pending
  body.append(h("p", { class: "muted" }, entries.length
    ? `${entries.length} pending request${entries.length === 1 ? "" : "s"}. Problems are listed first. Approving links the student to a roster row, and attendance is reported against that row.`
    : "No pending requests."));

  if (clean.length) {
    body.append(h("div", { class: "row" }, action(
      h("button", {}, `Approve ${clean.length} clean match${clean.length === 1 ? "" : "es"}`),
      async () => {
        if (!confirm(`Approve ${clean.length} student${clean.length === 1 ? "" : "s"} whose email and name both match the roster?`)) return;
        for (const e of clean) await approveStudent(state.classId, e.member.uid, e.row.id);
        toast(`Approved ${clean.length}.`);
        await api.reload();
      }, "Approving…")));
  }

  if (entries.length) {
    const rosterOptions = (selectedId) => [
      h("option", { value: "" }, "Choose roster entry…"),
      ...state.roster.map((r) => h("option", { value: r.id, selected: r.id === selectedId }, r.name))
    ];
    body.append(h("div", { class: "table-wrap" }, h("table", { class: "stack" },
      h("thead", {}, h("tr", {}, ["Typed name", "Typed email", "Roster match", "Notes", "Link to", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, entries.map((e) => {
        const select = h("select", { "aria-label": `Roster entry for ${e.member.name}`, value: e.row?.id ?? "" }, rosterOptions(e.row?.id));
        const notes = e.flags.map((f) => h("span", { class: `badge ${FLAG_TEXT[f][1]}` }, FLAG_TEXT[f][0]));
        if (e.info.alreadyLinked) notes.push(h("div", { class: "hint" }, `Already linked to an approved device of ${e.info.alreadyLinked.join(", ")}. Approve only if this is their second device.`));
        if (e.info.rivals) notes.push(h("div", { class: "hint" }, `Also claimed by: ${e.info.rivals.join(", ")}. Approve only the real student.`));
        if (!e.flags.length) notes.push(h("span", { class: "badge ok" }, "Clean match"));
        return h("tr", {},
          h("td", { "data-label": "Typed name" }, e.member.name),
          h("td", { "data-label": "Typed email" }, e.member.email),
          h("td", { "data-label": "Roster match" }, e.row ? e.row.name : "—"),
          h("td", { "data-label": "Notes" }, notes),
          h("td", { "data-label": "Link to" }, select),
          h("td", { "data-label": "" }, h("div", { class: "row", style: "margin:0" },
            action(h("button", { class: "small" }, "Approve"), async () => {
              if (!select.value) return toast("Choose which roster entry this student is.", true);
              await approveStudent(state.classId, e.member.uid, select.value);
              await api.reload();
            }),
            action(h("button", { class: "small danger" }, "Reject"), async () => {
              if (!confirm(`Reject ${e.member.name}? They can request again with the class code.`)) return;
              await rejectRequest(state.classId, e.member.uid);
              await api.reload();
            })))
        );
      }))
    )));
  }

  // ---- approved
  body.append(h("hr"), h("h3", {}, `Approved devices (${approved.length})`));
  if (!approved.length) body.append(h("p", { class: "muted" }, "None yet."));
  else body.append(h("div", { class: "table-wrap" }, h("table", { class: "stack" },
    h("thead", {}, h("tr", {}, ["Typed name", "Typed email", "Linked roster entry", ""].map((t) => h("th", {}, t)))),
    h("tbody", {}, approved
      .sort((a, b) => (rosterById.get(a.rosterId)?.name ?? "").localeCompare(rosterById.get(b.rosterId)?.name ?? ""))
      .map((s) => h("tr", {},
        h("td", { "data-label": "Typed name" }, s.name), h("td", { "data-label": "Typed email" }, s.email),
        h("td", { "data-label": "Linked roster entry" }, rosterById.get(s.rosterId)?.name ?? "(roster entry deleted)"),
        h("td", { "data-label": "" }, action(h("button", { class: "small danger" }, "Remove"), async () => {
          if (!confirm(`Remove ${s.name}?\n\nTheir device stops reporting. Meetings already recorded are kept and still count toward their attendance. You can restore them, or delete their records, under Former devices.`)) return;
          await setStudentStatus(state.classId, s.uid, "removed");
          await api.reload();
        }))
      ))
    )
  )));

  // ---- former devices: the student left, or the teacher removed them. Their records are kept until the teacher deletes them.
  if (!former.length) return;
  body.append(h("hr"), h("h3", {}, `Former devices (${former.length})`),
    h("p", { class: "muted" }, "Recorded meetings are kept and still count in the attendance report. Students who left can rejoin themselves with the class code; students you removed can't, until you restore them."));
  body.append(h("div", { class: "table-wrap" }, h("table", { class: "stack" },
    h("thead", {}, h("tr", {}, ["Typed name", "Typed email", "Linked roster entry", "Status", ""].map((t) => h("th", {}, t)))),
    h("tbody", {}, former.map((s) => {
      const removed = s.status === "removed";
      return h("tr", {},
        h("td", { "data-label": "Typed name" }, s.name), h("td", { "data-label": "Typed email" }, s.email),
        h("td", { "data-label": "Linked roster entry" }, s.rosterId ? (rosterById.get(s.rosterId)?.name ?? "(roster entry deleted)") : "—"),
        h("td", { "data-label": "Status" }, h("span", { class: `badge ${removed ? "bad" : "warn"}` }, removed ? "Removed by you" : "Left the class")),
        h("td", { "data-label": "" }, h("div", { class: "row", style: "margin:0" },
          removed ? action(h("button", { class: "small" }, "Restore"), async () => {
            await setStudentStatus(state.classId, s.uid, s.rosterId ? "approved" : "pending");
            await api.reload();
          }) : null,
          action(h("button", { class: "small danger" }, "Delete records"), async () => {
            const n = await countSessions(state.classId, s.uid);
            if (!confirm(`Delete ${s.name}'s records?\n\nThis permanently deletes ${n} recorded session${n === 1 ? "" : "s"} and unlinks this device. Their attendance for those meetings is lost. This can't be undone.`)) return;
            const deleted = await deleteStudentAndRecords(state.classId, s.uid);
            toast(`Deleted ${deleted} session${deleted === 1 ? "" : "s"} and the record for ${s.name}.`);
            await api.reload();
          })))
      );
    }))
  )));
}
