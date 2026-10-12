// P12e tests: a fake `wrangler d1 execute` that runs the SQL on real SQLite files (node:sqlite) — one file per database
// id from the --config file (FAKE_D1_DIR/<database_id>.sqlite), the same JSON wrangler prints with --json. Only what the
// CLI's data commands call: --command (one statement) and --file. Nothing leaves the machine.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const fail = (message) => { process.stderr.write(`✘ [ERROR] ${message}\n`); process.exit(1); };
const option = (name) => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
if (args[0] !== "d1" || args[1] !== "execute") fail(`sqlite wrangler: unsupported ${args.join(" ")}`);
const database = args[2];
let id = database;
const configFile = option("--config");
if (configFile) {
  const config = JSON.parse(readFileSync(resolve(configFile), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  const entry = (config.d1_databases ?? []).find((db) => db.binding === database || db.database_name === database);
  if (!entry) fail(`Couldn't find a D1 DB with the name or binding '${database}' in ${configFile}`);
  id = entry.database_id;
}
const db = new DatabaseSync(join(process.env.FAKE_D1_DIR, `${id}.sqlite`));
const file = option("--file");
let results = [];
try {
  if (file) db.exec(readFileSync(file, "utf8"));
  else results = db.prepare(option("--command")).all().map((row) => ({ ...row }));
} catch (error) { fail(error.message); }
if (args.includes("--json")) console.log(JSON.stringify([{ results, success: true, meta: { duration: 0 } }], null, 2));
else console.log("🚣 Executed");
