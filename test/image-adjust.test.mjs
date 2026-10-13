// M5: Adjust = a NEW copy of an image for one image area, as in the Mr Spa CMS — Shape (Original / Square 1200 × 1200 /
// Landscape 1600 × 900 / Portrait 1200 × 1500), the focus point (click the preview, or the two sliders), "Create adjusted
// copy"; the original is never changed; a failure changes nothing. The geometry is pure; the dialog runs on a fake DOM
// (happy-dom has no canvas, so the canvas step is replaced) — the real canvas runs in the e2e (headless Chrome).
import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { f } from "../dist/index.js";
import { ADJUST_SHAPES, adjustRect, adjustSize, createForm, openAdjust } from "../dist/admin/index.js";

test("geometry: the largest box of the shape around the focus point, kept inside the image; the copy never larger than what is kept", () => {
  assert.deepEqual(ADJUST_SHAPES.map((shape) => [shape.label, shape.size && `${shape.size.width} × ${shape.size.height}`]), [["Original", null], ["Square", "1200 × 1200"], ["Landscape", "1600 × 900"], ["Portrait", "1200 × 1500"]]);
  const image = { width: 3000, height: 2000 };
  assert.deepEqual(adjustRect(image, "original", 0.1, 0.9), { x: 0, y: 0, width: 3000, height: 2000 }, "Original keeps the whole picture (no focus point)");
  assert.deepEqual(adjustRect(image, "square"), { x: 500, y: 0, width: 2000, height: 2000 });
  assert.deepEqual(adjustRect(image, "square", 0, 0.5), { x: 0, y: 0, width: 2000, height: 2000 }, "kept inside the image");
  assert.deepEqual(adjustRect(image, "landscape", 0.5, 0.2), { x: 0, y: 0, width: 3000, height: 1688 });
  assert.deepEqual(adjustRect(image, "portrait", 0.8, 0.5), { x: 1400, y: 0, width: 1600, height: 2000 });
  assert.deepEqual(adjustSize(adjustRect(image, "square"), "square"), { width: 1200, height: 1200 });
  assert.deepEqual(adjustSize(adjustRect({ width: 800, height: 600 }, "square"), "square"), { width: 600, height: 600 }, "a small image is not made bigger");
  assert.deepEqual(adjustSize(adjustRect({ width: 4800, height: 3200 }, "original"), "original"), { width: 2400, height: 1600 }, "Original: at most 2400 px");
});

const image = { src: "/assets/uploads/2026/10/sam-at-the-desk-0123abcd.webp", width: 2400, height: 1200, bytes: 200_000, source: "upload" };
const made = { src: "/assets/uploads/2026/10/sam-at-the-desk-square-89abcdef.webp", bytes: 90_000, source: "upload" };
const dialog = (overrides = {}) => {
  const window = new Window({ url: "http://localhost/admin" });
  const document = window.document;
  const calls = { adjust: [], upload: [], created: [] };
  openAdjust({
    doc: document, image, maxBytes: 10 * 1024 * 1024,
    measure: async () => assert.fail("the size is known"),
    adjust: async (src, rect, size, name) => { calls.adjust.push({ src, rect, size, name }); return { blob: new window.Blob(["x"], { type: "image/webp" }), name: `${name}.webp`, ...size }; },
    upload: async (prepared) => { calls.upload.push(prepared); return { ok: true, image: made }; },
    onCreated: (copy) => calls.created.push(copy),
    ...overrides,
  });
  const $ = (selector) => document.querySelector(selector);
  const press = (label) => [...document.querySelectorAll("button")].find((button) => button.textContent === label);
  return { window, document, calls, $, press, settle: () => new Promise((resolve) => setTimeout(resolve, 0)) };
};

test("dialog: Adjust image — Shape, the two focus sliders, Create adjusted copy makes and uploads a new image; the original is untouched", async () => {
  const d = dialog();
  assert.equal(d.$(".vc-dialog-title").textContent, "Adjust image");
  assert.equal(d.$(".vc-dialog-text").textContent, "Create a new copy for this image area. Your original image will stay unchanged.");
  assert.deepEqual([...d.document.querySelectorAll(".vc-adjust-shapes label")].map((label) => label.textContent.trim()), ["Original", "Square", "Landscape", "Portrait"]);
  assert.equal(d.$(".vc-adjust-shapes input:checked").value, "original", "Original first");
  assert.match(d.$(".vc-adjust-layout").textContent, /Click the preview to set the focus point\.[\s\S]*Horizontal focus 50%[\s\S]*Vertical focus 50%[\s\S]*Original stays available in Media and is never overwritten\./);
  assert.equal(d.document.activeElement, d.press("Create adjusted copy"), "focus on Create adjusted copy");
  d.$('.vc-adjust-shapes input[value="square"]').checked = true;
  d.$('.vc-adjust-shapes input[value="square"]').dispatchEvent(new d.window.Event("change"));
  const horizontal = d.$('[data-focus="x"]');
  horizontal.value = "20"; horizontal.dispatchEvent(new d.window.Event("input"));
  assert.match(d.$(".vc-adjust-layout").textContent, /Horizontal focus 20%/);
  assert.equal(d.$(".vc-adjust-preview img").style.objectPosition, "20% 50%", "the preview shows the focus point");
  d.press("Create adjusted copy").click();
  for (let i = 0; i < 20 && !d.calls.created.length; i += 1) await d.settle();
  assert.deepEqual(d.calls.adjust.map((call) => [call.src, call.rect, call.size, call.name]), [[image.src, { x: 0, y: 0, width: 1200, height: 1200 }, { width: 1200, height: 1200 }, "sam-at-the-desk-square"]], "cut from the original's pixels, named {source}-{shape}");
  assert.equal(d.calls.upload[0].name, "sam-at-the-desk-square.webp", "the copy is uploaded like any image");
  assert.deepEqual(d.calls.created, [made]);
  assert.ok(!d.$(".vc-dialog"), "the dialog closes");
});

test("dialog: a failure changes nothing and says so; the Shape is kept for the next time", async () => {
  const d = dialog({ adjust: async () => { throw new Error("canvas exploded"); } });
  assert.equal(d.$(".vc-adjust-shapes input:checked").value, "square", "the last Shape (Mr Spa keeps it)");
  d.press("Create adjusted copy").click();
  for (let i = 0; i < 20 && !/failed/.test(d.$(".vc-adjust-status").textContent); i += 1) await d.settle();
  assert.equal(d.$(".vc-adjust-status").textContent, "Adjustment failed. Your original image is unchanged.");
  assert.equal(d.press("Create adjusted copy").disabled, false, "it can be tried again");
  d.press("Cancel").click();
  await d.settle();
  assert.ok(!d.$(".vc-dialog"), "Cancel closes it");
});

test("card: Adjust is on the picture of an image the browser can change; the copy is then offered first in the sheet", () => {
  const window = new Window({ url: "http://localhost/admin" });
  const picks = [];
  let adjusted;
  const form = createForm({
    doc: window.document, fields: { photo: f.image({ label: "Photo" }) }, value: { photo: image.src }, role: "owner",
    pickImage: (current, done, label, more) => picks.push({ current, label, more, done }),
    adjustImage: (src, created) => { adjusted = src; created(made); },
    canAdjust: (src) => src.startsWith("/"),
  });
  const adjust = form.element.querySelector('[data-image-action="adjust"]');
  assert.equal(adjust.getAttribute("aria-label"), "Adjust Photo");
  adjust.click();
  assert.equal(adjusted, image.src);
  assert.equal(picks.length, 1, "the sheet opens for the same image area");
  assert.deepEqual([picks[0].current, picks[0].label, picks[0].more.select], [image.src, "Photo", made]);
  const other = createForm({ doc: window.document, fields: { photo: f.image({ label: "Photo" }) }, value: { photo: "https://cdn.example/a.jpg" }, role: "owner", pickImage: () => {}, adjustImage: () => assert.fail("not this one"), canAdjust: (src) => src.startsWith("/") });
  assert.equal(other.element.querySelector('[data-image-action="adjust"]'), null, "no Adjust on an image of another site");
});
