import { h, clear, toast, action, friendlyError } from "../ui/dom.js";
import { listMyClasses, createClass } from "../lib/db.js";
import { parseMeetCodes, formatJoinCode } from "../lib/codes.js";

// "Your Classes" + "New Class", laid out like the mockup.
export async function classesView(root, { user }) {
  const list = h("div", { class: "classCont" }, h("p", {}, "Loading…"));

  const nameInput = h("input", { type: "text", id: "className", class: "inputBox", maxLength: 100, placeholder: "eg. CS 101 - Section A", autocomplete: "off" });
  const codesInput = h("textarea", { id: "classCodes", class: "inputBox", rows: 4, placeholder: "abc-defg-hij\nhttps://meet.google.com/klm-nopq-rst" });
  const err = h("p", { class: "error-text", role: "alert", hidden: true });

  const create = action(h("button", { type: "button", class: "createBtn" }, "Create Class"), async () => {
    err.hidden = true;
    const fail = (msg) => { err.textContent = msg; err.hidden = false; };
    const name = nameInput.value.trim();
    const { codes, invalid } = parseMeetCodes(codesInput.value);
    if (!name) return fail("Give the class a name.");
    if (invalid.length) return fail(`These aren't Meet codes: ${invalid.join(", ")}`);
    const { id, joinCode } = await createClass({ uid: user.uid, name, meetCodes: codes });
    toast(`Class created. Join code: ${formatJoinCode(joinCode)}`);
    location.hash = `#/class/${id}/roster`;
  }, "Creating…");

  root.append(
    h("h2", {}, "Your Classes"),
    h("hr"),
    list,
    h("hr"),
    h("h2", { class: "newClass" }, "New Class"),
    h("div", { class: "newClassCont" },
      h("label", { for: "className" }, "Class Name:"), nameInput,
      h("label", { for: "classCodes" }, "Google Meet Codes for this Class:"), codesInput,
      h("p", { class: "hint" }, "One per line or separated by commas. Links work too. Only these meetings are tracked, so students' other calls are never recorded."),
      err,
      create
    )
  );

  try {
    const classes = await listMyClasses(user.uid);
    clear(list);
    if (!classes.length) return void list.append(h("p", {}, "No Classes Yet, Add One!"));
    for (const c of classes) {
      const n = c.meetCodes.length;
      list.append(h("a", { class: "classItem", href: `#/class/${c.id}/approvals` },
        h("div", { class: "classInfo" }, h("h3", {}, c.name), h("p", {}, `${n} meeting code${n === 1 ? "" : "s"}`)),
        h("div", { class: "joinCode" }, h("p", {}, "JoinCode:"), h("strong", {}, formatJoinCode(c.joinCode)))
      ));
    }
  } catch (e) {
    clear(list).append(h("p", { class: "error-text" }, friendlyError(e)));
  }
}
