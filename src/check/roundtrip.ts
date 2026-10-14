/**
 * P20: the round-trip — every record written back unchanged by the format-keeping writer (the one publish uses) must
 * give its file byte for byte. A record that does not is one a publish would rewrite beyond its own lines: the site's
 * formatting is one the writer cannot keep (say so before the CMS is switched on, not after a publish).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CmsConfig } from "../config/index.js";
import { fileRecord, storeRecords, withFileRecord } from "../config/store.js";
import { parseMarkdown } from "../writer/markdown.js";
import { patchJsonDetailed, writeMarkdownItem, writeStoreItem } from "../writer/index.js";

export type RoundTrip = { records: number; files: number; problems: Array<{ path: string; message: string }> };

export const checkRoundTrip = (config: CmsConfig, root: string): RoundTrip => {
  const result: RoundTrip = { records: 0, files: 0, problems: [] };
  const seen = new Set<string>();
  const read = (path: string) => { const file = join(root, path); return existsSync(file) ? readFileSync(file, "utf8") : undefined; };
  const same = (path: string, label: string, text: string, written: string) => {
    result.records += 1;
    if (written !== text) {
      const at = [...text].findIndex((char, index) => written[index] !== char);
      const line = text.slice(0, at < 0 ? text.length : at).split("\n").length;
      result.problems.push({ path, message: `${label}: written back unchanged, the file differs from line ${line} — a publish would rewrite more than this record` });
    }
  };
  for (const file of config.files) {
    const text = read(file.path);
    if (text === undefined) continue;
    if (!seen.has(file.path)) { seen.add(file.path); result.files += 1; }
    const data = JSON.parse(text.replace(/^﻿/, ""));
    const record = fileRecord(file, data);
    if (record === undefined) continue;
    same(file.path, file.pointer ? `${file.key} (${file.pointer})` : file.key, text, patchJsonDetailed(text, withFileRecord(file, data, record)).text);
  }
  for (const collection of config.collections) {
    const store = collection.store;
    if (store.kind === "markdown-dir") {
      const dir = join(root, store.dir);
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".md")).sort()) {
        const path = `${store.dir}/${name}`;
        const text = read(path)!;
        result.files += 1;
        const { data, body } = parseMarkdown(text);
        same(path, `${collection.key}: ${name}`, text, writeMarkdownItem(text, { ...data, body }).text);
      }
      continue;
    }
    const text = read(store.path);
    if (text === undefined) continue;
    if (!seen.has(store.path)) { seen.add(store.path); result.files += 1; }
    const found = storeRecords(store, JSON.parse(text.replace(/^﻿/, "")));
    if (typeof found === "string") continue;
    for (const { id, record } of found) same(store.path, `${collection.key}: ${String(id)}`, text, writeStoreItem(store, text, String(id), record as Record<string, unknown>).text);
  }
  return result;
};
