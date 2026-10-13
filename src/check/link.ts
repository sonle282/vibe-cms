/**
 * M4: the Link and Phone fields, as in the Mr Spa CMS (its link-field.ts) — pure, so the admin, the build check and the
 * Worker share it.
 *
 * A link is saved as the same href string the site already has: parseHref → toHref gives back the exact string, so
 * opening a link and leaving it changes nothing. The editor picks what it opens — a Page of the site, a Web address, a
 * Phone number or an Email — and always sees where it goes ("Opens: mysalon.example/about").
 *
 * Phone numbers follow `site.phone.country`: "US" / "CA" (North American numbers: area code + 7 digits, shown
 * "(215) 772-1111", called as tel:+12157721111); any other country, or none, takes a number with its country code
 * ("+44 20 7946 0958") or the local digits as written.
 */

export type LinkKind = "page" | "url" | "phone" | "email";
export type LinkValue = { kind: LinkKind; value: string };
/** [path, name] of the pages a link may open. */
export type LinkPage = readonly [string, string];

export const LINK_KINDS: ReadonlyArray<{ kind: LinkKind; label: string }> = [
  { kind: "page", label: "Page" },
  { kind: "url", label: "Web address" },
  { kind: "phone", label: "Phone" },
  { kind: "email", label: "Email" },
];

/** Countries whose numbers are written (215) 772-1111 and called with +1. */
const NORTH_AMERICA = new Set(["US", "CA"]);
const northAmerican = (country?: string) => Boolean(country && NORTH_AMERICA.has(country.toUpperCase()));

const isSitePath = (href: string) => href.startsWith("/") && !href.startsWith("//");

/** What kind of link an href is, and its value in that kind's field. Nothing is lost: toHref gives the href back. */
export const parseHref = (href: string, pages: readonly LinkPage[] = []): LinkValue => {
  const text = String(href ?? "");
  if (/^tel:/i.test(text)) return { kind: "phone", value: text.slice(4) };
  if (/^mailto:/i.test(text)) return { kind: "email", value: text.slice(7) };
  if (text === "" || (isSitePath(text) && pages.some(([path]) => path === text))) return { kind: "page", value: text };
  // A site path that is not one of the pages (an anchor, a page the list does not know) stays as it is: Web address.
  return { kind: "url", value: text };
};

/** A phone number as a tel: link calls it: +1 and 10 digits for a North American number, "+" and digits otherwise. */
export const phoneHrefValue = (value: string, country?: string) => {
  const text = String(value ?? "").trim();
  const digits = text.replace(/\D/g, "");
  if (/^\+\d+$/.test(text)) return text;
  if (text.startsWith("+")) return `+${digits}`;
  if (northAmerican(country)) {
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  }
  return digits;
};

/** The href saved for a link value. */
export const toHref = ({ kind, value }: LinkValue, country?: string) => {
  const text = String(value ?? "");
  if (kind === "phone") return `tel:${phoneHrefValue(text, country)}`;
  if (kind === "email") return `mailto:${text.trim()}`;
  return kind === "url" ? text.trim() : text;
};

const EMAIL = /^[^\s@?&]+@[^\s@?&]+\.[a-z]{2,}$/i;

/** Plain words when a phone number cannot be used, or null. */
export const phoneProblem = (value: string, country?: string): string | null => {
  const text = String(value ?? "").trim();
  if (!text) return "Enter a phone number.";
  if (/[^\d\s()+.\-]/.test(text)) return "Use only numbers in the phone number.";
  const digits = text.replace(/\D/g, "");
  if (text.startsWith("+")) return digits.length < 8 || digits.length > 15 ? "Enter the whole number after the +, like +1 215 772 1111." : null;
  if (northAmerican(country)) return digits.length === 10 || (digits.length === 11 && digits.startsWith("1")) ? null : "Enter a phone number with its area code, like (215) 772-1111.";
  return digits.length < 6 || digits.length > 15 ? "Enter the whole phone number, like +44 20 7946 0958." : null;
};

/**
 * Plain words when a link value cannot be saved, or null. `required`: an empty Page / Web address is not allowed. A
 * Phone or Email link always needs its number / address (an empty one would open nothing).
 */
export const linkProblem = ({ kind, value }: LinkValue, { required = false, country }: { required?: boolean; country?: string } = {}): string | null => {
  const text = String(value ?? "").trim();
  if (!text) {
    if (kind === "page") return required ? "Choose a page." : null;
    if (kind === "url") return required ? "Enter a web address." : null;
    return kind === "phone" ? "Enter a phone number." : "Enter an email address.";
  }
  if (kind === "page") return null;
  if (kind === "url") {
    if (isSitePath(text) || text.startsWith("#")) return /\s/.test(text) ? "A page address cannot contain spaces." : null;
    try {
      const url = new URL(text);
      if (!/^https?:$/.test(url.protocol)) return "Use a web address that starts with https://.";
      if (!url.hostname.includes(".")) return "Enter a full web address, like https://example.com.";
      return null;
    } catch { return "Enter a full web address, like https://example.com or /about."; }
  }
  if (kind === "phone") return phoneProblem(text, country);
  const address = text.split("?")[0];
  return EMAIL.test(address) ? null : "Enter an email address, like name@example.com.";
};

/** A phone number as people read it: "(215) 772-1111" for a North American number; otherwise as written. */
export const formatPhone = (value: string, country?: string) => {
  const text = String(value ?? "").trim();
  if (phoneProblem(text, country)) return text;
  const href = phoneHrefValue(text, country);
  if (northAmerican(country) && /^\+1\d{10}$/.test(href)) return `(${href.slice(2, 5)}) ${href.slice(5, 8)}-${href.slice(8)}`;
  return text.replace(/\s+/g, " ");
};

const shorten = (text: string, max = 48) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The one line under a Link field: where the link really goes. `host` = the site's host ("mysalon.example"). */
export const linkOpensText = (href: string, host: string, country?: string) => {
  const text = String(href ?? "").trim();
  if (!text) return "Opens: nothing (no link)";
  if (/^tel:/i.test(text)) return `Opens: call ${formatPhone(text.slice(4), /^\+1\d{10}$/.test(text.slice(4)) ? "US" : country)}`;
  if (/^mailto:/i.test(text)) return `Opens: email ${shorten(text.slice(7).split("?")[0])}`;
  if (isSitePath(text)) return `Opens: ${host}${text === "/" ? "" : shorten(text)}`;
  if (text.startsWith("#")) return `Opens: a section of this page (${shorten(text)})`;
  try {
    const url = new URL(text);
    const where = url.hostname.replace(/^www\./, "");
    const rest = `${url.pathname === "/" ? "" : url.pathname}${url.search ? "?…" : ""}`;
    return `Opens: ${shorten(`${where}${rest}`)}`;
  } catch { return `Opens: ${shorten(text)}`; }
};

/** Why a saved href is not a link the CMS can show, or null (the build check and the server use it). */
export const hrefProblem = (href: string, country?: string) => linkProblem(parseHref(href), { country });
