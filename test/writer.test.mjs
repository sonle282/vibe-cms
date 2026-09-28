// P3: the JSON / Markdown writer keeps each file's formatting. Fixtures in test/fixtures/format are invented and cover:
// 2 / 4 spaces / tabs, LF / CRLF, final newline or not, BOM, key order and " : " spacing, number spellings, escapes and
// \uXXXX-only files, raw Unicode, one-line arrays / objects, empty containers, blank lines between items, a minified
// file, a json-array collection, and Markdown with front matter (LF, CRLF, quotes, comments, nested maps, lists).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { moveArrayItem, parseMarkdown, patchJson, patchMarkdown, sameValue, writeArrayItem, writeMarkdownItem } from "../dist/writer/index.js";
import { lineDiff, showDiff } from "./helpers/diff.mjs";

const dir = new URL("./fixtures/format/", import.meta.url);
const read = (name) => readFileSync(new URL(name, dir), "utf8");
const data = (text) => JSON.parse(text.replace(/^\uFEFF/, ""));

/** Apply `change` to the parsed file, patch, and check the content and the exact size of the line diff. */
const edit = (name, change, expected) => {
  const text = read(name);
  const next = data(text);
  change(next);
  const result = patchJson(text, next);
  assert.ok(sameValue(data(result), next), "the result parses to the new content");
  const diff = lineDiff(text, result);
  const message = `${name}\n${showDiff(diff)}`;
  if (expected.removed !== undefined) assert.equal(diff.removed.length, expected.removed, `removed lines — ${message}`);
  if (expected.added !== undefined) assert.equal(diff.added.length, expected.added, `added lines — ${message}`);
  for (const line of expected.lines ?? []) assert.ok(diff.added.some((added) => added.text === line), `adds ${JSON.stringify(line)} — ${message}`);
  if (expected.text !== undefined) assert.equal(result, expected.text);
  return { text, result, diff };
};
const one = (lineText) => ({ removed: 1, added: 1, lines: [lineText] });

// ------------------------------------------------------------------ unchanged = byte-identical

for (const name of readdirSync(dir).filter((file) => file.endsWith(".json")).sort()) {
  test(`unchanged ${name} is written back byte for byte`, () => {
    const text = read(name);
    assert.equal(patchJson(text, data(text)), text);
    assert.equal(patchJson(text, structuredClone(data(text))), text, "a deep copy too");
  });
}
for (const name of readdirSync(dir).filter((file) => file.endsWith(".md")).sort()) {
  test(`unchanged ${name} is written back byte for byte`, () => {
    const text = read(name);
    const record = parseMarkdown(text);
    assert.equal(patchMarkdown(text, { data: record.data, body: record.body }), text);
    assert.equal(writeMarkdownItem(text, { ...structuredClone(record.data), body: record.body }), text);
  });
}

test("key order in the new value does not matter: the file's order is kept", () => {
  const text = read("key-order-spacing.json");
  const reordered = Object.fromEntries(Object.entries(data(text)).reverse());
  assert.equal(patchJson(text, reordered), text);
});

// ------------------------------------------------------------------ one value = one line

test("2 spaces, LF: one nested value changes one line", () => { edit("indent2-lf.json", (d) => { d.address.city = "Newtown"; }, one('    "city": "Newtown"')); });
test("2 spaces: a value inside an array item", () => { edit("indent2-lf.json", (d) => { d.services[1].price = "$38"; }, one('      "price": "$38"')); });
test("4 spaces, CRLF, no final newline: one line, CRLF and missing newline kept", () => {
  const { result } = edit("indent4-crlf-nofinal.json", (d) => { d.title = "Changed"; }, one('    "title": "Changed",\r'));
  assert.ok(!result.endsWith("\n") && !/[^\r]\n/.test(result));
});
test("tabs: one line, tab indent kept", () => { edit("tabs.json", (d) => { d.rows[1].label = "Second"; }, one('\t\t\t"label": "Second"')); });
test('" : " spacing and odd key order stay', () => { edit("key-order-spacing.json", (d) => { d.mike.yankee = false; }, one('    "yankee" : false,')); });
test("numbers keep their spelling (1.50, 1e3, -0, huge ints) when another value changes", () => {
  const { result } = edit("numbers.json", (d) => { d.count = 8; }, one('  "count": 8,'));
  for (const spelling of ['"price": 1.50', '"exp": 1e3', '"upper": 1E+2', '"negativeZero": -0', '"zeroPointZero": 0.0', '"tiny": -1.5e-7', '"huge": 12345678901234567890']) assert.ok(result.includes(spelling), spelling);
});
test("a number written the same value another way is not rewritten (1.50 stays for 1.5)", () => {
  const text = read("numbers.json");
  const next = data(text); next.price = 1.5;
  assert.equal(patchJson(text, next), text);
});
test("an ASCII-only file (\\uXXXX escapes) gets escapes for new non-ASCII text; other escapes untouched", () => {
  const { result } = edit("strings-ascii.json", (d) => { d.plain = "déjà vu 💅"; }, one('  "plain": "d\\u00e9j\\u00e0 vu \\ud83d\\udc85"'));
  for (const kept of ['"line one\\nline two"', '"she said \\"hi\\""', '"C:\\\\salon\\\\menu"', '"a\\/b"', '"caf\\u00e9"', '"\\ud83d\\ude00"']) assert.ok(result.includes(kept), kept);
});
test("a file with raw Unicode gets raw Unicode", () => { edit("unicode-raw.json", (d) => { d.plain = "Tiệm mới ✨"; }, one('  "plain": "Tiệm mới ✨"')); });
test("a BOM stays", () => {
  const { result } = edit("bom.json", (d) => { d.name = "Still has a BOM"; }, one('  "name": "Still has a BOM"'));
  assert.ok(result.startsWith("\uFEFF{"));
});
test("blank lines between items stay", () => { edit("blank-lines.json", (d) => { d.groups[1].name = "Group 2"; }, one('      "name": "Group 2"')); });
test("one-line arrays and objects stay on one line", () => {
  edit("inline-arrays.json", (d) => { d.days.push(6); }, one('  "days": [1, 2, 3, 4, 5, 6],'));
  edit("inline-arrays.json", (d) => { d.tight.push(4); }, one('  "tight": [1,2,3,4],'));
  edit("inline-arrays.json", (d) => { d.pairs[1].v = 3; }, one('  "pairs": [{ "k": "a", "v": 1 }, { "k": "b", "v": 3 }],'));
  edit("inline-arrays.json", (d) => { d.sections[1].open = true; }, one('    { "id": "prices", "title": "Prices", "open": true },'));
});
test("a minified file stays minified", () => {
  edit("minified.json", (d) => { d.f = "changed"; }, { text: '{"a":1,"b":[1,2,3],"c":{"d":"e"},"f":"changed"}' });
  edit("minified.json", (d) => { d.g = [true]; delete d.a; }, { text: '{"b":[1,2,3],"c":{"d":"e"},"f":"one line","g":[true]}' });
});

// ------------------------------------------------------------------ items: add / remove / move

test("append an item: only the new item's lines", () => {
  edit("indent2-lf.json", (d) => { d.services.push({ id: "polish", name: "Polish change", price: "$12" }); }, { removed: 0, added: 5, lines: ["    },", '      "name": "Polish change",'] });
});
test("insert an item in the middle: only the new item's lines", () => {
  edit("indent2-lf.json", (d) => { d.services.splice(1, 0, { id: "buff", name: "Buff", price: "$8" }); }, { removed: 0, added: 5, lines: ['      "id": "buff",'] });
});
test("remove a middle item: only its lines", () => { edit("indent2-lf.json", (d) => { d.services.splice(1, 1); }, { removed: 5, added: 0 }); });
test("remove the last item: only its lines", () => { edit("indent2-lf.json", (d) => { d.services.pop(); }, { removed: 5, added: 0 }); });
test("move the last item to the top: only the moved item's lines", () => {
  const { result } = edit("indent2-lf.json", (d) => { d.services.unshift(d.services.pop()); }, { removed: 5, added: 5 });
  assert.ok(result.includes('      "id": "nail-art",'));
});
test("swap two neighbours in a CRLF / 4-space file: only those lines", () => {
  edit("indent4-crlf-nofinal.json", (d) => { d.items = ["second", "first", "third"]; }, { removed: 1, added: 1, lines: ['        "second",\r'] });
});
test("tabs: add and remove rows keep tabs", () => {
  edit("tabs.json", (d) => { d.rows.push({ id: "three", label: "Three" }); }, { removed: 0, added: 4, lines: ["\t\t},", '\t\t\t"id": "three",'] });
  edit("tabs.json", (d) => { d.rows.shift(); }, { removed: 4, added: 0 });
});
test("blank-line style is used for a new item", () => {
  edit("blank-lines.json", (d) => { d.groups.push({ id: "g3", name: "Group three" }); }, { removed: 0, added: 5, lines: ["    },", "", '      "id": "g3",'] });
});
test("a new item in a list of one-line objects is one line, in the same spacing", () => {
  edit("inline-arrays.json", (d) => { d.sections.push({ id: "faq", title: "FAQ", open: false }); }, { removed: 1, added: 2, lines: ['    { "id": "contact", "title": "Contact", "open": true },', '    { "id": "faq", "title": "FAQ", "open": false }'] });
  edit("inline-arrays.json", (d) => { d.compact.push({ id: "c3", n: 3 }); }, { removed: 1, added: 2, lines: ['    {"id":"c3","n":3}'] });
});
test("empty containers get their first item in the file's indent", () => {
  edit("empty-containers.json", (d) => { d.none.push("a"); }, { removed: 1, added: 3, lines: ['  "none": [', '    "a"', "  ],"] });
  edit("empty-containers.json", (d) => { d.filled = []; }, one('  "filled": [],'));
});

// ------------------------------------------------------------------ keys

test("add a key: one new line at the end of its object, in the object's spacing", () => {
  edit("indent2-lf.json", (d) => { d.address.zip = "00000"; }, { removed: 1, added: 2, lines: ['    "city": "Sampletown",', '    "zip": "00000"'] });
  edit("key-order-spacing.json", (d) => { d.mike.charlie = 3; }, { removed: 1, added: 2, lines: ['    "charlie" : 3'] });
});
test("remove a key: only its line", () => { edit("indent2-lf.json", (d) => { delete d.tagline; }, { removed: 1, added: 0 }); });

// ------------------------------------------------------------------ json-array collection helpers

test("writeArrayItem: replace one record → one line; add → appended; delete → its lines only", () => {
  const text = read("collection.json");
  const list = data(text);
  const replaced = writeArrayItem(text, "id", "spa-pedicure", { ...list[1], price: "$40" });
  assert.deepEqual(lineDiff(text, replaced).removed.map((r) => r.text), ['    "price": "$35",']);
  const added = writeArrayItem(text, "id", "french", { id: "french", name: "French Tips", price: "$25", extras: [] });
  assert.deepEqual([lineDiff(text, added).removed.length, lineDiff(text, added).added.length], [0, 6]);
  assert.equal(data(added).at(-1).id, "french");
  const deleted = writeArrayItem(text, "id", "nail-art", null);
  assert.deepEqual([lineDiff(text, deleted).removed.length, lineDiff(text, deleted).added.length], [6, 0]);
  assert.deepEqual(data(deleted).map((item) => item.id), ["classic-manicure", "spa-pedicure", "gel-removal"]);
});
test("moveArrayItem: the moved record keeps its exact bytes", () => {
  const text = read("collection.json");
  const moved = moveArrayItem(text, "id", "gel-removal", 1);
  assert.deepEqual(data(moved).map((item) => item.id), ["classic-manicure", "gel-removal", "spa-pedicure", "nail-art"]);
  const block = text.slice(text.indexOf('  {\n    "id": "gel-removal"'), text.lastIndexOf("}") + 1);
  assert.ok(moved.includes(block.trimStart()), "gel-removal's text is unchanged");
  const diff = lineDiff(text, moved);
  assert.ok(diff.removed.length <= 7 && diff.added.length <= 7, showDiff(diff));
});
test("one-line array inside an item: add an extra → only that line", () => {
  const text = read("collection.json");
  const list = data(text);
  const next = writeArrayItem(text, "id", "classic-manicure", { ...list[0], extras: ["Gel polish", "Cuticle oil"] });
  assert.deepEqual(lineDiff(text, next).added.map((a) => a.text), ['    "extras": ["Gel polish", "Cuticle oil"]']);
});

// ------------------------------------------------------------------ Markdown

const md = (name, change, expected) => {
  const text = read(name);
  const record = parseMarkdown(text);
  const next = { data: structuredClone(record.data), body: record.body };
  change(next);
  const result = patchMarkdown(text, next);
  const back = parseMarkdown(result);
  assert.ok(sameValue(back.data, next.data), "front matter parses to the new data");
  assert.equal(back.body.replace(/\r\n/g, "\n"), next.body.replace(/\r\n/g, "\n"));
  const diff = lineDiff(text, result);
  const message = `${name}\n${showDiff(diff)}`;
  if (expected.removed !== undefined) assert.equal(diff.removed.length, expected.removed, message);
  if (expected.added !== undefined) assert.equal(diff.added.length, expected.added, message);
  for (const line of expected.lines ?? []) assert.ok(diff.added.some((added) => added.text === line), `adds ${JSON.stringify(line)} — ${message}`);
  return result;
};

test("Markdown: one front-matter value → one line; key order and body kept", () => { md("md-basic.md", (r) => { r.data.title = "First post, edited"; }, { removed: 1, added: 1, lines: ["title: First post, edited"] }); });
test("Markdown: a list value re-writes only that entry", () => { md("md-basic.md", (r) => { r.data.tags = ["nails"]; }, { removed: 1, added: 0 }); });
test("Markdown: add / remove a key", () => {
  md("md-basic.md", (r) => { r.data.author = "Demo Writer"; }, { removed: 0, added: 1, lines: ["author: Demo Writer"] });
  md("md-basic.md", (r) => { delete r.data.status; }, { removed: 1, added: 0 });
});
test("Markdown: body change keeps the front matter byte for byte", () => {
  const result = md("md-basic.md", (r) => { r.body = r.body.replace("- two", "- two\n- three"); }, { removed: 0, added: 1, lines: ["- three"] });
  const text = read("md-basic.md");
  assert.equal(result.slice(0, text.indexOf("# First post")), text.slice(0, text.indexOf("# First post")));
});
test("Markdown CRLF: quote style, comments and CRLF kept", () => {
  md("md-crlf-quotes.md", (r) => { r.data.title = "It's new"; }, { removed: 1, added: 1, lines: ["title: 'It''s new'\r"] });
  md("md-crlf-quotes.md", (r) => { r.data.summary = "Still: double"; }, { removed: 1, added: 1, lines: ['summary: "Still: double"\r'] });
  md("md-crlf-quotes.md", (r) => { r.data.author.role = "owner"; }, { removed: 1, added: 1, lines: ["  role: owner\r"] });
  md("md-crlf-quotes.md", (r) => { r.body = "New body.\r\nSecond line.\r\n"; }, { removed: 1, added: 2 });
});
test("writeMarkdownItem: body in the content object, front matter from the rest", () => {
  const text = read("md-basic.md");
  const record = parseMarkdown(text);
  const result = writeMarkdownItem(text, { ...record.data, title: "Renamed", body: record.body });
  assert.deepEqual(lineDiff(text, result).added.map((a) => a.text), ["title: Renamed"]);
  assert.equal(writeMarkdownItem(undefined, { slug: "new", title: "New", body: "Hello\n" }), "---\nslug: new\ntitle: New\n---\nHello\n");
});
