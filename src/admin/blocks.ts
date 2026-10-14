/**
 * M13: the Mr Spa CMS's shared blocks that need words or rules of their own — the price box (f.price) and the
 * "comes from" card of a field that copies another (sameAs). The menu cards (f.menu) are drawn in src/admin/form.ts.
 */

const PLAIN_AMOUNT = /^(\d{1,9})(?:\.(\d{1,2}))?$/;

/** Mr Spa: a plain amount is written "$1,299" / "$1,299.50"; anything else ("From $980", "$5+") is kept as typed. */
export const priceValue = (typed: string) => {
  const text = typed.trim();
  const plain = PLAIN_AMOUNT.exec(text.replace(/^\$/, "").replace(/,/g, "").trim());
  if (!plain) return text;
  const whole = Number(plain[1]).toLocaleString("en-US");
  return `$${whole}${plain[2] !== undefined ? `.${plain[2].padEnd(2, "0")}` : ""}`;
};

/** What the box shows for a saved price: a plain amount without its "$" (the box has one in front); others as saved. */
export const priceShown = (saved: string) => {
  const amount = saved.trim().replace(/^\$/, "");
  return PLAIN_AMOUNT.test(amount.replace(/,/g, "")) ? amount : saved;
};

/** Mr Spa: "Shoppers will see $1,299." */
export const priceNote = (saved: string) => (saved.trim() ? `Shoppers will see ${saved.trim()}.` : "");

/** Mr Spa: "Phone comes from Header › Store phone number". */
export const sameAsNote = (label: string, source: string, section?: string) => `${label} comes from ${section ? `${section} › ` : ""}${source}`;
