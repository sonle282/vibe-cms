// F7 (2026-10-29): a record's thumbnail in its collection's list — its image field, else its first gallery photo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { f, recordThumbnail } from "../dist/index.js";

const fields = {
  name: f.text({ label: "Name" }),
  listingImage: f.image({ label: "Main image", alt: true }),
  gallery: f.list(f.image({ label: "Gallery image", alt: true }), { label: "Gallery" }),
};

test("the image field wins when it has an image", () => {
  assert.equal(recordThumbnail(fields, { listingImage: { src: "/main.webp", alt: "" }, gallery: [{ src: "/g1.webp", alt: "" }] }), "/main.webp");
  assert.equal(recordThumbnail(fields, { listingImage: "/bare.webp", gallery: [] }), "/bare.webp");
});

test("an empty image field falls back to the first image of a list of images", () => {
  assert.equal(recordThumbnail(fields, { gallery: [{ src: "/g1.webp", alt: "" }, { src: "/g2.webp", alt: "" }] }), "/g1.webp");
  assert.equal(recordThumbnail(fields, { listingImage: { src: "", alt: "" }, gallery: ["", "/g2.webp"] }), "/g2.webp");
});

test("no image anywhere: no thumbnail", () => {
  assert.equal(recordThumbnail(fields, { name: "x", gallery: [] }), undefined);
  assert.equal(recordThumbnail(fields, null), undefined);
  assert.equal(recordThumbnail({ tags: f.list(f.text({ label: "Tag" }), { label: "Tags" }) }, { tags: ["/not-an-image.webp"] }), undefined);
});
