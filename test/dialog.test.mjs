// U3: the dialog and the toast of the Mr Spa CMS (instead of the browser's confirm()), on a fake DOM (happy-dom).
import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { confirmDialog, createToast, openDialog } from "../dist/admin/index.js";

const page = () => { const window = new Window({ url: "http://localhost/admin" }); return { window, doc: window.document }; };
const key = (window, doc, name, extra = {}) => doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true, ...extra }));

test("confirm dialog: title + text from the message; the safe choice has focus; the red button confirms", async () => {
  const { doc } = page();
  const opener = doc.createElement("button");
  doc.body.append(opener);
  opener.focus();
  const answer = confirmDialog(doc, "Discard your draft?\n\nThe website stays as it is.", { confirm: "Discard draft", danger: true });
  const dialog = doc.querySelector(".vc-dialog");
  assert.equal(dialog.getAttribute("role"), "alertdialog");
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(doc.getElementById(dialog.getAttribute("aria-labelledby")).textContent, "Discard your draft?");
  assert.equal(doc.getElementById(dialog.getAttribute("aria-describedby")).textContent, "The website stays as it is.");
  const [cancel, discard] = dialog.querySelectorAll(".vc-dialog-actions button");
  assert.deepEqual([cancel.textContent, discard.textContent], ["Cancel", "Discard draft"]);
  assert.ok(discard.classList.contains("vc-danger-fill"), "a destructive choice is red");
  assert.equal(doc.activeElement, cancel);
  discard.click();
  assert.equal(await answer, true);
  assert.equal(doc.querySelector(".vc-dialog"), null);
  assert.equal(doc.activeElement, opener, "focus goes back to what opened it");
});

test("confirm dialog: Escape, Cancel and a click outside all answer no; Tab stays inside", async () => {
  const { window, doc } = page();
  let answer = confirmDialog(doc, "Leave without saving?", { cancel: "Keep editing", confirm: "Discard changes", danger: true });
  const [keep, leave] = doc.querySelectorAll(".vc-dialog-actions button");
  assert.equal(doc.querySelector(".vc-dialog-text"), null, "no text paragraph without text");
  leave.focus();
  key(window, doc, "Tab");
  assert.equal(doc.activeElement, keep, "Tab from the last button goes back to the first");
  key(window, doc, "Tab", { shiftKey: true });
  assert.equal(doc.activeElement, leave);
  key(window, doc, "Escape");
  assert.equal(await answer, false);
  answer = confirmDialog(doc, "Leave without saving?");
  doc.querySelector(".vc-overlay-modal").dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
  assert.equal(await answer, false);
  answer = confirmDialog(doc, "Leave without saving?");
  doc.querySelector(".vc-dialog-actions button").click();
  assert.equal(await answer, false);
  assert.equal(doc.querySelectorAll(".vc-overlay").length, 0);
});

test("dialog: a button can keep it open while it works (busy), and close it later", async () => {
  const { window, doc } = page();
  let release;
  const dialog = openDialog(doc, {
    title: "Publish Homepage?",
    buttons: [{ label: "Cancel", value: "cancel" }, { label: "Publish to website", kind: "primary", value: "publish" }],
    onButton: async (value, open) => { if (value !== "publish") return true; open.busy(true); await new Promise((resolve) => { release = resolve; }); open.busy(false); return false; },
  });
  const publish = doc.querySelector(".vc-primary");
  publish.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(publish.disabled, true, "busy: the buttons wait");
  key(window, doc, "Escape");
  assert.ok(doc.querySelector(".vc-dialog"), "Escape does nothing while busy");
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(publish.disabled, false);
  assert.ok(doc.querySelector(".vc-dialog"), "onButton returned false: still open");
  dialog.close("done");
  assert.equal(await dialog.done, "done");
});

test("toast: words only (the icon is drawn by its tone); one action; hidden after a while", async () => {
  const { doc } = page();
  const toast = createToast(doc, 20);
  doc.body.append(toast.element);
  let undone = 0;
  toast.say("Image replaced", "info", { label: "Undo", run: () => { undone += 1; } });
  assert.equal(toast.element.hidden, false);
  assert.equal(toast.element.textContent, "Image replacedUndo");
  assert.equal(toast.element.dataset.tone, "info");
  toast.element.querySelector(".vc-toast-action").click();
  assert.equal(undone, 1);
  assert.equal(toast.element.hidden, true, "the action closes it");
  toast.say("Draft saved. The website has not changed.", "success");
  assert.equal(toast.element.dataset.tone, "success");
  assert.equal(toast.element.textContent, "Draft saved. The website has not changed.");
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(toast.element.hidden, true);
});
