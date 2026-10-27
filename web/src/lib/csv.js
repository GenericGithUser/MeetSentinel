import { normalizeEmail, isValidEmail } from "./email.js";

// Minimal RFC 4180 parser: quoted fields, doubled quotes, commas/newlines inside quotes, CRLF, BOM.
export function parseCsv(text) {
  const src = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (h) => String(h).toLowerCase().replace(/[^a-z]/g, "");

// Finds columns by header name, tolerating common variants.
function mapHeaders(header) {
  const idx = { name: -1, first: -1, last: -1, uni: -1, personal: -1 };
  header.forEach((h, i) => {
    const k = norm(h);
    if (idx.personal < 0 && /personal|alt|other|private|home/.test(k) && /mail/.test(k)) idx.personal = i;
    else if (idx.uni < 0 && (/(university|school|institution|campus|official|student|work)/.test(k) && /mail/.test(k))) idx.uni = i;
    else if (idx.name < 0 && /^(fullname|name|studentname|student)$/.test(k)) idx.name = i;
    else if (idx.first < 0 && /^(firstname|first|givenname)$/.test(k)) idx.first = i;
    else if (idx.last < 0 && /^(lastname|last|surname|familyname)$/.test(k)) idx.last = i;
    else if (idx.uni < 0 && /^e?mail$/.test(k)) idx.uni = i; // a bare "email" column is treated as the primary email
  });
  return idx;
}

// Turns CSV text into roster rows: { name, universityEmail, personalEmail } (emails normalized, "" when missing).
export function parseRoster(text) {
  const table = parseCsv(text);
  const errors = [];
  if (table.length < 2) return { rows: [], errors: [{ line: 1, message: "The file needs a header row and at least one student." }] };

  const cols = mapHeaders(table[0]);
  const hasName = cols.name >= 0 || (cols.first >= 0 && cols.last >= 0);
  if (!hasName) errors.push({ line: 1, message: 'No name column found. Use a header like "name" (or "first name" and "last name").' });
  if (cols.uni < 0 && cols.personal < 0) errors.push({ line: 1, message: 'No email column found. Use headers like "university email" and "personal email".' });
  if (errors.length) return { rows: [], errors };

  const rows = [];
  const seen = new Map();
  for (let r = 1; r < table.length; r++) {
    const line = r + 1;
    const cell = (i) => (i >= 0 ? String(table[r][i] ?? "").trim() : "");
    const name = cols.name >= 0 ? cell(cols.name) : `${cell(cols.first)} ${cell(cols.last)}`.trim();
    const uniRaw = cell(cols.uni), perRaw = cell(cols.personal);

    if (!name) { errors.push({ line, message: "Missing name." }); continue; }
    if (!uniRaw && !perRaw) { errors.push({ line, message: `${name}: needs at least one email.` }); continue; }
    if ((uniRaw && !isValidEmail(uniRaw)) || (perRaw && !isValidEmail(perRaw))) { errors.push({ line, message: `${name}: invalid email address.` }); continue; }

    const universityEmail = uniRaw ? normalizeEmail(uniRaw) : "";
    const personalEmail = perRaw ? normalizeEmail(perRaw) : "";
    let clash = null;
    for (const e of [universityEmail, personalEmail].filter(Boolean)) {
      if (seen.has(e)) clash = seen.get(e);
    }
    if (clash) { errors.push({ line, message: `${name}: shares an email with line ${clash}. Each email may appear once.` }); continue; }
    for (const e of [universityEmail, personalEmail].filter(Boolean)) seen.set(e, line);

    rows.push({ name, universityEmail, personalEmail });
  }
  return { rows, errors };
}

// Stable roster document id from the primary email, so re-uploading a roster keeps existing student links valid.
export const rosterIdFor = (row) => (row.universityEmail || row.personalEmail).replace(/\//g, "_");

export const ROSTER_TEMPLATE = "name,university email,personal email\nMaria Santos,maria.santos@university.edu,maria@gmail.com\n";


// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.