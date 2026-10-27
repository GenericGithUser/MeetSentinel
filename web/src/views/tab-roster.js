import { h, add, clear, toast, action } from "../ui/dom.js";
import { replaceRoster } from "../lib/db.js";
import { parseRoster, ROSTER_TEMPLATE } from "../lib/csv.js";

export function rosterTab(body, state, api) {
  const linkedCount = new Map();   // devices that are approved now
  const formerCount = new Map();   // devices that left or were removed (their records are kept)
  for (const s of state.students) {
    if (!s.rosterId) continue;
    const m = s.status === "approved" ? linkedCount : formerCount;
    m.set(s.rosterId, (m.get(s.rosterId) ?? 0) + 1);
  }
  const linkedCell = (id) => {
    const a = linkedCount.get(id) ?? 0, f = formerCount.get(id) ?? 0;
    if (a) return f ? `${a} (+${f} former)` : String(a);
    return f ? h("span", { class: "badge warn" }, `${f} former only`) : h("span", { class: "badge warn" }, "none");
  };

  const fileInput = h("input", { type: "file", accept: ".csv,text/csv", id: "rfile" });
  const paste = h("textarea", { id: "rpaste", placeholder: "name,university email,personal email\nMaria Santos,maria@university.edu,maria@gmail.com" });
  const preview = h("div");
  let parsed = null;

  const parseBtn = action(h("button", { class: "secondary" }, "Preview"), async () => {
    let text = paste.value;
    if (fileInput.files[0]) text = await fileInput.files[0].text();
    parsed = parseRoster(text);
    clear(preview);
    if (parsed.errors.length) {
      preview.append(h("div", { class: "banner" }, h("strong", {}, `${parsed.errors.length} problem${parsed.errors.length === 1 ? "" : "s"}`),
        h("ul", {}, parsed.errors.slice(0, 15).map((e) => h("li", {}, `Line ${e.line}: ${e.message}`))),
        parsed.errors.length > 15 ? h("p", { class: "hint" }, `…and ${parsed.errors.length - 15} more.`) : null));
    }
    if (parsed.rows.length) {
      add(preview,
        h("p", {}, `${parsed.rows.length} student${parsed.rows.length === 1 ? "" : "s"} ready to save.`),
        h("div", { class: "table-wrap" }, h("table", { class: "stack" },
          h("thead", {}, h("tr", {}, ["Name", "University email", "Personal email"].map((t) => h("th", {}, t)))),
          h("tbody", {}, parsed.rows.slice(0, 10).map((r) => h("tr", {}, h("td", { "data-label": "Name" }, r.name), h("td", { "data-label": "University email" }, r.universityEmail), h("td", { "data-label": "Personal email" }, r.personalEmail)))))),
        parsed.rows.length > 10 ? h("p", { class: "hint" }, `Showing 10 of ${parsed.rows.length}.`) : null,
        action(h("button", {}, "Save roster"), async () => {
          const removing = state.roster.length ? "Students not in this file are removed from the roster. Students already linked to unchanged rows stay linked. " : "";
          if (!confirm(`${removing}Save ${parsed.rows.length} students?`)) return;
          const r = await replaceRoster(state.classId, parsed.rows);
          toast(`Roster saved: ${r.saved} students${r.removed ? `, ${r.removed} removed` : ""}.`);
          await api.reload();
        }, "Saving…"));
    }
  });

  const templateHref = URL.createObjectURL(new Blob([ROSTER_TEMPLATE], { type: "text/csv" }));

  body.append(
    h("p", { class: "muted" }, "The roster is the list of students you expect. Approvals match students to it by email (university or personal), and the attendance report has one row per roster entry. Students can never see it."),
    h("label", { for: "rfile" }, "Upload CSV"), fileInput,
    h("p", { class: "hint" }, "Columns: name (or first name and last name), university email, personal email. ",
      h("a", { href: templateHref, download: "roster-template.csv" }, "Download a template")),
    h("label", { for: "rpaste" }, "…or paste CSV"), paste,
    h("div", { class: "row" }, parseBtn),
    preview,
    h("hr"),
    h("h3", {}, `Current roster (${state.roster.length})`)
  );

  if (!state.roster.length) return void body.append(h("p", { class: "muted" }, "Empty."));
  body.append(h("div", { class: "table-wrap" }, h("table", { class: "stack" },
    h("thead", {}, h("tr", {}, ["Name", "University email", "Personal email", "Linked devices"].map((t) => h("th", {}, t)))),
    h("tbody", {}, state.roster.map((r) => h("tr", {},
      h("td", { "data-label": "Name" }, r.name), h("td", { "data-label": "University email" }, r.universityEmail), h("td", { "data-label": "Personal email" }, r.personalEmail),
      h("td", { "data-label": "Linked devices" }, linkedCell(r.id))
    )))
  )));
}
