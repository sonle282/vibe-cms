// M4: the Link field (Page · Web address · Phone · Email, "Opens: …", plain-words errors, Save off while a link is
// wrong) and the Phone field (site.phone.country) of the Mr Spa CMS — the pure rules, the config, the value check, the
// boot's page list and the form on a fake DOM.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { checkCmsConfig, f, formatPhone, linkOpensText, linkProblem, parseHref, phoneHrefValue, phoneProblem, toHref } from "../dist/index.js";
import { checkRecordValues } from "../dist/check/values.js";
import { adminBoot, createForm, INVALID_LINK_REASON, LINK_PREVIEW_NOTE, linkPages, summarizeChanges, describeChange } from "../dist/admin/index.js";

const PAGES = [["/", "Home"], ["/about/", "About"], ["/services/", "Services"]];

test("an href comes back exactly as it was (parseHref → toHref), whatever its kind", () => {
  for (const href of ["", "/", "/about/", "/booking/?service=nails", "#menu", "https://www.instagram.com/mysalon/", "tel:+12157721111", "mailto:hello@salon.example?subject=Hi"]) {
    assert.equal(toHref(parseHref(href, PAGES), "US"), href, href);
  }
  assert.equal(toHref(parseHref("tel:8564385840")), "tel:8564385840", "no country: the digits as they were");
  assert.equal(parseHref("/about/", PAGES).kind, "page");
  assert.equal(parseHref("/booking/", PAGES).kind, "url", "a site address that is not one of the pages stays a Web address");
  assert.equal(parseHref("tel:+12157721111").kind, "phone");
  assert.equal(parseHref("mailto:a@b.co").kind, "email");
});

test("plain words for a link that cannot be saved (the Mr Spa CMS's messages)", () => {
  assert.equal(linkProblem({ kind: "page", value: "" }), null, "not required: no link is fine");
  assert.equal(linkProblem({ kind: "page", value: "" }, { required: true }), "Choose a page.");
  assert.equal(linkProblem({ kind: "url", value: "" }, { required: true }), "Enter a web address.");
  assert.equal(linkProblem({ kind: "url", value: "instagram" }), "Enter a full web address, like https://example.com or /about.");
  assert.equal(linkProblem({ kind: "url", value: "ftp://files.example" }), "Use a web address that starts with https://.");
  assert.equal(linkProblem({ kind: "url", value: "https://localhost" }), "Enter a full web address, like https://example.com.");
  assert.equal(linkProblem({ kind: "url", value: "/our team" }), "A page address cannot contain spaces.");
  assert.equal(linkProblem({ kind: "phone", value: "" }), "Enter a phone number.");
  assert.equal(linkProblem({ kind: "phone", value: "772-1111" }, { country: "US" }), "Enter a phone number with its area code, like (215) 772-1111.");
  assert.equal(linkProblem({ kind: "phone", value: "call us" }, { country: "US" }), "Use only numbers in the phone number.");
  assert.equal(linkProblem({ kind: "email", value: "hello@" }), "Enter an email address, like name@example.com.");
  assert.equal(linkProblem({ kind: "email", value: "hello@salon.example" }), null);
});

test("phone numbers follow the country: (215) 772-1111 and tel:+1… in the US; with the country code elsewhere", () => {
  assert.equal(phoneProblem("215.772.1111", "US"), null);
  assert.equal(phoneProblem("1 215 772 1111", "US"), null);
  assert.equal(formatPhone("215.772.1111", "US"), "(215) 772-1111");
  assert.equal(formatPhone("+1 215 772 1111", "CA"), "(215) 772-1111");
  assert.equal(phoneHrefValue("(215) 772-1111", "US"), "+12157721111");
  assert.equal(toHref({ kind: "phone", value: "(215) 772-1111" }, "US"), "tel:+12157721111");
  // No country (or another one): the number with its country code, or the local digits as written.
  assert.equal(phoneProblem("+44 20 7946 0958"), null);
  assert.equal(phoneProblem("+44 20"), "Enter the whole number after the +, like +1 215 772 1111.");
  assert.equal(phoneProblem("123", "GB"), "Enter the whole phone number, like +44 20 7946 0958.");
  assert.equal(formatPhone("+44  20 7946 0958", "GB"), "+44 20 7946 0958");
  assert.equal(phoneHrefValue("+44 20 7946 0958"), "+442079460958");
  assert.equal(formatPhone("856-438-5840", "US"), "(856) 438-5840");
  assert.equal(formatPhone("bad", "US"), "bad", "a number that cannot be used is left as written");
});

test("“Opens: …” says where a link really goes", () => {
  const opens = (href) => linkOpensText(href, "mysalon.example", "US");
  assert.equal(opens(""), "Opens: nothing (no link)");
  assert.equal(opens("/"), "Opens: mysalon.example");
  assert.equal(opens("/about/"), "Opens: mysalon.example/about/");
  assert.equal(opens("#menu"), "Opens: a section of this page (#menu)");
  assert.equal(opens("https://www.instagram.com/mysalon/?hl=en"), "Opens: instagram.com/mysalon/?…");
  assert.equal(opens("tel:+12157721111"), "Opens: call (215) 772-1111");
  assert.equal(opens("mailto:hello@salon.example?subject=Hi"), "Opens: email hello@salon.example");
});

const base = { configVersion: 1, site: { name: "S", url: "https://s.example" }, repo: { owner: "o", name: "r", branch: "main" }, collections: [] };
const problemsOf = (config) => checkCmsConfig(config).errors.map((problem) => `${problem.path}: ${problem.message}`);
const withFields = (fields, site = base.site) => ({ ...base, site, files: [{ key: "info", label: "Salon info", path: "src/data/info.json", format: "json", preview: "/", fields }] });

test("config: f.link and f.phone take the common options only; site.phone = { country }, site.pages = [{ path, label }]", () => {
  assert.deepEqual(problemsOf(withFields({ book: f.link({ label: "Book button", required: true }), phone: f.phone({ label: "Phone", locked: "admin" }) }, { ...base.site, phone: { country: "US" }, pages: [{ path: "/booking/", label: "Booking" }] })), []);
  assert.match(problemsOf(withFields({ book: { type: "link", label: "Book", options: ["/"] } })).join("\n"), /book\.options: unknown option for a link field/);
  assert.match(problemsOf(withFields({ a: f.text({ label: "A" }) }, { ...base.site, phone: { country: "usa" } })).join("\n"), /site\.phone: must be \{ country: "<2-letter code>" \}/);
  assert.match(problemsOf(withFields({ a: f.text({ label: "A" }) }, { ...base.site, phone: { country: "US", format: "x" } })).join("\n"), /site\.phone\.format: unknown setting/);
  const pages = problemsOf(withFields({ a: f.text({ label: "A" }) }, { ...base.site, pages: [{ path: "booking", label: "Booking" }, { path: "/a/", label: "" }, { path: "/a/", label: "A" }] })).join("\n");
  assert.match(pages, /site\.pages\[0\]\.path: must be an address on the site, starting with \//);
  assert.match(pages, /site\.pages\[1\]\.label: required/);
  assert.match(pages, /site\.pages\[2\]\.path: "\/a\/" is listed twice/);
  assert.match(problemsOf(withFields({ a: f.text({ label: "A" }) }, { ...base.site, host: "x" })).join("\n"), /site\.host: unknown setting/);
});

test("values: a link must be one the CMS can open; a phone number must be usable for the site's country", () => {
  const fields = { book: f.link({ label: "Book button" }), call: f.link({ label: "Call", required: true }), phone: f.phone({ label: "Phone" }) };
  const errors = (record, phoneCountry) => checkRecordValues({ fields, record, phoneCountry }).errors.map((problem) => `${problem.path}: ${problem.message}`);
  assert.deepEqual(errors({ book: "/booking/?service=nails", call: "tel:+12157721111", phone: "856-438-5840" }, "US"), []);
  assert.deepEqual(errors({ book: "www.salon", call: "tel:772", phone: "772-1111" }, "US"), [
    "book: Enter a full web address, like https://example.com or /about.",
    "call: Enter a phone number with its area code, like (215) 772-1111.",
    "phone: Enter a phone number with its area code, like (215) 772-1111.",
  ]);
  assert.deepEqual(errors({ call: "tel:+442079460958", phone: "+44 20 7946 0958" }), [], "no country: numbers with their country code");
  assert.match(errors({ book: "" }).join("\n"), /call: required \("Call"\) but missing/);
  assert.match(errors({ call: 5 }).join("\n"), /call: expected a link \(text\), got number 5/);
  assert.deepEqual(summarizeChanges({ fields, before: { call: "tel:+12157721111" }, after: { call: "tel:+12157721112" } }).map(describeChange), ["Call: tel:+12157721111 → tel:+12157721112"]);
});

test("boot: Link fields offer every file / collection with a fixed preview (each address once), then site.pages; site.phone goes along", () => {
  const config = {
    ...base,
    site: { ...base.site, phone: { country: "US" }, pages: [{ path: "/booking/", label: "Booking" }, { path: "/", label: "Start" }] },
    files: [
      { key: "home", label: "Home", path: "src/data/home.json", format: "json", preview: "/", fields: {} },
      { key: "reviews", label: "Reviews", path: "src/data/reviews.json", format: "json", preview: "/", fields: {} },
      { key: "info", label: "Salon info", path: "src/data/info.json", format: "json", fields: {} },
      { key: "seo", label: "SEO", path: "src/data/seo.json", format: "json", preview: "/about/", access: "admin", fields: {} },
    ],
    collections: [
      { key: "posts", label: "Posts", itemLabel: "Post", preview: "/blog/{slug}", store: { kind: "json-array", path: "src/data/posts.json", idField: "slug" }, fields: {} },
      { key: "services", label: "Services", itemLabel: "Service", preview: "/services/", store: { kind: "json-array", path: "src/data/services.json", idField: "id" }, fields: {} },
    ],
  };
  assert.deepEqual(linkPages(config), [["/", "Home"], ["/about/", "SEO"], ["/services/", "Services"], ["/booking/", "Booking"]], "a collection's list page too; not a record's own page");
  const boot = adminBoot(config, { id: "u", username: "e", displayName: "E", role: "editor" });
  assert.deepEqual(boot.site.pages, [["/", "Home"], ["/about/", "SEO"], ["/services/", "Services"], ["/booking/", "Booking"]], "the pages are public: an admin-only file's page is offered too");
  assert.deepEqual(boot.site.phone, { country: "US" });
});

const fields = { book: f.link({ label: "Book button", help: "Where the button goes." }), call: f.link({ label: "Call button", required: true }), phone: f.phone({ label: "Phone" }) };
const many = Array.from({ length: 9 }, (_, index) => [`/page-${index}/`, `Page ${index}`]);
const make = (value, extra = {}) => {
  const { window } = new Window();
  const changes = [];
  const form = createForm({ doc: window.document, fields, value, role: "owner", links: { pages: PAGES, host: "mysalon.example", country: "US" }, onChange: (_, path) => changes.push(path.join(".")), ...extra });
  window.document.body.append(form.element);
  return { window, form, changes, field: (key) => form.element.querySelector(`[data-path="${key}"]`) };
};
const kindOf = (field) => field.querySelector('.vc-link-kind[aria-checked="true"]').textContent;
const typeIn = (window, input, value) => { input.value = value; input.dispatchEvent(new window.Event("input", { bubbles: true })); };

test("form: the Link field shows its kind, the page list and where it opens; switching back gives the same href", () => {
  const { window, form, changes, field } = make({ book: "/about/", call: "tel:+12157721111" });
  const book = field("book");
  assert.equal(kindOf(book), "Page");
  assert.deepEqual([...book.querySelectorAll(".vc-link-kind")].map((button) => button.textContent), ["Page", "Web address", "Phone", "Email"]);
  assert.deepEqual([...book.querySelectorAll("select option")].map((option) => option.textContent), ["No link", "Home — /", "About — /about/", "Services — /services/"]);
  assert.equal(book.querySelector(".vc-link-opens").textContent, "Opens: mysalon.example/about/");
  assert.equal(book.querySelector(".vc-link-search"), null, "no Find a page with 8 pages or fewer");
  assert.equal(kindOf(field("call")), "Phone");
  assert.equal(field("call").querySelector("input").value, "(215) 772-1111");
  assert.equal(field("call").querySelector(".vc-link-opens").textContent, "Opens: call (215) 772-1111");
  // Page → Web address carries the address; back to Page: the same href, nothing changed.
  book.querySelector('[data-link-kind="url"]').click();
  assert.equal(book.querySelector("input.vc-link-text").value, "/about/");
  book.querySelector('[data-link-kind="page"]').click();
  assert.equal(form.value().book, "/about/");
  assert.deepEqual(changes, []);
  // Choosing another page writes its address.
  const select = book.querySelector("select");
  select.value = "/services/"; select.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(form.value().book, "/services/");
  assert.deepEqual(changes, ["book"]);
});

test("form: a wrong link is never written — it says why, “Opens: … — until this is fixed”, and Save waits", () => {
  const { window, form, field } = make({ book: "/about/", call: "tel:+12157721111" });
  const book = field("book");
  book.querySelector('[data-link-kind="url"]').click();
  typeIn(window, book.querySelector("input.vc-link-text"), "instagram");
  assert.equal(form.value().book, "/about/", "the content keeps the last good link");
  assert.equal(book.querySelector(".vc-link-error").textContent, "Enter a full web address, like https://example.com or /about.");
  assert.equal(book.querySelector(".vc-link-opens").textContent, "Opens: mysalon.example/about/ — until this is fixed");
  assert.equal(form.invalidLinks(), 1);
  assert.equal(INVALID_LINK_REASON, "Fix the link marked in red before saving.");
  typeIn(window, book.querySelector("input.vc-link-text"), "https://www.instagram.com/mysalon/");
  assert.equal(form.value().book, "https://www.instagram.com/mysalon/");
  assert.equal(form.invalidLinks(), 0);
  assert.ok(book.querySelector(".vc-link-error").hidden);
  // Phone: typed loosely, written as tel:+1…, shown the way people read it once the person leaves the box.
  const call = field("call");
  const input = call.querySelector("input");
  typeIn(window, input, "856.438.5840");
  assert.equal(form.value().call, "tel:+18564385840");
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(input.value, "(856) 438-5840");
  // A required link emptied: "Choose a page." — the old link stays.
  call.querySelector('[data-link-kind="page"]').click();
  assert.equal(call.querySelector(".vc-link-error").textContent, "Choose a page.");
  assert.equal(form.value().call, "tel:+18564385840");
});

test("form: “Find a page” above more than 8 pages; Enter picks the first match; showing another value does not change it", () => {
  const { window, form, changes, field } = make({ book: "" }, { links: { pages: many, host: "mysalon.example", country: "US" } });
  const book = field("book");
  const search = book.querySelector(".vc-link-search");
  assert.equal(search.placeholder, "Find a page");
  typeIn(window, search, "page 7");
  assert.deepEqual([...book.querySelectorAll("select option")].filter((option) => !option.hidden).map((option) => option.value), ["", "/page-7/"]);
  search.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(form.value().book, "/page-7/");
  form.setValue(["book"], "mailto:hello@salon.example");
  assert.equal(kindOf(book), "Email");
  assert.equal(book.querySelector(".vc-link-opens").textContent, "Opens: email hello@salon.example");
  assert.deepEqual(changes, ["book", "book"]);
});

test("form: the Phone field is a tel box; a usable number is written as people read it; the inspector notes a link's destination", () => {
  const { window, form, field } = make({ phone: "856-438-5840" }, { previewNotes: true });
  const input = field("phone").querySelector("input");
  assert.deepEqual([input.type, input.getAttribute("inputmode"), input.placeholder], ["tel", "tel", "(215) 772-1111"]);
  assert.equal(form.value().phone, "856-438-5840", "the saved value stays as it is until the person changes it");
  typeIn(window, input, "2157721111");
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(input.value, "(215) 772-1111");
  assert.equal(form.value().phone, "(215) 772-1111");
  typeIn(window, input, "772");
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(form.value().phone, "772", "a number that cannot be used stays as typed (the check says why at save)");
  assert.equal(field("book").querySelector(".vc-help").textContent, `Where the button goes. ${LINK_PREVIEW_NOTE}`);
  assert.equal(field("phone").querySelector(".vc-preview-only"), null);
});
