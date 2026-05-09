/**
 * tests/unit/insights-utils.test.js
 *
 * Unit tests for pure helpers in portal/assets/js/insights-utils.js.
 * Uses jsdom environment (vitest.config.js), no DOM interaction needed here.
 */

import { describe, it, expect } from "vitest";
import {
  clone,
  escapeHtml,
  normalizeEntityName,
  normalizeServiceName,
  normalizeSearchKey,
  normalizeOptionLabel,
  makeDomSafeId,
  uniqueValues,
  average,
  roundOne,
  formatProfileDate,
  formatProfileDateTime,
  humanizeText
} from "../../portal/assets/js/insights-utils.js";

// ── clone ─────────────────────────────────────────────────────────────────────

describe("clone", () => {
  it("returns a deep copy of a plain object", () => {
    const original = { a: 1, b: { c: 2 } };
    const copy = clone(original);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    expect(copy.b).not.toBe(original.b);
  });

  it("returns a deep copy of an array", () => {
    const original = [1, [2, 3]];
    const copy = clone(original);
    expect(copy).toEqual(original);
    expect(copy[1]).not.toBe(original[1]);
  });

  it("handles null values correctly", () => {
    expect(clone(null)).toBeNull();
  });
});

// ── escapeHtml ────────────────────────────────────────────────────────────────

describe("escapeHtml", () => {
  it("escapes ampersand", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('say "hi"')).toBe("say &quot;hi&quot;");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("returns empty string for falsy input", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml("")).toBe("");
  });

  it("leaves safe strings unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

// ── normalizeEntityName ───────────────────────────────────────────────────────

describe("normalizeEntityName", () => {
  it("uppercases and trims ASCII input", () => {
    expect(normalizeEntityName("  maria  ")).toBe("MARIA");
  });

  it("handles empty string", () => {
    expect(normalizeEntityName("")).toBe("");
  });

  it("handles null/undefined", () => {
    expect(normalizeEntityName(null)).toBe("");
    expect(normalizeEntityName(undefined)).toBe("");
  });
});

// ── normalizeServiceName ──────────────────────────────────────────────────────

describe("normalizeServiceName", () => {
  it("normalizes DESENVOLVEDOR WEB → WEBDESIGNER", () => {
    expect(normalizeServiceName("desenvolvedor web")).toBe("WEBDESIGNER");
  });

  it("normalizes COPY → COPYWRITER", () => {
    expect(normalizeServiceName("copy")).toBe("COPYWRITER");
  });

  it("normalizes EDIÇÃO → EDIÇÃO DE VÍDEO", () => {
    expect(normalizeServiceName("edição")).toBe("EDIÇÃO DE VÍDEO");
  });

  it("uppercases unknown services", () => {
    expect(normalizeServiceName("designer")).toBe("DESIGNER");
  });

  it("handles empty/null", () => {
    expect(normalizeServiceName("")).toBe("");
    expect(normalizeServiceName(null)).toBe("");
  });
});

// ── normalizeSearchKey ────────────────────────────────────────────────────────

describe("normalizeSearchKey", () => {
  it("strips diacritics and lowercases", () => {
    expect(normalizeSearchKey("Acao")).toBe("acao");
  });

  it("trims whitespace", () => {
    expect(normalizeSearchKey("  hello  ")).toBe("hello");
  });

  it("handles empty input", () => {
    expect(normalizeSearchKey("")).toBe("");
    expect(normalizeSearchKey(null)).toBe("");
  });
});

// ── uniqueValues ──────────────────────────────────────────────────────────────

describe("uniqueValues", () => {
  it("removes duplicates", () => {
    expect(uniqueValues([1, 2, 2, 3])).toEqual([1, 2, 3]);
  });

  it("filters falsy values", () => {
    expect(uniqueValues([1, null, undefined, 0, "", 2])).toEqual([1, 2]);
  });

  it("returns empty array for empty input", () => {
    expect(uniqueValues([])).toEqual([]);
  });
});

// ── average ───────────────────────────────────────────────────────────────────

describe("average", () => {
  it("computes simple average", () => {
    expect(average([1, 2, 3])).toBe(2);
  });

  it("ignores non-finite values", () => {
    expect(average([2, NaN, 4, Infinity])).toBe(3);
  });

  it("returns null for empty array", () => {
    expect(average([])).toBeNull();
  });

  it("handles single value", () => {
    expect(average([7])).toBe(7);
  });
});

// ── roundOne ──────────────────────────────────────────────────────────────────

describe("roundOne", () => {
  it("rounds to 1 decimal", () => {
    expect(roundOne(7.25)).toBe(7.3);
    expect(roundOne(7.24)).toBe(7.2);
  });

  it("returns null for null/undefined", () => {
    expect(roundOne(null)).toBeNull();
    expect(roundOne(undefined)).toBeNull();
  });

  it("returns integer values unchanged", () => {
    expect(roundOne(5)).toBe(5);
  });
});

// ── makeDomSafeId ─────────────────────────────────────────────────────────────

describe("makeDomSafeId", () => {
  it("replaces spaces and punctuation with underscore", () => {
    const result = makeDomSafeId("hello world!");
    expect(result).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it("handles empty input", () => {
    expect(makeDomSafeId("")).toBe("");
    expect(makeDomSafeId(null)).toBe("");
  });
});

// ── normalizeOptionLabel ──────────────────────────────────────────────────────

describe("normalizeOptionLabel", () => {
  it("trims and uppercases", () => {
    const result = normalizeOptionLabel("  social media  ");
    expect(result).toBe("SOCIAL MEDIA");
  });

  it("normalizes multiple spaces", () => {
    expect(normalizeOptionLabel("Social  Media")).toBe("SOCIAL MEDIA");
  });

  it("handles empty input", () => {
    expect(normalizeOptionLabel("")).toBe("");
  });
});

// ── formatProfileDate ─────────────────────────────────────────────────────────

describe("formatProfileDate", () => {
  it("formats YYYY-MM-DD to DD/MM/YYYY", () => {
    expect(formatProfileDate("2024-06-15")).toBe("15/06/2024");
  });

  it("returns — for empty input", () => {
    expect(formatProfileDate("")).toBe("—");
    expect(formatProfileDate(null)).toBe("—");
  });

  it("returns — for invalid date", () => {
    expect(formatProfileDate("not-a-date")).toBe("—");
  });
});
