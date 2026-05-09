/**
 * tests/unit/insights-profiles.test.js
 *
 * Unit tests for profile helper functions.
 */

import { describe, it, expect } from "vitest";

// ── Inline pure helpers ───────────────────────────────────────────────────────

function blankSeminarData() {
  return {
    instagram: "", facebook: "", youtube: "", siteUrl: "",
    capturePageUrl: "", thankYouPageUrl: "", driveUrl: "",
    seminarDay1Date: "", pitchDate: "", cartCloseDate: "",
    testsStartDate: "", scaleStartDate: "",
    acquisitionChannels: [], acquisitionInvestment: "",
    acquisitionGoogleShare: "", acquisitionMetaShare: "",
    contentDistributionEnabled: false, contentDistributionAmount: "",
    contentDistributionGoogleShare: "", contentDistributionMetaShare: "",
    targetRegion: "", lastSeminarDate: "", lastSeminarLeads: "",
    targetLeads: "", emailMarketingTool: "", pageBuilder: "",
    whatsappApiEnabled: false, whatsappApiTool: "",
  };
}

function formatProfileDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric"
  }).format(date);
}

function formatProfileDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function hasMonthlyProfileResponse(profile) {
  const seminar = profile && profile.seminar ? profile.seminar : blankSeminarData();
  return Object.values(seminar).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "boolean") return value === true;
    return String(value ?? "").trim() !== "";
  });
}

function getMonthlyProfileMeta(profile) {
  const answered  = hasMonthlyProfileResponse(profile);
  const updatedAt = answered && profile && profile.updatedAt ? new Date(profile.updatedAt) : null;
  const due = !updatedAt || Number.isNaN(updatedAt.getTime())
    ? true
    : (Date.now() - updatedAt.getTime()) > (1000 * 60 * 60 * 24 * 30);

  return {
    answered,
    due,
    label:       due ? "Não respondido" : "Respondido",
    className:   due ? "pending" : "current",
  };
}

function getProfilePreviewItems(profile) {
  const seminar = profile && profile.seminar ? profile.seminar : blankSeminarData();
  return [
    ["Instagram",    seminar.instagram],
    ["Site",         seminar.siteUrl],
    ["Drive",        seminar.driveUrl],
    ["Região",       seminar.targetRegion],
    ["Meta de leads", seminar.targetLeads],
    ["API do WhatsApp", seminar.whatsappApiEnabled ? (seminar.whatsappApiTool || "Sim") : "Não"],
  ].filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    return String(value || "").trim() && value !== "—";
  });
}

// ── hasMonthlyProfileResponse ─────────────────────────────────────────────────

describe("hasMonthlyProfileResponse", () => {
  it("returns false for blank seminar", () => {
    expect(hasMonthlyProfileResponse({ seminar: blankSeminarData() })).toBe(false);
  });

  it("returns true when any text field is filled", () => {
    expect(hasMonthlyProfileResponse({ seminar: { ...blankSeminarData(), instagram: "@joao" } })).toBe(true);
  });

  it("returns true when boolean field is true", () => {
    expect(hasMonthlyProfileResponse({ seminar: { ...blankSeminarData(), whatsappApiEnabled: true } })).toBe(true);
  });

  it("returns true when array field has items", () => {
    expect(hasMonthlyProfileResponse({ seminar: { ...blankSeminarData(), acquisitionChannels: ["google"] } })).toBe(true);
  });

  it("returns false when profile is null", () => {
    expect(hasMonthlyProfileResponse(null)).toBe(false);
  });
});

// ── getMonthlyProfileMeta ─────────────────────────────────────────────────────

describe("getMonthlyProfileMeta", () => {
  it("returns pending/due=true when profile has no responses", () => {
    const meta = getMonthlyProfileMeta({ seminar: blankSeminarData(), updatedAt: "" });
    expect(meta.due).toBe(true);
    expect(meta.className).toBe("pending");
    expect(meta.answered).toBe(false);
  });

  it("returns due=false when profile was updated less than 30 days ago", () => {
    const recentDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString();
    const meta = getMonthlyProfileMeta({
      seminar:   { ...blankSeminarData(), instagram: "@joao" },
      updatedAt: recentDate
    });
    expect(meta.due).toBe(false);
    expect(meta.className).toBe("current");
  });

  it("returns due=true when profile was updated more than 30 days ago", () => {
    const oldDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 35).toISOString();
    const meta = getMonthlyProfileMeta({
      seminar:   { ...blankSeminarData(), instagram: "@joao" },
      updatedAt: oldDate
    });
    expect(meta.due).toBe(true);
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

// ── getProfilePreviewItems ────────────────────────────────────────────────────

describe("getProfilePreviewItems", () => {
  it("filters out blank values", () => {
    const items = getProfilePreviewItems({ seminar: blankSeminarData() });
    // Only "API do WhatsApp: Não" would show up if whatsappApiEnabled is false → filtered because "Não" stays
    // Actually all blank — check that we don't get items for empty strings
    const nonWhatsapp = items.filter(([label]) => label !== "API do WhatsApp");
    expect(nonWhatsapp).toHaveLength(0);
  });

  it("includes filled fields", () => {
    const items = getProfilePreviewItems({
      seminar: { ...blankSeminarData(), instagram: "@joao", targetRegion: "São Paulo" }
    });
    const labels = items.map(([label]) => label);
    expect(labels).toContain("Instagram");
    expect(labels).toContain("Região");
  });

  it("returns Sim for whatsappApiEnabled without tool", () => {
    const items = getProfilePreviewItems({
      seminar: { ...blankSeminarData(), whatsappApiEnabled: true }
    });
    const whatsapp = items.find(([label]) => label === "API do WhatsApp");
    expect(whatsapp).toBeTruthy();
    expect(whatsapp[1]).toBe("Sim");
  });

  it("returns tool name for whatsappApiEnabled with tool", () => {
    const items = getProfilePreviewItems({
      seminar: { ...blankSeminarData(), whatsappApiEnabled: true, whatsappApiTool: "Z-API" }
    });
    const whatsapp = items.find(([label]) => label === "API do WhatsApp");
    expect(whatsapp[1]).toBe("Z-API");
  });
});
