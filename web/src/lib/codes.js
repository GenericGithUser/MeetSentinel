// Join codes and Google Meet codes.

// 32 symbols, no I, O, 0 or 1. The Firestore rules enforce exactly this alphabet and length.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 10;

export function generateJoinCode(length = JOIN_CODE_LENGTH) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  // 256 is a multiple of 32, so masking with 31 introduces no modulo bias
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join("");
}

// ABCDE-FGHJK for display; students may type it with or without the dash.
export const formatJoinCode = (c) => `${c.slice(0, 5)}-${c.slice(5)}`;

const codeFrom = (s) => {
  const m = /^([a-z]{3})-?([a-z]{4})-?([a-z]{3})$/i.exec(String(s).trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}`.toLowerCase() : null;
};

// Accepts "abc-defg-hij", "abcdefghij", or a pasted Meet link in any shape:
//   meet.google.com/abc-defg-hij, https://meet.google.com/meet/abc-defg-hij?f&pli=1&authuser=0, ...
// For links, the code is the first path segment that looks like one (its position has changed before).
// Returns the canonical "abc-defg-hij", or null if it isn't a Meet code.
export function normalizeMeetCode(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  const isLink = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^meet\.google\.com\//i.test(raw);
  if (!isLink) return codeFrom(raw);

  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (u.hostname.toLowerCase() !== "meet.google.com") return null;
    for (const segment of u.pathname.split("/")) {
      const c = codeFrom(segment);
      if (c) return c;
    }
  } catch { /* not a URL */ }
  return null;
}

export function parseMeetCodes(text) {
  const codes = [];
  const invalid = [];
  for (const token of String(text ?? "").split(/[\s,;]+/).filter(Boolean)) {
    const c = normalizeMeetCode(token);
    if (!c) invalid.push(token);
    else if (!codes.includes(c)) codes.push(c);
  }
  return { codes, invalid };
}

// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.