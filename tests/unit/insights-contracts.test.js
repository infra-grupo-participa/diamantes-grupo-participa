/**
 * tests/unit/insights-contracts.test.js
 *
 * Unit tests for contract normalization, service catalog resolution,
 * employee mapping, profile normalization, and billing helpers.
 * All functions are pure — no DOM, no fetch, no localStorage.
 */

import { describe, it, expect } from "vitest";

// ── Inline pure implementations ───────────────────────────────────────────────

function normalizeEntityName(value) {
  return String(value || "").trim().toLocaleUpperCase("pt-BR");
}

function normalizeServiceName(value) {
  const normalized = normalizeEntityName(value);
  if (normalized === "DESENVOLVEDOR WEB") return "WEBDESIGNER";
  if (normalized === "COPY")              return "COPYWRITER";
  if (normalized === "EDIÇÃO")            return "EDIÇÃO DE VÍDEO";
  return normalized;
}

function normalizeClientContracts(clients) {
  if (!Array.isArray(clients)) return [];
  return clients
    .map((client) => {
      const slug       = String(client && client.slug || "").trim();
      const name       = normalizeEntityName(client && client.name || slug);
      const serviceMap = new Map();

      (Array.isArray(client && client.services) ? client.services : []).forEach((service) => {
        const serviceName  = normalizeServiceName(service && service.service);
        const employeeName = normalizeEntityName(service && service.employee);
        if (!slug || !serviceName || !employeeName) return;
        serviceMap.set(`${serviceName}::${employeeName}`, {
          service:   serviceName,
          employee:  employeeName,
          startedAt: String(service && service.startedAt || "").trim(),
          endedAt:   String(service && service.endedAt   || "").trim(),
        });
      });

      return {
        slug,
        name,
        services: Array.from(serviceMap.values()).sort((a, b) =>
          a.service.localeCompare(b.service, "pt-BR") ||
          a.employee.localeCompare(b.employee, "pt-BR")
        )
      };
    })
    .filter((client) => client.slug)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

function getBillingStatusMeta(status) {
  if (status === "late") {
    return { label: "Assinatura atrasada", className: "late", description: "Existe uma pendência financeira em acompanhamento pela equipe." };
  }
  if (status === "canceled") {
    return { label: "Contrato encerrado", className: "canceled", description: "O contrato foi encerrado e novos chamados ficam bloqueados." };
  }
  return { label: "Assinatura ativa", className: "current", description: "Cliente liberado para seguir usando o portal normalmente." };
}

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

function blankClientProfile(slug, name) {
  return {
    slug:              String(slug || "").trim(),
    name:              String(name || "").trim(),
    billingStatus:     "current",
    contractStartedAt: "",
    contractEndedAt:   "",
    seminar:           blankSeminarData(),
    updatedAt:         "",
  };
}

function normalizeClientProfile(slug, rawProfile, fallbackName) {
  const next = { ...blankClientProfile(slug, fallbackName), ...(rawProfile || {}) };
  const seminar = { ...blankSeminarData(), ...(next.seminar || {}) };

  next.slug             = String(slug || next.slug || "").trim();
  next.name             = String(next.name || fallbackName || next.slug || "").trim();
  next.billingStatus    = ["current","late","canceled"].includes(next.billingStatus) ? next.billingStatus : "current";
  next.contractStartedAt = String(next.contractStartedAt || "").trim();
  next.contractEndedAt  = String(next.contractEndedAt || "").trim();
  next.updatedAt        = String(next.updatedAt || "").trim();
  next.seminar = {
    ...seminar,
    acquisitionChannels: Array.from(new Set(
      (Array.isArray(seminar.acquisitionChannels) ? seminar.acquisitionChannels : [])
        .map((ch) => String(ch || "").trim().toLowerCase())
        .filter((ch) => ch === "google" || ch === "meta")
    )),
    contentDistributionEnabled: Boolean(seminar.contentDistributionEnabled),
    whatsappApiEnabled:         Boolean(seminar.whatsappApiEnabled),
  };
  return next;
}

// ── normalizeClientContracts ──────────────────────────────────────────────────

describe("normalizeClientContracts", () => {
  it("returns empty array for non-array input", () => {
    expect(normalizeClientContracts(null)).toEqual([]);
    expect(normalizeClientContracts("string")).toEqual([]);
    expect(normalizeClientContracts({})).toEqual([]);
  });

  it("filters out entries with empty slug", () => {
    const result = normalizeClientContracts([{ slug: "", name: "No Slug", services: [] }]);
    expect(result).toHaveLength(0);
  });

  it("normalizes service and employee names", () => {
    const result = normalizeClientContracts([{
      slug: "joao",
      name: "joao",
      services: [{ service: "desenvolvedor web", employee: "  ana silva  " }]
    }]);
    expect(result[0].services[0].service).toBe("WEBDESIGNER");
    expect(result[0].services[0].employee).toBe("ANA SILVA");
  });

  it("deduplicates service+employee combinations", () => {
    const result = normalizeClientContracts([{
      slug: "joao",
      name: "joao",
      services: [
        { service: "designer", employee: "pedro" },
        { service: "designer", employee: "pedro" },
        { service: "designer", employee: "maria" },
      ]
    }]);
    expect(result[0].services).toHaveLength(2);
  });

  it("sorts clients by name", () => {
    const result = normalizeClientContracts([
      { slug: "zzz", name: "Zara", services: [] },
      { slug: "aaa", name: "Ana", services: [] },
    ]);
    expect(result[0].name).toBe("ANA");
    expect(result[1].name).toBe("ZARA");
  });

  it("sorts services alphabetically within a client", () => {
    const result = normalizeClientContracts([{
      slug: "test",
      name: "Test",
      services: [
        { service: "social media", employee: "ana" },
        { service: "designer", employee: "ana" },
      ]
    }]);
    expect(result[0].services[0].service).toBe("DESIGNER");
    expect(result[0].services[1].service).toBe("SOCIAL MEDIA");
  });
});

// ── getBillingStatusMeta ──────────────────────────────────────────────────────

describe("getBillingStatusMeta", () => {
  it("returns correct meta for current", () => {
    const meta = getBillingStatusMeta("current");
    expect(meta.className).toBe("current");
    expect(meta.label).toBe("Assinatura ativa");
  });

  it("returns correct meta for late", () => {
    const meta = getBillingStatusMeta("late");
    expect(meta.className).toBe("late");
    expect(meta.label).toBe("Assinatura atrasada");
  });

  it("returns correct meta for canceled", () => {
    const meta = getBillingStatusMeta("canceled");
    expect(meta.className).toBe("canceled");
    expect(meta.label).toBe("Contrato encerrado");
  });

  it("defaults to current for unknown status", () => {
    const meta = getBillingStatusMeta("unknown");
    expect(meta.className).toBe("current");
  });

  it("defaults to current for null", () => {
    const meta = getBillingStatusMeta(null);
    expect(meta.className).toBe("current");
  });
});

// ── normalizeClientProfile ────────────────────────────────────────────────────

describe("normalizeClientProfile", () => {
  it("creates blank profile when rawProfile is null", () => {
    const profile = normalizeClientProfile("joao", null, "João");
    expect(profile.slug).toBe("joao");
    expect(profile.billingStatus).toBe("current");
    expect(Array.isArray(profile.seminar.acquisitionChannels)).toBe(true);
  });

  it("normalizes billingStatus to current for unknown values", () => {
    const profile = normalizeClientProfile("joao", { billingStatus: "invalid" }, "João");
    expect(profile.billingStatus).toBe("current");
  });

  it("preserves valid billingStatus late", () => {
    const profile = normalizeClientProfile("joao", { billingStatus: "late" }, "João");
    expect(profile.billingStatus).toBe("late");
  });

  it("filters acquisitionChannels to only google/meta", () => {
    const profile = normalizeClientProfile("joao", {
      seminar: { acquisitionChannels: ["google", "tiktok", "meta", "invalid"] }
    }, "João");
    expect(profile.seminar.acquisitionChannels).toEqual(["google", "meta"]);
  });

  it("deduplicates acquisitionChannels", () => {
    const profile = normalizeClientProfile("joao", {
      seminar: { acquisitionChannels: ["google", "google", "meta"] }
    }, "João");
    expect(profile.seminar.acquisitionChannels).toHaveLength(2);
  });

  it("coerces whatsappApiEnabled to boolean", () => {
    const profile = normalizeClientProfile("joao", {
      seminar: { whatsappApiEnabled: "yes" }
    }, "João");
    expect(profile.seminar.whatsappApiEnabled).toBe(true);
  });

  it("uses fallbackName when name is empty", () => {
    const profile = normalizeClientProfile("joao", {}, "João Silva");
    expect(profile.name).toBe("João Silva");
  });
});

// ── blankSeminarData ──────────────────────────────────────────────────────────

describe("blankSeminarData", () => {
  it("returns all required keys", () => {
    const seminar = blankSeminarData();
    expect(seminar).toHaveProperty("instagram");
    expect(seminar).toHaveProperty("acquisitionChannels");
    expect(seminar.acquisitionChannels).toEqual([]);
    expect(seminar.contentDistributionEnabled).toBe(false);
    expect(seminar.whatsappApiEnabled).toBe(false);
  });
});
