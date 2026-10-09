// P8b: the People and My account screens on a fake DOM (happy-dom), against the REAL sign-in + People code (P6) on
// node:sqlite with the package migrations and a memory KV, signed in with a real session cookie.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { contentPaths, createBundledSource, createCmsApi, createCmsAuth, createD1AuditLog, createD1DraftStore, hashPassword, insertUser, loadCmsConfig } from "../dist/index.js";
import { adminBoot, startAdmin } from "../dist/admin/index.js";
import { createSqliteD1, memoryKv } from "./helpers/sqlite-d1.mjs";

const demoRoot = fileURLToPath(new URL("../fixtures/demo-site/", import.meta.url));
let config; let files;
before(async () => {
  config = await loadCmsConfig(join(demoRoot, "cms.config.ts"));
  files = Object.fromEntries(contentPaths(config, demoRoot).map((path) => [path, readFileSync(join(demoRoot, path), "utf8")]));
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const until = async (test, what) => { for (let i = 0; i < 400; i += 1) { if (test()) return; await new Promise((resolve) => setTimeout(resolve, 5)); } assert.fail(`timed out waiting for ${what}`); };
const type = (window, element, value) => { element.value = value; element.dispatchEvent(new window.Event("input", { bubbles: true })); };

const OWNER = { username: "owner", password: "owner-password-456" };
const setup = async ({ as = "owner", confirm = () => true } = {}) => {
  const db = createSqliteD1();
  const now = Date.UTC(2026, 9, 8, 9);
  const kv = memoryKv(() => Date.now());
  const audit = createD1AuditLog(db);
  const at = new Date(now).toISOString();
  const ownerRow = { id: "usr_ownerownerowner1", username: OWNER.username, display_name: "Olivia Owner", password_hash: await hashPassword(OWNER.password), role: "owner", status: "active", must_change_password: 0, session_version: 1, created_at: at, updated_at: at, last_login_at: null, password_changed_at: at, legacy_id: null };
  await insertUser(db, ownerRow);
  const auth = createCmsAuth({ db, kv, audit, siteUrl: config.site.url });
  const api = createCmsApi({ config, source: createBundledSource(files), drafts: createD1DraftStore(db), audit, identify: auth.identify, people: auth.people });
  const route = (request) => (new URL(request.url).pathname.startsWith("/api/auth/") ? auth.handleAuth(request) : api.handle(request));
  /** A browser-like cookie jar per person. */
  const browserFor = () => {
    let cookie = "";
    const fetch = async (url, init = {}) => {
      const response = await route(new Request(new URL(url, "http://localhost"), { ...init, headers: { ...(init.headers ?? {}), origin: "http://localhost", ...(cookie ? { cookie: `vibe_cms_session=${cookie}` } : {}) } }));
      const set = /vibe_cms_session=([^;]*)/.exec(response.headers.get("set-cookie") ?? "");
      if (set) cookie = set[1];
      return response;
    };
    const login = async (username, password) => (await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) })).json();
    const json = async (method, url, body) => (await fetch(url, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })).json();
    return { fetch, login, json };
  };
  const ownerBrowser = browserFor();
  assert.equal((await ownerBrowser.login(OWNER.username, OWNER.password)).ok, true);
  let boot = adminBoot(config, { id: ownerRow.id, username: OWNER.username, displayName: "Olivia Owner", role: "owner" });
  let browser = ownerBrowser;
  if (as === "editor") {
    const created = await ownerBrowser.json("POST", "/api/cms/users", { username: "eddie", role: "editor", password: "editor-password-1" });
    await db.prepare("UPDATE cms_users SET must_change_password = 0 WHERE username = 'eddie'").run();
    browser = browserFor();
    await browser.login("eddie", "editor-password-1");
    boot = adminBoot(config, { id: created.user.id, username: "eddie", displayName: "eddie", role: "editor" });
  }
  const window = new Window({ url: "http://localhost/admin" });
  const root = window.document.createElement("div");
  window.document.body.append(root);
  const asked = [];
  const app = startAdmin({ root, boot, fetch: browser.fetch, window, storage: null, confirm: (message) => { asked.push(message); return confirm(message); } });
  await app.ready;
  const go = async (hash) => { window.location.hash = hash; await settle(); await app.idle(); };
  const rowOf = (username) => root.querySelector(`tr[data-user="${username}"]`);
  const button = (scope, name) => [...scope.querySelectorAll("button")].find((element) => element.getAttribute("aria-label") === name || element.textContent === name);
  return { db, window, root, go, rowOf, button, asked, browserFor, ownerBrowser, toast: () => root.querySelector(".vc-toast").textContent };
};
const addPerson = async (h, username, displayName = "", role = "editor") => {
  type(h.window, h.root.querySelector("#vc-new-username"), username);
  type(h.window, h.root.querySelector("#vc-new-name"), displayName);
  h.root.querySelector("#vc-new-role").value = role;
  h.root.querySelector("form.vc-people-add").dispatchEvent(new h.window.Event("submit", { bubbles: true, cancelable: true }));
};

test("People: owners see it in the navigation; the list shows everyone, with no actions on yourself", async () => {
  const h = await setup();
  const nav = [...h.root.querySelectorAll(".vc-nav-list a")].map((a) => a.textContent.trim());
  assert.ok(nav.includes("People"));
  await h.go("#/people");
  assert.equal(h.root.querySelector("h1").textContent, "People");
  const me = h.rowOf("owner");
  // Last sign-in: today (the setup signed in just now), in the browser's own date format.
  const today = new Date().toLocaleString([], { day: "numeric", month: "short", year: "numeric" });
  assert.ok(me.textContent.startsWith(`Olivia Owner owner (you)OwnerActive${today}`), me.textContent);
  assert.equal(me.querySelector("select"), null, "no role menu on yourself");
  assert.equal(h.button(me, "Disable"), undefined, "you cannot disable yourself");
  for (const form of h.root.querySelectorAll("form")) assert.equal(form.getAttribute("method"), "post");
});

test("People: add a person → the temporary password is shown once and really signs them in; problems are explained", async () => {
  const h = await setup();
  await h.go("#/people");
  await addPerson(h, "Editor1", "Eddie Editor");
  await until(() => h.rowOf("editor1"), "the new row");
  const secret = h.root.querySelector(".vc-secret");
  assert.equal(secret.hidden, false);
  const password = secret.querySelector(".vc-secret-value").textContent;
  assert.match(password, /^[A-Za-z2-9]{20}$/);
  assert.match(secret.textContent, /Added — temporary password for Eddie Editor \(editor1\)/);
  assert.match(h.rowOf("editor1").textContent, /Must choose a password/);
  assert.equal(h.root.querySelector("#vc-new-username").value, "", "the form is cleared");
  const editor = h.browserFor();
  const first = await editor.login("editor1", password);
  assert.deepEqual([first.ok, first.mustChangePassword], [true, true], "the shown password is the real one");
  h.button(secret, "Done — hide it").click();
  assert.equal(secret.hidden, true);
  assert.equal(secret.textContent, "", "gone from the page");

  await addPerson(h, "editor1");
  await until(() => h.root.querySelector(".vc-people-add .vc-error").textContent, "the duplicate error");
  assert.equal(h.root.querySelector(".vc-people-add .vc-error").textContent, "That username is already in use.");
  await addPerson(h, "a b");
  await until(() => /Username must be 3-32/.test(h.root.querySelector(".vc-people-add .vc-error").textContent), "the invalid-name error");
});

test("People: change role (asks first), disable (signed out at once) / enable, reset password (old one stops working)", async () => {
  let answer = true;
  const h = await setup({ confirm: () => answer });
  await h.go("#/people");
  await addPerson(h, "eddie", "Ed");
  await until(() => h.rowOf("eddie"), "the new row");
  const password = h.root.querySelector(".vc-secret-value").textContent;
  const ed = h.browserFor();
  await ed.login("eddie", password);
  await ed.json("PUT", "/api/auth/password", { currentPassword: password, newPassword: "ed-own-password-1" });
  assert.equal((await ed.json("GET", "/api/auth/me")).user.role, "editor");

  // Role: saying no changes nothing; yes makes Ed an owner at once.
  answer = false;
  const select = h.rowOf("eddie").querySelector("select");
  select.value = "owner"; select.dispatchEvent(new h.window.Event("change"));
  await settle();
  assert.equal(select.value, "editor");
  assert.match(h.asked.at(-1), /Make Ed an owner\?/);
  answer = true;
  select.value = "owner"; select.dispatchEvent(new h.window.Event("change"));
  await until(() => /now an owner/.test(h.toast()), "the role change");
  assert.equal((await ed.json("GET", "/api/auth/me")).user.role, "owner");
  assert.equal(h.rowOf("eddie").querySelector("select").value, "owner");

  // Disable → Ed's session ends; enable → can sign in again.
  h.button(h.rowOf("eddie"), "Disable Ed").click();
  await until(() => /Disabled/.test(h.rowOf("eddie").textContent), "disabled");
  assert.match(h.asked.at(-1), /Disable Ed\?[\s\S]*signed out at once/);
  assert.equal((await ed.json("GET", "/api/auth/me")).error, "unauthenticated");
  assert.equal((await ed.login("eddie", "ed-own-password-1")).error, "invalid_credentials");
  h.button(h.rowOf("eddie"), "Enable Ed").click();
  await until(() => /Active/.test(h.rowOf("eddie").textContent), "enabled");
  assert.equal((await ed.login("eddie", "ed-own-password-1")).ok, true);

  // Reset → a new temporary password; the old password no longer works.
  h.button(h.rowOf("eddie"), "Reset password of Ed").click();
  await until(() => /Password reset — temporary password for Ed/.test(h.root.querySelector(".vc-secret").textContent), "the new temporary password");
  const temporary = h.root.querySelector(".vc-secret-value").textContent;
  assert.equal((await ed.login("eddie", "ed-own-password-1")).error, "invalid_credentials");
  assert.equal((await ed.login("eddie", temporary)).mustChangePassword, true);
});

test("People: a refusal from the server is shown on the list (here: another owner made me an editor meanwhile)", async () => {
  const h = await setup();
  await h.go("#/people");
  await addPerson(h, "coowner", "Co Owner", "owner");
  await until(() => h.rowOf("coowner"), "the new owner");
  // The other owner makes me an editor; my page still shows People, and the server refuses my next change.
  const co = h.browserFor();
  const temporary = h.root.querySelector(".vc-secret-value").textContent;
  await co.login("coowner", temporary);
  await co.json("PUT", "/api/auth/password", { currentPassword: temporary, newPassword: "co-owner-password-1" });
  const ownerId = h.db.raw.prepare("SELECT id FROM cms_users WHERE username = 'owner'").get().id;
  assert.equal((await co.json("PATCH", `/api/cms/users/${ownerId}`, { action: "set-role", role: "editor" })).ok, true);
  const select = h.rowOf("coowner").querySelector("select");
  select.value = "editor"; select.dispatchEvent(new h.window.Event("change"));
  await until(() => [...h.root.querySelectorAll(".vc-error")].some((element) => element.textContent.startsWith("Co Owner:")), "the refusal");
  const errors = [...h.root.querySelectorAll(".vc-error")].map((element) => element.textContent).join(" ");
  assert.match(errors, /Co Owner: Only an owner can manage people\./);
  assert.equal(h.rowOf("coowner").querySelector("select").value, "owner", "the list shows what is true");
});

test("People: editors do not see it, and the screen says why", async () => {
  const h = await setup({ as: "editor" });
  assert.ok(![...h.root.querySelectorAll(".vc-nav-list a")].some((a) => a.textContent.trim() === "People"));
  await h.go("#/people");
  assert.match(h.root.querySelector(".vc-body").textContent, /Only an owner can manage people/);
});

test("My account: who I am; change my password (checks, wrong current password, success keeps me signed in)", async () => {
  const h = await setup();
  assert.equal(h.root.querySelector(".vc-user-name").getAttribute("href"), "#/account");
  await h.go("#/account");
  const facts = h.root.querySelector(".vc-account-facts").textContent;
  assert.match(facts, /NameOlivia OwnerUsernameownerRoleOwner/);
  const form = h.root.querySelector("form.vc-account");
  assert.equal(form.getAttribute("method"), "post");
  const submit = () => form.dispatchEvent(new h.window.Event("submit", { bubbles: true, cancelable: true }));
  const error = () => form.querySelector(".vc-error").textContent;
  type(h.window, form.querySelector("#vc-pw-current"), OWNER.password);
  type(h.window, form.querySelector("#vc-pw-new"), "brand-new-password-1");
  type(h.window, form.querySelector("#vc-pw-again"), "brand-new-password-2");
  submit();
  assert.equal(error(), "The two new passwords are not the same.");
  type(h.window, form.querySelector("#vc-pw-current"), "not-my-password");
  type(h.window, form.querySelector("#vc-pw-again"), "brand-new-password-1");
  submit();
  await until(() => error(), "the wrong-password error");
  assert.equal(error(), "Current password is incorrect.");
  type(h.window, form.querySelector("#vc-pw-current"), OWNER.password);
  type(h.window, form.querySelector("#vc-pw-new"), "brand-new-password-1");
  type(h.window, form.querySelector("#vc-pw-again"), "brand-new-password-1");
  submit();
  await until(() => /Password changed/.test(h.toast()), "the change");
  assert.equal(form.querySelector("#vc-pw-new").value, "", "the fields are cleared");
  await h.go("#/people");
  assert.equal(h.root.querySelector("h1").textContent, "People", "still signed in here");
  const other = h.browserFor();
  assert.equal((await other.login(OWNER.username, OWNER.password)).error, "invalid_credentials");
  assert.equal((await other.login(OWNER.username, "brand-new-password-1")).ok, true);
});
