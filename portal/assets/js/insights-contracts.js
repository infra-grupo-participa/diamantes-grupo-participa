/**
 * insights-contracts.js — Contract CRUD, catalog resolution, employee mapping.
 */

import {
  CONTRACT_REGISTRY_KEY,
  CONTRACT_STATUS_KEY,
  CLIENT_PROFILES_KEY,
  state
} from "./insights-state.js";
import {
  clone,
  readJson,
  writeJson,
  normalizeEntityName,
  normalizeServiceName,
  humanizeText,
  uniqueValues
} from "./insights-utils.js";
import { SERVICE_LABELS, CLIENT_PROFILE_SCHEMA } from "./insights-state.js";

// ── Name formatters ─────────────────────────────────────────────────────────

export function formatClientName(value)   { return humanizeText(value); }
export function formatEmployeeName(value) { return humanizeText(value); }
export function formatServiceName(value) {
  return SERVICE_LABELS[value] || humanizeText(value);
}

// ── Client profile blank / normalize ────────────────────────────────────────

export function blankSeminarData() {
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

export function blankClientProfile(slug, name) {
  return {
    slug:             String(slug || "").trim(),
    name:             String(name || "").trim(),
    billingStatus:    "current",
    contractStartedAt: "",
    contractEndedAt:  "",
    seminar:          blankSeminarData(),
    updatedAt:        "",
  };
}

export function normalizeClientProfile(slug, rawProfile, fallbackName) {
  const next = {
    ...blankClientProfile(slug, fallbackName),
    ...(rawProfile || {}),
  };
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

// ── Contract registry ────────────────────────────────────────────────────────

export function normalizeClientContracts(clients) {
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

export function saveContractsSource(clients) {
  const normalized = normalizeClientContracts(clients);
  writeJson(CONTRACT_REGISTRY_KEY, normalized);
  return normalized;
}

export function getBaseContractsSource() {
  return normalizeClientContracts(
    Array.isArray(window.PortalContracts && window.PortalContracts.clients)
      ? window.PortalContracts.clients
      : []
  );
}

export function getContractsSource() {
  const stored = readJson(CONTRACT_REGISTRY_KEY, null);
  if (Array.isArray(stored) && stored.length) {
    return normalizeClientContracts(stored);
  }
  const base = getBaseContractsSource();
  if (base.length) saveContractsSource(base);
  return base;
}

export function getContractStatusMap() {
  return readJson(CONTRACT_STATUS_KEY, {});
}

export function getContractKey(contract) {
  return `${contract.clientSlug}::${contract.service}::${contract.employee}`;
}

export function getContracts() {
  const statusMap = getContractStatusMap();
  return getContractsSource().map((client) => ({
    slug: client.slug,
    name: client.name,
    services: (client.services || []).map((service) => {
      const contract = {
        clientSlug: client.slug,
        clientName: client.name,
        service:    service.service,
        employee:   service.employee
      };
      return {
        ...contract,
        status:    statusMap[getContractKey(contract)] || "active",
        startedAt: String(service.startedAt || "").trim(),
        endedAt:   String(service.endedAt   || "").trim(),
      };
    })
  }));
}

export function getClientContract(clientSlug) {
  const slug = String(clientSlug || "").trim();
  return getContracts().find((client) => client.slug === slug) || null;
}

export function getServiceCatalog() {
  const catalog = new Map();

  (Array.isArray(window.PortalContracts && window.PortalContracts.serviceCatalog)
    ? window.PortalContracts.serviceCatalog
    : []
  ).forEach((entry) => {
    const serviceName = normalizeServiceName(entry && entry.service);
    if (!serviceName) return;
    if (!catalog.has(serviceName)) catalog.set(serviceName, new Set());
    (Array.isArray(entry && entry.employees) ? entry.employees : []).forEach((employee) => {
      const employeeName = normalizeEntityName(employee);
      if (employeeName) catalog.get(serviceName).add(employeeName);
    });
  });

  getContractsSource().forEach((client) => {
    client.services.forEach((service) => {
      if (!catalog.has(service.service)) catalog.set(service.service, new Set());
      catalog.get(service.service).add(service.employee);
    });
  });

  return Array.from(catalog.entries())
    .map(([service, employees]) => ({
      service,
      employees: Array.from(employees.values()).sort((a, b) => a.localeCompare(b, "pt-BR"))
    }))
    .sort((a, b) => a.service.localeCompare(b.service, "pt-BR"));
}

export function getEmployeesForService(service) {
  const normalizedService = normalizeServiceName(service);
  const entry = getServiceCatalog().find((item) => item.service === normalizedService);
  return entry ? entry.employees : [];
}

export function getKnownEmployees() {
  const employees = new Set(
    Array.isArray(window.PortalContracts && window.PortalContracts.employees)
      ? window.PortalContracts.employees.map((e) => normalizeEntityName(e)).filter(Boolean)
      : []
  );
  getContractsSource().forEach((client) => {
    client.services.forEach((service) => employees.add(service.employee));
  });
  return employees;
}

export function resolveContractEmployee(clientSlug, service, employee) {
  const slug         = String(clientSlug || "").trim();
  const serviceName  = normalizeServiceName(service);
  const employeeName = normalizeEntityName(employee);
  const client       = getContractsSource().find((item) => item.slug === slug);

  if (client) {
    if (serviceName) {
      const serviceMatch = client.services.find((item) => item.service === serviceName);
      if (serviceMatch) return serviceMatch.employee;
    }
    if (employeeName) {
      const employeeMatch = client.services.find((item) => item.employee === employeeName);
      if (employeeMatch) return employeeMatch.employee;
    }
  }

  if (employeeName && getKnownEmployees().has(employeeName)) {
    return employeeName;
  }
  return employeeName;
}

// ── Profile helpers ─────────────────────────────────────────────────────────

export function getClientProfiles() {
  const profiles = readJson(CLIENT_PROFILES_KEY, {});
  const next = {};
  getContractsSource().forEach((client) => {
    next[client.slug] = normalizeClientProfile(
      client.slug,
      profiles[client.slug] || {},
      client.name
    );
  });
  return next;
}

export function getClientProfile(clientSlug) {
  const slug   = String(clientSlug || "").trim();
  if (!slug) return blankClientProfile("", "");
  const client  = getContractsSource().find((item) => item.slug === slug);
  const profiles = getClientProfiles();
  return normalizeClientProfile(slug, profiles[slug] || {}, client ? client.name : slug);
}

export function getClientSlugFromLocation() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (!parts.length) return "";
  const last = decodeURIComponent(parts[parts.length - 1]);
  if (last.toLowerCase() === "index.html") {
    return parts.length > 1 ? decodeURIComponent(parts[parts.length - 2]) : "";
  }
  return last.includes(".") ? "" : last;
}

export function getClientContext() {
  const slug   = getClientSlugFromLocation();
  const client = getContracts().find((item) => item.slug === slug);
  return {
    slug,
    name:     client ? client.name : String(window.CLIENTE_NAME || ""),
    services: client ? client.services : []
  };
}

export function getProfileFieldValue(profile, key) {
  if (Object.prototype.hasOwnProperty.call(profile, key)) return profile[key];
  return profile.seminar && Object.prototype.hasOwnProperty.call(profile.seminar, key)
    ? profile.seminar[key]
    : "";
}

// ── Billing helpers ─────────────────────────────────────────────────────────

export function getBillingStatusMeta(status) {
  if (status === "late") {
    return {
      label:       "Assinatura atrasada",
      className:   "late",
      description: "Existe uma pendência financeira em acompanhamento pela equipe."
    };
  }
  if (status === "canceled") {
    return {
      label:       "Contrato encerrado",
      className:   "canceled",
      description: "O contrato foi encerrado e novos chamados ficam bloqueados."
    };
  }
  return {
    label:       "Assinatura ativa",
    className:   "current",
    description: "Cliente liberado para seguir usando o portal normalmente."
  };
}

export function getBaseStore() {
  return {
    [CONTRACT_REGISTRY_KEY]: getBaseContractsSource(),
    [CONTRACT_STATUS_KEY]:   {},
    [CLIENT_PROFILES_KEY]:   {},
  };
}
