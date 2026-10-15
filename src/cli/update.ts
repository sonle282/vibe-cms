/**
 * P11 `vibe-cms update [version]` (design §E.0, §E.2): point the site at another release — the dependency URL in
 * package.json changes (nothing else in the file: the format-keeping writer), then `npm install`. Without a version:
 * the latest GitHub Release (public API, no token). The release must exist before anything is written. Afterwards the
 * CHANGELOG's "Site action" notes of every version in between are printed — read them before deploying.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { patchJson } from "../writer/json.js";
import { CliError, loopbackOverride, PACKAGE_NAME, type Log } from "./util.js";

export const RELEASES = "https://github.com/sonle282/vibe-cms/releases/download";
const API = "https://api.github.com";
const SEMVER = /^\d+\.\d+\.\d+$/;

export const releaseUrl = (version: string, base = RELEASES) => `${base}/v${version}/vibe-cms-${version}.tgz`;

const compare = (a: string, b: string) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

/** "Site action" notes of the CHANGELOG sections after `from` up to `to` (oldest first). */
export const siteActions = (changelog: string, from: string | undefined, to: string) => {
  const notes: string[] = [];
  for (const section of changelog.split(/^## /m).slice(1)) {
    const version = /^(\d+\.\d+\.\d+)/.exec(section)?.[1];
    if (!version || compare(version, to) > 0 || (from && compare(version, from) <= 0)) continue;
    const lines = section.split(/\r?\n/);
    // Two ways a release writes it: a list item "- **Site action:** …" (its indented lines follow), or inside the
    // release's first paragraph "**What it is.** Site action: none (…)." (the paragraph's next lines follow).
    const start = lines.findIndex((line) => /^- (\*\*)?Site action/.test(line) || /\bSite action:/.test(line));
    if (start === -1) continue;
    const listed = /^- /.test(lines[start]);
    const note = [lines[start].slice(listed ? 0 : lines[start].indexOf("Site action"))];
    for (const line of lines.slice(start + 1)) {
      if (listed ? !/^\s+\S/.test(line) : !line.trim() || /^(\s*- |#)/.test(line)) break;
      note.push(line.trim());
    }
    notes.unshift(`${version}: ${note.join(" ").replace(/^(- )?(\*\*)?Site action:?(\*\*)?:?\s*/, "")}`);
  }
  return notes;
};

const latest = async () => {
  const api = loopbackOverride("VIBE_CMS_GITHUB_API_URL", API);
  const response = await fetch(`${api}/repos/sonle282/vibe-cms/releases/latest`, { headers: { accept: "application/vnd.github+json", "user-agent": "vibe-cms-cli" } }).catch((error: Error) => { throw new CliError(`could not reach GitHub: ${error.message}`, "pass the version: npx vibe-cms update 0.14.0"); });
  if (response.status === 404) throw new CliError("no release is published yet");
  if (!response.ok) throw new CliError(`GitHub answered ${response.status} for the latest release`, "pass the version: npx vibe-cms update 0.14.0");
  const tag = String(((await response.json()) as { tag_name?: string }).tag_name ?? "").replace(/^v/, "");
  if (!SEMVER.test(tag)) throw new CliError(`the latest release has an unexpected tag "${tag}"`);
  return tag;
};

const npmInstall = (root: string) => {
  const execPath = process.env.npm_execpath;
  const run = execPath && /npm-cli\.[cm]?js$/.test(execPath)
    ? spawnSync(process.execPath, [execPath, "install", "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit" })
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (run.status !== 0) throw new CliError("npm install failed — package.json already points to the new release", "fix the npm error and run npm install, or run update again with the previous version");
};

export const update = async ({ root, version, install = true, log }: { root: string; version?: string; install?: boolean; log: Log }) => {
  const base = loopbackOverride("VIBE_CMS_RELEASES_URL", RELEASES);
  const wanted = version === undefined ? await latest() : version.replace(/^v/, "");
  if (!SEMVER.test(wanted)) throw new CliError(`"${version}" is not a version like 0.14.0`);
  const file = join(root, "package.json");
  if (!existsSync(file)) throw new CliError(`no package.json in ${root}`, "run the command in the site's folder");
  const text = readFileSync(file, "utf8");
  const pkg = JSON.parse(text.replace(/^﻿/, "")) as Record<string, unknown> & { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const section = pkg.dependencies?.[PACKAGE_NAME] !== undefined ? "dependencies" : pkg.devDependencies?.[PACKAGE_NAME] !== undefined ? "devDependencies" : undefined;
  if (!section) throw new CliError(`${PACKAGE_NAME} is not in package.json`, "install it first (README → Install)");
  const current = pkg[section]![PACKAGE_NAME];
  const from = /\/v(\d+\.\d+\.\d+)\/vibe-cms-\1\.tgz$/.exec(current)?.[1];
  const url = releaseUrl(wanted, base);
  if (current === url) { log(`Already on ${wanted} (${url}); nothing changed.`); return { changed: false, version: wanted, url }; }

  const head = await fetch(url, { method: "HEAD", redirect: "follow" }).catch((error: Error) => { throw new CliError(`could not reach ${url}: ${error.message}`); });
  if (!head.ok) throw new CliError(`release v${wanted} not found (${head.status} for ${url}) — nothing changed`, "check the version on https://github.com/sonle282/vibe-cms/releases");

  writeFileSync(file, patchJson(text, { ...pkg, [section]: { ...pkg[section], [PACKAGE_NAME]: url } }));
  log(`package.json: ${PACKAGE_NAME} ${from ?? current} → ${wanted}\n  ${url}`);
  if (!install) return { changed: true, version: wanted, url };

  npmInstall(root);
  const installedManifest = createRequire(file).resolve(`${PACKAGE_NAME}/package.json`);
  const installed = (JSON.parse(readFileSync(installedManifest, "utf8")) as { version: string }).version;
  if (installed !== wanted) throw new CliError(`npm installed ${installed}, not ${wanted}`, "delete node_modules/@sonle282 and run npm install");
  const changelog = join(dirname(installedManifest), "docs/CHANGELOG.md");
  const notes = existsSync(changelog) ? siteActions(readFileSync(changelog, "utf8"), from, wanted) : [];
  log(`Installed ${PACKAGE_NAME} ${installed}.${notes.length ? `\nSite action (CHANGELOG):\n${notes.map((note) => `  - ${note}`).join("\n")}` : " The CHANGELOG lists no site action for this step."}\nThen: npx vibe-cms migrate (remote) · npx vibe-cms check · build and compare the public HTML before deploying.`);
  return { changed: true, version: installed, url, notes };
};
