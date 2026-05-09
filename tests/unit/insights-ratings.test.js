/**
 * tests/unit/insights-ratings.test.js
 *
 * Unit tests for rating helpers: getRatingMeta, getTaskRevisionKey.
 */

import { describe, it, expect } from "vitest";

const SCORE_META = [
  { min: 1,  max: 2,  label: "Péssimo",   tone: "terrible" },
  { min: 3,  max: 4,  label: "Ruim",      tone: "bad"      },
  { min: 5,  max: 6,  label: "Razoável",  tone: "fair"     },
  { min: 7,  max: 8,  label: "Bom",       tone: "good"     },
  { min: 9,  max: 10, label: "Excelente", tone: "great"    }
];

function getRatingMeta(score) {
  const numeric = Number(score || 0);
  return SCORE_META.find((item) => numeric >= item.min && numeric <= item.max) || null;
}

function getTaskRevisionKey(taskOrRevisionKey) {
  if (taskOrRevisionKey && typeof taskOrRevisionKey === "object") {
    return String(
      taskOrRevisionKey.revisionKey ||
      taskOrRevisionKey.resolvedAt  ||
      taskOrRevisionKey.createdAt   ||
      ""
    ).trim();
  }
  return String(taskOrRevisionKey || "").trim();
}

// ── getRatingMeta ─────────────────────────────────────────────────────────────

describe("getRatingMeta", () => {
  it("returns Péssimo for scores 1-2", () => {
    expect(getRatingMeta(1).label).toBe("Péssimo");
    expect(getRatingMeta(2).label).toBe("Péssimo");
  });

  it("returns Ruim for scores 3-4", () => {
    expect(getRatingMeta(3).label).toBe("Ruim");
    expect(getRatingMeta(4).label).toBe("Ruim");
  });

  it("returns Razoável for scores 5-6", () => {
    expect(getRatingMeta(5).label).toBe("Razoável");
    expect(getRatingMeta(6).label).toBe("Razoável");
  });

  it("returns Bom for scores 7-8", () => {
    expect(getRatingMeta(7).label).toBe("Bom");
    expect(getRatingMeta(8).label).toBe("Bom");
  });

  it("returns Excelente for scores 9-10", () => {
    expect(getRatingMeta(9).label).toBe("Excelente");
    expect(getRatingMeta(10).label).toBe("Excelente");
  });

  it("returns null for score 0", () => {
    expect(getRatingMeta(0)).toBeNull();
  });

  it("returns null for score 11", () => {
    expect(getRatingMeta(11)).toBeNull();
  });

  it("returns null for null input", () => {
    expect(getRatingMeta(null)).toBeNull();
  });

  it("handles string scores", () => {
    expect(getRatingMeta("7").label).toBe("Bom");
  });
});

// ── getTaskRevisionKey ────────────────────────────────────────────────────────

describe("getTaskRevisionKey", () => {
  it("returns revisionKey from object", () => {
    expect(getTaskRevisionKey({ revisionKey: "abc123" })).toBe("abc123");
  });

  it("falls back to resolvedAt", () => {
    expect(getTaskRevisionKey({ resolvedAt: "2024-01-01" })).toBe("2024-01-01");
  });

  it("falls back to createdAt", () => {
    expect(getTaskRevisionKey({ createdAt: "2024-02-01" })).toBe("2024-02-01");
  });

  it("prefers revisionKey over resolvedAt", () => {
    expect(getTaskRevisionKey({ revisionKey: "rev1", resolvedAt: "res1" })).toBe("rev1");
  });

  it("returns empty string for object with no keys", () => {
    expect(getTaskRevisionKey({})).toBe("");
  });

  it("returns string value directly when passed a string", () => {
    expect(getTaskRevisionKey("my-key")).toBe("my-key");
  });

  it("returns empty string for null", () => {
    expect(getTaskRevisionKey(null)).toBe("");
  });

  it("trims whitespace", () => {
    expect(getTaskRevisionKey("  abc  ")).toBe("abc");
    expect(getTaskRevisionKey({ revisionKey: "  key  " })).toBe("key");
  });
});
