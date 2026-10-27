// Normalizes emails for roster matching: lowercase, trim, drop "+tag", and ignore dots for Gmail.
export function normalizeEmail(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  const at = s.lastIndexOf("@");
  if (at < 1) return s;
  let local = s.slice(0, at);
  let domain = s.slice(at + 1);
  local = local.split("+")[0];
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export const isValidEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s ?? "").trim());
