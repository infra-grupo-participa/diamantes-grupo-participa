/**
 * tests/unit/insights-mentions.test.js
 *
 * Unit tests for getMentionCandidates logic (pure filtering/sorting part).
 */

import { describe, it, expect } from "vitest";

// ── Inline helpers (pure, no DOM) ─────────────────────────────────────────────

function normalizeEntityName(value) {
  return String(value || "").trim().toLocaleUpperCase("pt-BR");
}

function humanizeText(value) {
  return String(value || "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\b\p{L}/gu, (char) => char.toLocaleUpperCase("pt-BR"));
}

function formatEmployeeName(value) { return humanizeText(value); }

function normalizeSearchKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

/**
 * Pure version of getMentionCandidates — takes a pool directly instead of
 * reading from contracts.
 */
function buildMentionCandidates(pool) {
  return uniqueValues(pool)
    .map((employee) => ({
      value:  employee,
      label:  formatEmployeeName(employee),
      search: normalizeSearchKey(employee)
    }))
    .sort((l, r) => l.label.localeCompare(r.label, "pt-BR"));
}

/**
 * Pure search filter (mirrors renderMentionSuggestions logic).
 */
function filterMentionCandidates(candidates, query) {
  const normalizedQuery = normalizeSearchKey(query);
  return candidates
    .filter((c) => !normalizedQuery || c.search.includes(normalizedQuery))
    .slice(0, 6);
}

// ── buildMentionCandidates ────────────────────────────────────────────────────

describe("buildMentionCandidates", () => {
  it("deduplicates employees", () => {
    const candidates = buildMentionCandidates(["ANA SILVA", "ANA SILVA", "PEDRO"]);
    expect(candidates).toHaveLength(2);
  });

  it("humanizes employee names", () => {
    const candidates = buildMentionCandidates(["ANA SILVA"]);
    expect(candidates[0].label).toBe("Ana Silva");
  });

  it("builds searchable keys without diacritics", () => {
    const candidates = buildMentionCandidates(["VINÍCIUS PEREIRA"]);
    expect(candidates[0].search).toBe("vinicius pereira");
  });

  it("sorts alphabetically by label", () => {
    const candidates = buildMentionCandidates(["PEDRO", "ANA", "CARLOS"]);
    expect(candidates[0].label).toBe("Ana");
    expect(candidates[1].label).toBe("Carlos");
    expect(candidates[2].label).toBe("Pedro");
  });

  it("filters falsy values", () => {
    const candidates = buildMentionCandidates(["ANA", null, undefined, "", "PEDRO"]);
    expect(candidates).toHaveLength(2);
  });

  it("returns empty array for empty pool", () => {
    expect(buildMentionCandidates([])).toEqual([]);
  });
});

// ── filterMentionCandidates ───────────────────────────────────────────────────

describe("filterMentionCandidates", () => {
  const candidates = buildMentionCandidates([
    "ANA SILVA", "PEDRO LIMA", "JOÃO CARVALHO",
    "VINÍCIUS PEREIRA", "MARCOS PAULO", "GABRIEL MENEZES", "ELAINE MONTENEGRO"
  ]);

  it("returns all (up to 6) when query is empty", () => {
    const results = filterMentionCandidates(candidates, "");
    expect(results).toHaveLength(6);
  });

  it("filters by name fragment", () => {
    const results = filterMentionCandidates(candidates, "ana");
    expect(results.every((c) => c.search.includes("ana"))).toBe(true);
  });

  it("strips diacritics from query when searching", () => {
    const results = filterMentionCandidates(candidates, "vinicius");
    expect(results.some((c) => c.search.includes("vinicius"))).toBe(true);
  });

  it("returns empty array for no match", () => {
    const results = filterMentionCandidates(candidates, "zzznobody");
    expect(results).toHaveLength(0);
  });
});
