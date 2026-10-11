// P11 tests: a fake `wrangler` for the remote paths of `vibe-cms setup` — answers d1 / kv / r2 list + create and
// `d1 migrations apply` the way wrangler 4 prints them, with an account kept in a JSON file (FAKE_CF_STATE). Every call
// is recorded with the account it ran on (CLOUDFLARE_ACCOUNT_ID). Nothing leaves the machine.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const file = process.env.FAKE_CF_STATE;
const state = JSON.parse(readFileSync(file, "utf8"));
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "default";
state.accounts ??= {};
const cf = (state.accounts[account] ??= { d1: [], kv: [], r2: [], applied: {} });
const args = process.argv.slice(2);
state.calls = [...(state.calls ?? []), { account, args }];
const save = () => writeFileSync(file, JSON.stringify(state, null, 2));
const fail = (message) => { save(); process.stderr.write(`✘ [ERROR] ${message}\n`); process.exit(1); };
const id = (prefix) => `${prefix}${String(cf.d1.length + cf.kv.length + cf.r2.length + 1).padStart(4, "0")}${account.slice(0, 4)}`;
const option = (name) => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };

if (state.loggedOut) fail("You are not authenticated. Please run `wrangler login`.");
const [a, b, c, d] = args;
if (a === "d1" && b === "list") console.log(JSON.stringify(cf.d1.map((db) => ({ uuid: db.uuid, name: db.name, created_at: "2026-10-11T00:00:00Z", version: "production", num_tables: 0, file_size: 0 })), null, 2));
else if (a === "d1" && b === "create") { if (cf.d1.some((db) => db.name === c)) fail(`A database with that name already exists [code: 7502]`); cf.d1.push({ uuid: `00000000-0000-4000-8000-${id("d1").padStart(12, "0").slice(-12)}`, name: c }); console.log(`✅ Successfully created DB '${c}'`); }
else if (a === "kv" && b === "namespace" && c === "list") console.log(JSON.stringify(cf.kv.map((ns) => ({ id: ns.id, title: ns.title, supports_url_encoding: true })), null, "  "));
else if (a === "kv" && b === "namespace" && c === "create") { if (cf.kv.some((ns) => ns.title === d)) fail(`A KV namespace with the title "${d}" already exists.`); cf.kv.push({ id: id("kv").padEnd(32, "0"), title: d }); console.log(`🌀 Creating namespace with title "${d}"\n✨ Success!`); }
else if (a === "r2" && b === "bucket" && c === "list") console.log(`Listing buckets...\n${cf.r2.map((name) => `name:           ${name}\ncreation_date:  2026-10-11T00:00:00.000Z`).join("\n\n")}`);
else if (a === "r2" && b === "bucket" && c === "create") { if (cf.r2.includes(d)) fail(`The bucket you tried to create already exists [code: 10004]`); cf.r2.push(d); console.log(`Creating bucket '${d}'...\n✅ Created bucket '${d}' with default storage class of Standard.`); }
else if (a === "d1" && b === "migrations" && c === "apply") {
  const config = JSON.parse(readFileSync(resolve(option("--config")), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  const db = config.d1_databases.find((entry) => entry.binding === d);
  if (!cf.d1.some((entry) => entry.uuid === db.database_id)) fail(`Couldn't find a D1 DB with the name or binding '${d}'`);
  const all = readdirSync(join(dirname(resolve(option("--config"))), db.migrations_dir)).filter((name) => name.endsWith(".sql")).sort();
  const done = (cf.applied[db.database_id] ??= []);
  const todo = all.filter((name) => !done.includes(name));
  if (!todo.length) console.log("✅ No migrations to apply!");
  else { done.push(...todo); console.log(`Migrations to be applied:\n${todo.map((name) => `│ ${name} │`).join("\n")}\n${todo.map((name) => `│ ${name} │ ✅ │`).join("\n")}`); }
} else fail(`fake wrangler: unsupported ${args.join(" ")}`);
save();
