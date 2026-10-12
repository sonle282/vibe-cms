/**
 * P11 / M2 `vibe-cms reset-admin-password [--username <name>]` (old name reset-owner-password; design §F.1 "an admin
 * forgot the password"): the admin (role code "owner") gets a
 * temporary password, shown once here, without anyone editing D1 by hand. Same effect as "Reset password" on People:
 * new hash (PBKDF2, same format), must change it at the next sign-in, every session signed out (session_version + 1),
 * one audit row (people · user_password_reset, by "cli") — never the password or the hash in the audit or the logs.
 */
import { hashPassword, normalizeUsername, temporaryPassword } from "../auth/password.js";
import { query, must, type Wrangler } from "./wrangler.js";
import { BINDINGS, findWranglerConfig } from "./wrangler-config.js";
import { CliError, type Log } from "./util.js";

type Owner = { id: string; username: string; status: string };
const SAFE = /^[A-Za-z0-9_.$-]+$/;

export const resetOwnerPassword = async ({ root, username, local = false, config, wrangler, log }: { root: string; username?: string; local?: boolean; config?: string; wrangler: Wrangler; log: Log }) => {
  const configRel = findWranglerConfig(root, config).slice(root.length + 1).split("\\").join("/");
  const owners = query<Owner>(wrangler, configRel, local, "SELECT id, username, status FROM cms_users WHERE role = 'owner' ORDER BY created_at, id");
  if (!owners.length) throw new CliError("this site has no admin yet", "sign in once with the bootstrap secrets (CMS_BOOTSTRAP_USERNAME / CMS_BOOTSTRAP_PASSWORD) to create the first admin");
  const wanted = username === undefined ? undefined : normalizeUsername(username);
  const owner = wanted ? owners.find((row) => row.username.toLowerCase() === wanted) : owners.length === 1 ? owners[0] : undefined;
  if (!owner) throw new CliError(wanted ? `no admin named "${wanted}"` : `this site has ${owners.length} admins`, `pass --username with one of: ${owners.map((row) => row.username).join(", ")}`);
  if (owner.status !== "active") throw new CliError(`the admin "${owner.username}" is disabled`, "another admin can enable them on People; the CLI does not re-enable accounts");
  if (!SAFE.test(owner.id)) throw new CliError(`unexpected user id ${JSON.stringify(owner.id)}`);

  const password = temporaryPassword();
  const hash = await hashPassword(password);
  const now = new Date().toISOString();
  if (![hash, now].every((value) => SAFE.test(value.replace(/[:T]/g, "")))) throw new CliError("could not build the update safely");
  const sql = [
    `UPDATE cms_users SET password_hash = '${hash}', must_change_password = 1, session_version = session_version + 1, password_changed_at = '${now}', updated_at = '${now}' WHERE id = '${owner.id}' AND role = 'owner'`,
    `INSERT INTO cms_audit_log (at, user_id, role, action, stage, resource, detail) VALUES ('${now}', '${owner.id}', 'owner', 'user_password_reset', 'people', 'user:${owner.id}', '{"by":"cli"}')`,
  ].join("; ");
  must(wrangler, ["d1", "execute", BINDINGS.db, local ? "--local" : "--remote", "--config", configRel, "--command", sql], "resetting the password");
  log([
    `Temporary password for the admin "${owner.username}" (shown once — give it to them privately):`,
    "",
    `  ${password}`,
    "",
    "They must choose their own password at the next sign-in. Every session of this admin is signed out.",
  ].join("\n"));
  return { userId: owner.id, username: owner.username, password };
};
