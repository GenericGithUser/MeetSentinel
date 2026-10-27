import { normalizeEmail } from "./email.js";

const tokens = (s) =>
  String(s ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z\s]/g, " ")
    .split(/\s+/).filter(Boolean);

// Jaccard similarity of name tokens, so "Santos, Maria" == "Maria Santos" and "Maria L. Santos" is close.
export function nameSimilarity(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
export const NAME_MISMATCH_BELOW = 0.5;

// roster: [{ id, name, universityEmail, personalEmail }]
// members: [{ uid, name, email, status, rosterId? }]
// Returns one entry per PENDING member, sorted so problems come first:
//   conflict > name_mismatch > ambiguous > unmatched > clean
export function buildApprovalQueue(members, roster) {
  const byEmail = new Map();
  for (const row of roster) {
    for (const e of [row.universityEmail, row.personalEmail].filter(Boolean)) {
      const k = normalizeEmail(e);
      if (!byEmail.has(k)) byEmail.set(k, []);
      byEmail.get(k).push(row);
    }
  }
  const rosterById = new Map(roster.map((r) => [r.id, r]));
  const approvedBy = new Map(); // rosterId -> approved members already linked to it
  for (const m of members) {
    if (m.status === "approved" && m.rosterId) {
      if (!approvedBy.has(m.rosterId)) approvedBy.set(m.rosterId, []);
      approvedBy.get(m.rosterId).push(m);
    }
  }

  const pending = members.filter((m) => m.status === "pending");
  const candidateOf = (m) => byEmail.get(normalizeEmail(m.email)) ?? [];
  const claimants = new Map(); // rosterId -> pending members whose email points at it
  for (const m of pending) {
    const c = candidateOf(m);
    if (c.length === 1) {
      if (!claimants.has(c[0].id)) claimants.set(c[0].id, []);
      claimants.get(c[0].id).push(m);
    }
  }

  const entries = pending.map((m) => {
    const candidates = candidateOf(m);
    const row = candidates.length === 1 ? candidates[0] : null;
    const flags = [];
    const info = {};

    if (candidates.length === 0) flags.push("unmatched");
    else if (candidates.length > 1) flags.push("ambiguous");

    if (row) {
      const score = nameSimilarity(m.name, row.name);
      info.nameScore = score;
      if (score < NAME_MISMATCH_BELOW) flags.push("name_mismatch");

      const already = (approvedBy.get(row.id) ?? []).filter((x) => x.uid !== m.uid);
      const rivals = (claimants.get(row.id) ?? []).filter((x) => x.uid !== m.uid);
      if (already.length) { flags.push("conflict"); info.alreadyLinked = already.map((x) => x.name); }
      else if (rivals.length) { flags.push("conflict"); info.rivals = rivals.map((x) => x.name); }
    }

    const order = ["conflict", "name_mismatch", "ambiguous", "unmatched"];
    const worst = order.find((f) => flags.includes(f));
    return { member: m, row, candidates, flags, info, category: worst ?? "clean" };
  });

  const rank = { conflict: 0, name_mismatch: 1, ambiguous: 2, unmatched: 3, clean: 4 };
  entries.sort((a, b) => rank[a.category] - rank[b.category] || String(a.member.name).localeCompare(String(b.member.name)));
  return { entries, rosterById };
}


// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.