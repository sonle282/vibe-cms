// The release tarball (npm pack) holds what a site needs and nothing else: compiled code, the Astro routes as source,
// the D1 migrations, package.json, README, LICENSE, CHANGELOG — no tests, fixtures, scripts, docs drafts or TypeScript sources.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

const [pack] = JSON.parse(execSync("npm pack --dry-run --json --ignore-scripts", { encoding: "utf8" }));
const files = pack.files.map((file) => file.path).sort();
for (const needed of ["package.json", "README.md", "LICENSE", "docs/CHANGELOG.md", "dist/index.js", "dist/index.d.ts", "dist/integration.js", "dist/load-config.js", "dist/config/index.js", "dist/config/validate.js", "dist/check/content.js", "dist/writer/index.js", "dist/writer/json.js", "dist/writer/markdown.js", "dist/store/index.js", "migrations/0001_draft_index.sql", "migrations/0002_draft_content.sql", "migrations/0003_audit_log.sql", "dist/locks/index.js", "dist/api/index.js", "dist/api/github.js", "dist/check/values.js", "dist/auth/index.js", "dist/auth/password.js", "dist/api/runtime.js", "src/routes/auth.ts", "migrations/0004_users.sql", "migrations/0005_audit_log_auth.sql", "src/routes/api.ts", "dist/store/audit.js", "src/routes/admin.astro", "src/routes/health.ts", "src/virtual.d.ts", "src/routes/admin.css", "dist/admin/index.js", "dist/admin/app.js", "dist/admin/form.js", "dist/admin/changes.js", "dist/admin/people.js"]) assert.ok(files.includes(needed), `the tarball has ${needed}`);
const stray = files.filter((file) => /^(test|fixtures|scripts|\.github)\//.test(file) || (file.startsWith("src/") && !file.startsWith("src/routes/") && file !== "src/virtual.d.ts") || (file.startsWith("docs/") && file !== "docs/CHANGELOG.md") || /(^|\/)\.(env|dev\.vars)/.test(file));
assert.deepEqual(stray, [], "nothing else goes into the tarball");
console.log(`Pack OK: ${pack.filename} → vibe-cms-${pack.version}.tgz, ${files.length} files, ${(pack.size / 1024).toFixed(1)} KB.`);
