// P12f: crop / resize = a NEW copy (the first site's choices: presets first, then move the crop; the original is never
// changed; a failure changes nothing). The geometry is pure; the sheet runs on a fake DOM (happy-dom has no canvas, so
// the canvas step is replaced) — the real canvas runs in the e2e (headless Chrome).
import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { cropRect, openImagePicker, outputSize } from "../dist/admin/index.js";

test("geometry: the largest box of the shape, made smaller by the crop size, kept inside the image", () => {
  const image = { width: 2400, height: 1200 };
  assert.deepEqual(cropRect(image, null), { x: 0, y: 0, width: 2400, height: 1200 }, "Original = the whole image");
  assert.deepEqual(cropRect(image, 1), { x: 600, y: 0, width: 1200, height: 1200 }, "Square, centred");
  assert.deepEqual(cropRect(image, 1, 0.5), { x: 900, y: 300, width: 600, height: 600 });
  assert.deepEqual(cropRect(image, 1, 1, 0, 0), { x: 0, y: 0, width: 1200, height: 1200 }, "moved to the left edge, not past it");
  assert.deepEqual(cropRect(image, 1, 1, 1, 1), { x: 1200, y: 0, width: 1200, height: 1200 });
  assert.deepEqual(cropRect({ width: 1000, height: 2000 }, 16 / 9), { x: 0, y: 719, width: 1000, height: 563 }, "a wide crop of a tall image");
  assert.equal(cropRect(image, 1, 0.01).width, 240, "never smaller than 20 %");
  assert.deepEqual(outputSize({ x: 0, y: 0, width: 1200, height: 1200 }), { width: 1200, height: 1200 });
  assert.deepEqual(outputSize({ x: 0, y: 0, width: 1200, height: 1200 }, 800), { width: 800, height: 800 });
  assert.deepEqual(outputSize({ x: 0, y: 0, width: 4000, height: 1000 }), { width: 2400, height: 600 }, "at most 2400 px on the longest side");
});

const upload = { src: "/assets/uploads/2026/10/sam-at-the-desk-0123abcd.webp", width: 2400, height: 1200, bytes: 90_000, name: "sam-at-the-desk-0123abcd.webp" };
const sheet = ({ adjust, uploadResult = { ok: true, image: { src: "/assets/uploads/2026/10/sam-at-the-desk-1200x1200-89abcdef.webp", width: 1200, height: 1200, bytes: 40_000, source: "upload" } } } = {}) => {
  const window = new Window({ url: "http://localhost/admin" });
  const doc = window.document;
  const calls = { adjust: [], upload: [], picked: [] };
  const api = { get: async () => ({ ok: true, status: 200, data: { uploads: [upload], site: [{ src: "/images/hero.svg", bytes: 1200 }] } }) };
  openImagePicker({
    doc, api, media: { uploads: true, base: "/assets/uploads", maxBytes: 10 * 1024 * 1024 }, prepare: async () => { throw new Error("not used"); },
    upload: async (prepared) => { calls.upload.push(prepared); return uploadResult; },
    onPick: (image) => calls.picked.push(image),
    measure: async () => ({ width: 2400, height: 1200 }),
    adjust: adjust ?? (async (src, rect, size, name) => { calls.adjust.push({ src, rect, size, name }); return { blob: new window.Blob(["x"], { type: "image/webp" }), name: `${name}.webp`, width: size.width, height: size.height }; }),
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const $ = (selector) => doc.querySelector(selector);
  const press = (label) => [...doc.querySelectorAll("button")].find((button) => button.textContent.trim() === label || button.getAttribute("aria-label") === label);
  return { window, doc, calls, settle, $, press };
};

test("sheet: Crop / resize opens on a library image; Square + a width make the copy; Save uploads it and picks it; the original is untouched", async () => {
  const s = sheet();
  await s.settle(); await s.settle();
  // U3: select an image first; Crop / resize is in the footer for the selected one.
  s.$(".vc-tile").click();
  assert.ok(s.press("Crop or resize sam-at-the-desk-0123abcd.webp"), "the selected image has Crop / resize");
  s.press("Crop or resize sam-at-the-desk-0123abcd.webp").click();
  await s.settle();
  assert.equal(s.$(".vc-picker-library").hidden, true);
  assert.match(s.$(".vc-adjust").textContent, /Crop or resize · sam-at-the-desk-0123abcd\.webp[\s\S]*Makes a new image of 2400 × 1200 px\. The original stays as it is\./);
  s.press("Square").click();
  assert.equal(s.press("Square").getAttribute("aria-pressed"), "true");
  assert.match(s.$(".vc-adjust").textContent, /1200 × 1200 px/);
  assert.equal(s.$(".vc-adjust-frame").style.left, "25%", "the square starts in the middle");
  s.$(".vc-adjust-frame").dispatchEvent(new s.window.KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true }));
  assert.equal(s.$(".vc-adjust-frame").style.left, "15%", "Shift + arrow moves it by 10 %");
  const width = s.$(".vc-adjust-width");
  assert.deepEqual([...width.options].map((option) => option.textContent), ["Full size (1200 px wide)", "800 px wide", "400 px wide"], "only widths smaller than the crop");
  width.value = "800"; width.dispatchEvent(new s.window.Event("change"));
  assert.match(s.$(".vc-adjust").textContent, /800 × 800 px/);
  s.press("Save as a new image").click();
  for (let i = 0; i < 20 && !s.calls.picked.length; i += 1) await s.settle();
  assert.deepEqual(s.calls.adjust.map((call) => [call.src, call.rect, call.size, call.name]), [[upload.src, { x: 360, y: 0, width: 1200, height: 1200 }, { width: 800, height: 800 }, "sam-at-the-desk-800x800"]], "cut from the original's pixels, named after it");
  assert.equal(s.calls.upload[0].name, "sam-at-the-desk-800x800.webp", "the copy is uploaded like any image");
  assert.equal(s.calls.picked[0].src, "/assets/uploads/2026/10/sam-at-the-desk-1200x1200-89abcdef.webp", "the new copy is chosen");
});

test("sheet: a failure changes nothing and says so; Back returns to the images", async () => {
  const s = sheet({ adjust: async () => { throw new Error("canvas exploded"); } });
  await s.settle(); await s.settle();
  s.$(".vc-tile").click();
  s.press("Crop or resize sam-at-the-desk-0123abcd.webp").click();
  await s.settle();
  s.press("Save as a new image").click();
  for (let i = 0; i < 20 && !/failed/.test(s.$(".vc-picker-status").textContent); i += 1) await s.settle();
  assert.equal(s.$(".vc-picker-status").textContent, "Adjustment failed. Your original image is unchanged — try again.");
  assert.deepEqual([s.calls.upload.length, s.calls.picked.length], [0, 0], "nothing uploaded, nothing chosen");
  assert.equal(s.press("Save as a new image").disabled, false, "Try again");
  s.press("Back to the images").click();
  assert.deepEqual([s.$(".vc-picker-library").hidden, s.$(".vc-adjust").hidden], [false, true]);
  const failedUpload = sheet({ uploadResult: { ok: false, message: "Too many uploads" } });
  await failedUpload.settle(); await failedUpload.settle();
  failedUpload.$(".vc-tile").click();
  failedUpload.press("Crop or resize sam-at-the-desk-0123abcd.webp").click();
  await failedUpload.settle();
  failedUpload.press("Save as a new image").click();
  for (let i = 0; i < 20 && !/failed/.test(failedUpload.$(".vc-picker-status").textContent); i += 1) await failedUpload.settle();
  assert.match(failedUpload.$(".vc-picker-status").textContent, /Adjustment failed/);
  assert.equal(failedUpload.calls.picked.length, 0);
});
