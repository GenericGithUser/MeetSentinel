import { h, toast, action } from "../ui/dom.js";
import { updateClass, rotateJoinCode } from "../lib/db.js";
import { parseMeetCodes, formatJoinCode } from "../lib/codes.js";

export function settingsTab(body, state, api) {
  const cls = state.cls;

  // ---- join code
  const copy = action(h("button", { class: "secondary small" }, "Copy"), async () => {
    await navigator.clipboard.writeText(formatJoinCode(cls.joinCode));
    toast("Join code copied.");
  });
  const rotate = action(h("button", { class: "secondary small" }, "Generate a new code"), async () => {
    if (!confirm("Generate a new join code? The old code stops working for new students. Students already in the class are not affected.")) return;
    await rotateJoinCode(state.classId, cls.joinCode);
    toast("New join code generated.");
    await api.reload();
  });
  body.append(
    h("h3", {}, "Join code"),
    h("p", { class: "muted" }, "Give this to your students. They enter it in the MeetSentinel extension, then you approve them in the Approvals tab."),
    h("div", { class: "row" }, h("span", { class: "code" }, formatJoinCode(cls.joinCode)), copy, rotate)
  );

  // ---- class settings
  const name = h("input", { type: "text", id: "sname", value: cls.name, maxLength: 100 });
  const codes = h("textarea", { id: "scodes", value: cls.meetCodes.join("\n") });
  const threshold = h("input", { type: "number", id: "sthr", min: 50, max: 100, step: 1, value: Math.round(cls.threshold * 100) });
  const err = h("p", { class: "error-text", role: "alert", hidden: true });

  body.append(
    h("hr"),
    h("h3", {}, "Class settings"),
    h("label", { for: "sname" }, "Class name"), name,
    h("label", { for: "scodes" }, "Google Meet codes"), codes,
    h("p", { class: "hint" }, "Only these meetings are tracked and accepted from students. One per line; links work too. Changes reach students' extensions within about an hour."),
    h("label", { for: "sthr" }, "Present when focused for at least (% of the meeting)"), threshold,
    h("p", { class: "hint" }, "Focused time is time on the Meet tab plus time in a note-taking web app. Time away, late arrival and early exit all count against it."),
    err,
    h("div", { class: "row" }, action(h("button", {}, "Save settings"), async () => {
      err.hidden = true;
      const { codes: parsedCodes, invalid } = parseMeetCodes(codes.value);
      const thr = Number(threshold.value);
      const fail = (m) => { err.textContent = m; err.hidden = false; };
      if (!name.value.trim()) return fail("Give the class a name.");
      if (invalid.length) return fail(`These aren't Meet codes: ${invalid.join(", ")}`);
      if (!(thr >= 50 && thr <= 100)) return fail("Choose a percentage between 50 and 100.");
      await updateClass(state.classId, { name: name.value.trim(), meetCodes: parsedCodes, threshold: thr / 100 });
      toast("Settings saved.");
      await api.reload();
    }, "Saving…"))
  );
}
