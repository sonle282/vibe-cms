// F3: carrying a draft over to content that changed on the website after it was started.
import assert from "node:assert/strict";
import { test } from "node:test";
import { conflictLabel, rebase } from "../dist/api/index.js";

test("a field only the website changed comes in; a field only the draft changed stays", () => {
  const base = { name: "Salon", tagline: "Old", hours: { mon: "9–5", tue: "9–5" } };
  const theirs = { name: "Salon Spa", tagline: "Old", hours: { mon: "9–5", tue: "10–6" } };
  const mine = { name: "Salon", tagline: "New", hours: { mon: "8–4", tue: "9–5" } };
  assert.deepEqual(rebase(base, theirs, mine), { content: { name: "Salon Spa", tagline: "New", hours: { mon: "8–4", tue: "10–6" } }, conflicts: [] });
});

test("both sides changing a field the same way is no conflict", () => {
  assert.deepEqual(rebase({ a: 1 }, { a: 2 }, { a: 2 }), { content: { a: 2 }, conflicts: [] });
});

test("both sides changing a field differently is a conflict, named by its path; the draft's value is kept", () => {
  const result = rebase({ hero: { title: "A", text: "x" } }, { hero: { title: "B", text: "x" } }, { hero: { title: "C", text: "y" } });
  assert.deepEqual(result.conflicts, ["hero.title"]);
  assert.deepEqual(result.content, { hero: { title: "C", text: "y" } });
});

test("a list is one field: changed on both sides it is a conflict, never spliced", () => {
  const result = rebase({ order: ["a", "b", "c"] }, { order: ["b", "a", "c"] }, { order: ["a", "c", "b"] });
  assert.deepEqual(result.conflicts, ["order"]);
  assert.deepEqual(rebase({ order: ["a", "b"] }, { order: ["a", "b"] }, { order: ["b", "a"] }).content, { order: ["b", "a"] });
});

test("added and removed keys follow the side that changed them", () => {
  assert.deepEqual(rebase({ a: 1, b: 2 }, { a: 1 }, { a: 1, b: 2, c: 3 }).content, { a: 1, c: 3 });
  assert.deepEqual(rebase({ a: 1 }, { a: 1, extra: true }, {}).content, { extra: true });
  assert.deepEqual(rebase({ a: 1 }, {}, { a: 5 }).conflicts, ["a"]);
});

test("key order and missing-vs-undefined do not count as changes", () => {
  assert.deepEqual(rebase({ a: 1, b: 2 }, { b: 2, a: 1 }, { a: 1, b: 3 }), { content: { a: 1, b: 3 }, conflicts: [] });
});

test("conflict paths read as field labels", () => {
  const fields = { hero: { type: "object", label: "Hero", fields: { title: { type: "text", label: "Title" } } }, name: { type: "text", label: "Salon name" } };
  assert.equal(conflictLabel(fields, "hero.title"), "Hero › Title");
  assert.equal(conflictLabel(fields, "name"), "Salon name");
  assert.equal(conflictLabel(fields, "unknown.part"), "unknown › part");
  assert.equal(conflictLabel(fields, ""), "Everything");
});
