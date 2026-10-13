// M5: the image card of the Mr Spa CMS on a fake DOM — the meta line, Desktop | Mobile, a file dropped on the card
// (checked first, "Uploading… N%", then used with "Image added" / Undo), Set as main in a list of images, the formats.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { f } from "../dist/index.js";
import { cardBytes, createForm, imageFileProblem, middleTruncate, sheetBytes } from "../dist/admin/index.js";
import { imagesOfRecord } from "../dist/media/usage.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("formats: the middle of a long name is cut; sizes as the card and the sheet write them; file checks in plain words", () => {
  assert.equal(middleTruncate("showroom-new-desktop-1920.webp", 22), "showroom-ne…-1920.webp", "11 + … + 10 (the Mr Spa CMS's cut)");
  assert.equal(middleTruncate("short.webp", 22), "short.webp");
  assert.equal(middleTruncate("a".repeat(30), 22).length, 22);
  assert.deepEqual([cardBytes(500), cardBytes(198_000), cardBytes(1024 * 1024)], ["500 B", "193 KB", "1.0 MB"]);
  assert.deepEqual([sheetBytes(0), sheetBytes(1024 * 1024), sheetBytes(1.4 * 1024 * 1024)], ["", "1 MB", "1.4 MB"]);
  assert.equal(imageFileProblem({ type: "image/gif", size: 10 }, 1000), "This file type is not supported. Choose a JPEG, PNG, AVIF or WebP image.");
  assert.equal(imageFileProblem({ type: "image/png", size: 11 * 1024 * 1024 }, 10 * 1024 * 1024), "This file is larger than 10 MB. Choose a smaller image.");
  assert.equal(imageFileProblem({ type: "image/png", size: 0 }, 1000), "This file is empty. Choose another image.");
});

test("usage: images of a record — image fields (and their phone version), rich text and a Markdown body", () => {
  const fields = { hero: f.image({ label: "Hero", mobile: true }), "about.photo": f.image({ label: "Photo" }), text: f.richText({ label: "Text" }), gallery: f.list(f.image({ label: "Photo" }), { label: "Gallery" }) };
  const record = { hero: { src: "/a.jpg", mobile: "/a-m.jpg" }, about: { photo: "/b.jpg" }, text: '<p>Hi <img src="/c.jpg" alt=""></p>', gallery: ["/d.jpg", "/a.jpg"] };
  assert.deepEqual(imagesOfRecord(fields, record, "![x](/e.jpg)").sort(), ["/a-m.jpg", "/a.jpg", "/b.jpg", "/c.jpg", "/d.jpg", "/e.jpg"]);
});

const card = (fields, value, extra = {}) => {
  const window = new Window({ url: "http://localhost/admin" });
  const toasts = [];
  const form = createForm({ doc: window.document, fields, value, role: "owner", notify: (text, action) => toasts.push({ text, action }), ...extra });
  window.document.body.append(form.element);
  return { window, form, toasts, $: (selector) => form.element.querySelector(selector), $$: (selector) => [...form.element.querySelectorAll(selector)] };
};

test("card: the meta line (name · W × H · KB · Replace); Desktop | Mobile, with the Mr Spa note for a missing phone image", () => {
  const c = card({ hero: f.image({ label: "Hero image", mobile: true }) }, { hero: { src: "/images/showroom-new-desktop-1920.webp" } }, {
    pickImage: () => {}, imageInfo: (src) => (src.endsWith("1920.webp") ? { width: 1920, height: 1280, bytes: 198_000 } : undefined),
  });
  assert.equal(c.$(".vc-image-name").getAttribute("title"), "showroom-new-desktop-1920.webp");
  assert.equal(c.$(".vc-image-name").textContent.length, 22);
  assert.equal(c.$(".vc-image-details").textContent, "1920 × 1280 · 193 KB");
  assert.equal(c.$(".vc-image-replace").getAttribute("aria-label"), "Replace Hero image (desktop)");
  assert.deepEqual(c.$$(".vc-image-device").map((button) => [button.textContent, button.getAttribute("aria-checked")]), [["Desktop", "true"], ["Mobile", "false"]]);
  c.$('[data-device="mobile"]').click();
  assert.equal(c.$(".vc-image-empty").textContent, "Choose imageNo mobile image — the desktop image is used");
  assert.equal(c.$(".vc-image-empty").getAttribute("aria-label"), "Choose Hero image (mobile)");
  assert.equal(c.$(".vc-image-more"), null, "an empty slot has no ⋯");
});

test("card: a file dropped on it is checked, uploaded with its progress and used — “Image added” with Undo", async () => {
  let progress;
  let finish;
  const c = card({ photo: f.image({ label: "Photo" }) }, {}, {
    pickImage: () => {}, maxBytes: 10 * 1024 * 1024,
    uploadFile: (file, onProgress) => { progress = onProgress; return new Promise((resolve) => { finish = () => resolve({ ok: true, image: { src: "/assets/uploads/2026/10/chair-0123abcd.webp", bytes: 1000, source: "upload" } }); }); },
  });
  const drop = (files) => {
    const event = new c.window.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files } });
    c.$(".vc-image-card").dispatchEvent(event);
  };
  assert.equal(c.$(".vc-image-drop-hint").textContent, "Drop to add");
  drop([new c.window.File(["GIF89a"], "a.gif", { type: "image/gif" })]);
  assert.equal(c.$(".vc-image-drop-error").textContent, "This file type is not supported. Choose a JPEG, PNG, AVIF or WebP image.");
  drop([new c.window.File(["x"], "chair.png", { type: "image/png" }), new c.window.File(["y"], "two.png", { type: "image/png" })]);
  await settle();
  progress(0.5);
  assert.equal(c.$(".vc-image-progress-text").textContent, "Uploading… 45%");
  assert.ok(c.$(".vc-image-empty").disabled, "nothing else while uploading");
  finish();
  await settle();
  assert.equal(c.form.value().photo, "/assets/uploads/2026/10/chair-0123abcd.webp");
  assert.equal(c.toasts.at(-1).text, "Image added. Only one image can go here, so the first file was used.");
  c.toasts.at(-1).action.run();
  assert.ok(!("photo" in c.form.value()), "Undo: no image again");
});

test("card: a required image has no Remove; in a list of images, Set as main moves it to the front (Undo puts it back)", () => {
  const required = card({ logo: f.image({ label: "Logo", required: true }) }, { logo: "/logo.png" }, { pickImage: () => {} });
  required.$(".vc-image-more").click();
  assert.deepEqual(required.$$(".vc-image-menu-item").map((item) => item.textContent), ["Copy image link"]);
  const gallery = card({ photos: f.list(f.image({ label: "Photo" }), { label: "Photos", ordered: true, itemLabel: "Photo" }) }, { photos: ["/a.jpg", "/b.jpg"] }, { pickImage: () => {} });
  const second = gallery.$('[data-path="photos[1]"]');
  second.querySelector(".vc-image-more").click();
  assert.deepEqual([...second.querySelectorAll(".vc-image-menu-item")].map((item) => item.textContent), ["Set as main", "Copy image link"], "an image of a list has no Remove (the list has ×)");
  [...second.querySelectorAll(".vc-image-menu-item")].find((item) => item.textContent === "Set as main").click();
  assert.deepEqual(gallery.form.value().photos, ["/b.jpg", "/a.jpg"]);
  assert.equal(gallery.toasts.at(-1).text, "Main photo changed");
  gallery.toasts.at(-1).action.run();
  assert.deepEqual(gallery.form.value().photos, ["/a.jpg", "/b.jpg"]);
  gallery.$('[data-path="photos[0]"] .vc-image-more').click();
  assert.ok(![...gallery.$('[data-path="photos[0]"]').querySelectorAll(".vc-image-menu-item")].some((item) => item.textContent === "Set as main"), "the first is already the main one");
});
