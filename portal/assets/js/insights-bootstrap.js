/**
 * insights-bootstrap.js — Entry point.
 *
 * - Initializes portal contract bindings
 * - Starts live refresh
 * - Exposes window.PortalInsights (backward-compatible public API)
 */

import {
  state,
  RATINGS_KEY,
  TASK_REVIEWS_KEY,
  CONTRACT_REGISTRY_KEY,
  CONTRACT_STATUS_KEY,
  CLIENT_PROFILES_KEY,
  CLIENT_CONTEXT_KEY,
  GLOBAL_ASSIGNEE_IDS,
  LEGACY_TIPO_OPTION_ALIASES,
  CLIENT_PROFILE_SCHEMA
} from "./insights-state.js";

import {
  clone,
  readJson,
  writeJson,
  normalizeEntityName,
  normalizeServiceName,
  normalizeOptionLabel,
  uniqueValues,
  escapeHtml,
  makeDomSafeId,
  formatProfileDate,
  formatProfileDateTime,
  average,
  roundOne
} from "./insights-utils.js";

import {
  normalizeClientContracts,
  getBaseContractsSource,
  getContractsSource,
  getContractStatusMap,
  getContracts,
  getClientContract,
  getServiceCatalog,
  getEmployeesForService,
  getKnownEmployees,
  resolveContractEmployee,
  getClientProfiles,
  getClientProfile,
  getClientContext,
  getClientSlugFromLocation,
  getBillingStatusMeta,
  formatClientName,
  formatEmployeeName,
  formatServiceName,
  getBaseStore,
  getProfileFieldValue,
  blankClientProfile,
  blankSeminarData,
  normalizeClientProfile,
  getContractKey
} from "./insights-contracts.js";

import { apiRequest } from "./insights-api.js";
import { getRatings, getTaskRating, getRatingMeta, saveRating, getTaskRevisionKey } from "./insights-ratings.js";
import { getTaskReviews, getTaskReview, saveTaskReview } from "./insights-reviews.js";
import { getTaskReviewState } from "./insights-task-state.js";
import { saveClientProfile, getMonthlyProfileMeta, renderPortalProfileSummary, refreshPortalSubmissionGate, renderPortalExtraAssignees, ensurePortalProfileUI, getOpeningTaskFiles, clearOpeningTaskFiles, fillPortalProfileForm } from "./insights-profiles.js";
import { enhanceTaskCards, buildTaskPayload } from "./insights-task-cards.js";
import { installChatMentionUI } from "./insights-mentions.js";
import { openRatingModal } from "./insights-rating-modal.js";

// ── Init / bootstrap data ─────────────────────────────────────────────────────

function applyServerSnapshot(payload) {
  const fallback = getBaseStore();
  state.store[CONTRACT_REGISTRY_KEY] = normalizeClientContracts(
    Array.isArray(payload && payload.contractRegistry) ? payload.contractRegistry : fallback[CONTRACT_REGISTRY_KEY]
  );
  state.store[CONTRACT_STATUS_KEY] = payload && typeof payload.contractStatus === "object" && payload.contractStatus
    ? clone(payload.contractStatus)
    : {};
  state.store[RATINGS_KEY]         = Array.isArray(payload && payload.ratings) ? clone(payload.ratings) : [];
  state.store[TASK_REVIEWS_KEY]    = Array.isArray(payload && payload.taskReviews) ? clone(payload.taskReviews) : [];
  state.store[CLIENT_PROFILES_KEY] = payload && typeof payload.clientProfiles === "object" && payload.clientProfiles
    ? clone(payload.clientProfiles)
    : {};
  state.initialized = true;
}

export async function init(options) {
  const settings = options || {};
  const force    = settings.force  === true;
  const silent   = settings.silent === true;

  if (state.initPromise && !force) return state.initPromise;

  if (state.initialized && !force) {
    return {
      contractRegistry: readJson(CONTRACT_REGISTRY_KEY, []),
      contractStatus:   readJson(CONTRACT_STATUS_KEY,   {}),
      ratings:          readJson(RATINGS_KEY,            []),
      taskReviews:      readJson(TASK_REVIEWS_KEY,       []),
    };
  }

  state.initPromise = apiRequest("bootstrap", { method: "GET" })
    .then((payload) => {
      applyServerSnapshot(payload);
      applyPortalContractBindings();
      return payload;
    })
    .catch((error) => {
      if (!silent) throw error;
      const fallback = getBaseStore();
      state.store[CONTRACT_REGISTRY_KEY] = clone(fallback[CONTRACT_REGISTRY_KEY] || []);
      state.store[CONTRACT_STATUS_KEY]   = clone(fallback[CONTRACT_STATUS_KEY]   || {});
      state.store[RATINGS_KEY]           = [];
      state.store[TASK_REVIEWS_KEY]      = [];
      state.store[CLIENT_PROFILES_KEY]   = clone(fallback[CLIENT_PROFILES_KEY]  || {});
      state.initialized = false;
      applyPortalContractBindings();
      return {
        contractRegistry: readJson(CONTRACT_REGISTRY_KEY, []),
        contractStatus:   readJson(CONTRACT_STATUS_KEY,   {}),
        ratings:          readJson(RATINGS_KEY,            []),
        taskReviews:      readJson(TASK_REVIEWS_KEY,       []),
        clientProfiles:   readJson(CLIENT_PROFILES_KEY,   {}),
      };
    })
    .finally(() => { state.initPromise = null; });

  return state.initPromise;
}

// ── Contract API ──────────────────────────────────────────────────────────────

export async function upsertContract(clientSlug, service, employee, options) {
  const slug         = String(clientSlug || "").trim();
  const serviceName  = normalizeServiceName(service);
  const employeeName = normalizeEntityName(employee);
  const requestedStatus = options && options.status === "canceled" ? "canceled" : "active";

  if (!slug)         throw new Error("Cliente obrigatório.");
  if (!serviceName)  throw new Error("Serviço obrigatório.");
  if (!employeeName) throw new Error("Prestador obrigatório.");

  const routeLabel = typeof window.PortalAuth !== "undefined" && window.PortalAuth.getClientRouteBySlug
    ? window.PortalAuth.getClientRouteBySlug(slug)?.label
    : "";

  const payload = await apiRequest("upsert_contract", {
    method: "POST",
    body: {
      clientSlug:  slug,
      clientName:  normalizeEntityName(options && options.clientName || routeLabel || slug),
      service:     serviceName,
      employee:    employeeName,
      status:      requestedStatus,
      startedAt:   options && options.startedAt || "",
    }
  });

  await init({ force: true, silent: true });
  applyPortalContractBindings();
  return payload.contract || { clientSlug: slug, service: serviceName, employee: employeeName, status: requestedStatus, startedAt: options && options.startedAt || "" };
}

export async function removeContract(clientSlug, service, employee) {
  const payload = await apiRequest("remove_contract", {
    method: "POST",
    body: {
      clientSlug: String(clientSlug || "").trim(),
      service:    normalizeServiceName(service),
      employee:   normalizeEntityName(employee),
    }
  });
  await init({ force: true, silent: true });
  applyPortalContractBindings();
  return payload.removed === true;
}

export async function setContractStatus(clientSlug, service, employee, status) {
  const nextStatus = status === "canceled" ? "canceled" : "active";
  await apiRequest("set_contract_status", {
    method: "POST",
    body: {
      clientSlug: String(clientSlug || "").trim(),
      service:    normalizeServiceName(service),
      employee:   normalizeEntityName(employee),
      status:     nextStatus,
    }
  });
  await init({ force: true, silent: true });
  applyPortalContractBindings();
  return nextStatus;
}

export async function toggleContractStatus(clientSlug, service, employee) {
  const contracts = getContracts();
  const client    = contracts.find((item) => item.slug === clientSlug);
  const contract  = client && client.services.find((item) => item.service === service && item.employee === employee);
  if (!contract) return "active";
  return setContractStatus(clientSlug, service, employee, contract.status === "active" ? "canceled" : "active");
}

// ── Dashboard snapshot ────────────────────────────────────────────────────────

export function getDashboardSnapshot() {
  const contracts   = getContracts();
  const ratings     = getRatings();
  const taskReviews = getTaskReviews();
  const profiles    = getClientProfiles();

  const activeContracts   = [];
  const canceledContracts = [];
  contracts.forEach((client) => {
    client.services.forEach((service) => {
      if (service.status === "canceled") canceledContracts.push(service);
      else activeContracts.push(service);
    });
  });

  const serviceMap = new Map();
  [...activeContracts, ...canceledContracts].forEach((contract) => {
    const key = contract.service;
    if (!serviceMap.has(key)) {
      serviceMap.set(key, { service: key, activeCount: 0, canceledCount: 0, clients: new Set() });
    }
    const item = serviceMap.get(key);
    if (contract.status === "canceled") item.canceledCount += 1;
    else item.activeCount += 1;
    item.clients.add(contract.clientSlug);
  });

  const employeeMap = new Map();
  window.PortalContracts && Array.isArray(window.PortalContracts.employees) && window.PortalContracts.employees.forEach((employee) => {
    employeeMap.set(employee, { employee, activeDiamonds: new Set(), canceledServices: 0, ratings: [] });
  });
  contracts.forEach((client) => {
    client.services.forEach((service) => {
      if (!employeeMap.has(service.employee)) {
        employeeMap.set(service.employee, { employee: service.employee, activeDiamonds: new Set(), canceledServices: 0, ratings: [] });
      }
      const emp = employeeMap.get(service.employee);
      if (service.status === "canceled") emp.canceledServices += 1;
      else emp.activeDiamonds.add(client.slug);
    });
  });

  const knownEmployees = getKnownEmployees();
  ratings.forEach((rating) => {
    const employeeName = resolveContractEmployee(rating.clientSlug, rating.service, rating.employee);
    if (!employeeName || !knownEmployees.has(employeeName)) return;
    if (!employeeMap.has(employeeName)) {
      employeeMap.set(employeeName, { employee: employeeName, activeDiamonds: new Set(), canceledServices: 0, ratings: [] });
    }
    employeeMap.get(employeeName).ratings.push(rating.score);
  });

  const satisfactionByService = new Map();
  const satisfactionByClient  = new Map();
  const reviewByService  = new Map();
  const reviewByClient   = new Map();
  const reviewByEmployee = new Map();

  ratings.forEach((rating) => {
    if (rating.service) {
      if (!satisfactionByService.has(rating.service)) satisfactionByService.set(rating.service, []);
      satisfactionByService.get(rating.service).push(rating.score);
    }
    if (rating.clientSlug) {
      if (!satisfactionByClient.has(rating.clientSlug)) {
        satisfactionByClient.set(rating.clientSlug, { clientSlug: rating.clientSlug, clientName: rating.clientName, scores: [] });
      }
      satisfactionByClient.get(rating.clientSlug).scores.push(rating.score);
    }
  });

  taskReviews.forEach((review) => {
    if (review.service) {
      if (!reviewByService.has(review.service)) reviewByService.set(review.service, { total: 0, approved: 0, changesRequested: 0 });
      const entry = reviewByService.get(review.service);
      entry.total += 1;
      if (review.status === "changes_requested") entry.changesRequested += 1; else entry.approved += 1;
    }
    if (review.clientSlug) {
      if (!reviewByClient.has(review.clientSlug)) reviewByClient.set(review.clientSlug, { total: 0, approved: 0, changesRequested: 0 });
      const entry = reviewByClient.get(review.clientSlug);
      entry.total += 1;
      if (review.status === "changes_requested") entry.changesRequested += 1; else entry.approved += 1;
    }
    if (review.employee) {
      if (!reviewByEmployee.has(review.employee)) reviewByEmployee.set(review.employee, { total: 0, approved: 0, changesRequested: 0 });
      const entry = reviewByEmployee.get(review.employee);
      entry.total += 1;
      if (review.status === "changes_requested") entry.changesRequested += 1; else entry.approved += 1;
    }
  });

  const serviceSummary = Array.from(serviceMap.values())
    .map((item) => ({
      service:          item.service,
      activeCount:      item.activeCount,
      canceledCount:    item.canceledCount,
      clientCount:      item.clients.size,
      averageRating:    roundOne(average((satisfactionByService.get(item.service) || []).map(Number))),
      totalReviews:     reviewByService.get(item.service)?.total || 0,
      approvedReviews:  reviewByService.get(item.service)?.approved || 0,
      changesRequested: reviewByService.get(item.service)?.changesRequested || 0,
    }))
    .sort((a, b) => (b.activeCount + b.canceledCount) - (a.activeCount + a.canceledCount) || a.service.localeCompare(b.service, "pt-BR"));

  const employeeSummary = Array.from(employeeMap.values())
    .map((item) => ({
      employee:         item.employee,
      activeDiamonds:   item.activeDiamonds.size,
      canceledServices: item.canceledServices,
      averageRating:    roundOne(average(item.ratings.map(Number))),
      totalRatings:     item.ratings.length,
      totalReviews:     reviewByEmployee.get(item.employee)?.total || 0,
      approvedReviews:  reviewByEmployee.get(item.employee)?.approved || 0,
      changesRequested: reviewByEmployee.get(item.employee)?.changesRequested || 0,
    }))
    .sort((a, b) => b.activeDiamonds - a.activeDiamonds || a.employee.localeCompare(b.employee, "pt-BR"));

  const clientSummary = contracts
    .map((client) => {
      const ratingInfo  = satisfactionByClient.get(client.slug);
      const scores      = ratingInfo ? ratingInfo.scores : [];
      const profile     = profiles[client.slug] || blankClientProfile(client.slug, client.name);
      const lastUpdate  = profile.updatedAt ? new Date(profile.updatedAt) : null;
      const monthlyProfilePending = !lastUpdate || Number.isNaN(lastUpdate.getTime())
        ? true
        : (Date.now() - lastUpdate.getTime()) > (1000 * 60 * 60 * 24 * 30);
      return {
        slug:                client.slug,
        name:                client.name,
        activeServices:      client.services.filter((s) => s.status !== "canceled").length,
        canceledServices:    client.services.filter((s) => s.status === "canceled").length,
        averageRating:       roundOne(average(scores)),
        totalRatings:        scores.length,
        totalReviews:        reviewByClient.get(client.slug)?.total || 0,
        approvedReviews:     reviewByClient.get(client.slug)?.approved || 0,
        changesRequested:    reviewByClient.get(client.slug)?.changesRequested || 0,
        services:            client.services,
        profile,
        billingStatus:       profile.billingStatus || "current",
        contractStartedAt:   profile.contractStartedAt || "",
        contractEndedAt:     profile.contractEndedAt || "",
        monthlyProfilePending,
        lastProfileUpdatedAt: profile.updatedAt || ""
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return {
    contracts,
    clientProfiles: profiles,
    ratings,
    taskReviews,
    diamonds: {
      totalClients:            contracts.length,
      totalActiveServices:     activeContracts.length,
      totalCanceledServices:   canceledContracts.length,
      lateBillingClients:      clientSummary.filter((c) => c.billingStatus === "late").length,
      monthlyProfilePending:   clientSummary.filter((c) => c.monthlyProfilePending).length,
      mostContractedServices:  serviceSummary.slice(0, 5),
      services:                serviceSummary,
      clients:                 clientSummary
    },
    employees: employeeSummary,
    satisfaction: {
      overallAverage: roundOne(average(ratings.map((r) => Number(r.score)))),
      totalRatings:   ratings.length,
      byService:      serviceSummary.filter((s) => s.averageRating != null).sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0)),
      byClient:       clientSummary.filter((c) => c.averageRating != null).sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0)),
      byEmployee:     employeeSummary.filter((e) => e.averageRating != null).sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0))
    },
    reviewFlow: {
      total:            taskReviews.length,
      approved:         taskReviews.filter((r) => r.status !== "changes_requested").length,
      changesRequested: taskReviews.filter((r) => r.status === "changes_requested").length
    }
  };
}

// ── Portal-specific helpers ───────────────────────────────────────────────────

function getPortalAutoMap()          { return typeof AUTO_MAP            !== "undefined" ? AUTO_MAP            : undefined; }
function getPortalAssigneeIds()      { return typeof ASSIGNEE_IDS        !== "undefined" ? ASSIGNEE_IDS        : undefined; }
function getPortalAssigneeTypeById() { return typeof ASSIGNEE_TYPE_BY_ID !== "undefined" ? ASSIGNEE_TYPE_BY_ID : undefined; }
function getPortalTipoOptions()      { return typeof CF_TIPO_OPTIONS      !== "undefined" ? CF_TIPO_OPTIONS      : undefined; }
function getPortalTipoSelect()       { return typeof tipoSelect           !== "undefined" ? tipoSelect           : undefined; }
function getPortalPrestadorSelect()  { return typeof prestadorSelect      !== "undefined" ? prestadorSelect      : undefined; }

// ── Select controller ─────────────────────────────────────────────────────────

function findOptionByValue(root, value) {
  return Array.from(root.querySelectorAll(".option[data-value]")).find((o) => o.dataset.value === value) || null;
}

function patchLegacySelect(binding, controller) {
  if (!binding || typeof binding !== "object") return controller;
  binding.setOptions = (values, options) => controller.setOptions(values, options);
  binding.setValue   = (value)           => controller.setValue(value);
  binding.getValue   = ()                => controller.getValue();
  binding.reset      = ()                => controller.reset();
  binding.enable     = ()                => controller.enable();
  binding.disable    = ()                => controller.disable();
  binding.__portalController = controller;
  return controller;
}

function getOrCreateSelectController(bindingName, triggerId, dropId, placeholder) {
  const trigger      = document.getElementById(triggerId);
  const drop         = document.getElementById(dropId);
  const optionsRoot  = drop && drop.querySelector(".dropdown-options");
  const search       = drop && drop.querySelector(".search-input");
  const label        = trigger && trigger.querySelector(".select-label");
  const legacyBinding = bindingName === "tipoSelect" ? getPortalTipoSelect() : getPortalPrestadorSelect();

  if (!trigger || !drop || !optionsRoot || !label) return null;

  if (drop.__portalController) {
    patchLegacySelect(legacyBinding, drop.__portalController);
    return drop.__portalController;
  }

  const localState = { value: null, placeholder };

  const controller = {
    onSelect: null,
    filter(query) {
      const needle = String(query || "").trim().toLocaleLowerCase("pt-BR");
      Array.from(optionsRoot.querySelectorAll(".option")).forEach((option) => {
        if (!option.dataset.value) return;
        const matches = !needle || option.dataset.value.toLocaleLowerCase("pt-BR").includes(needle);
        option.classList.toggle("hidden", !matches);
      });
    },
    setOptions(values, options) {
      const items      = uniqueValues(values);
      const emptyLabel = options && options.emptyLabel ? options.emptyLabel : "Nenhum serviço ativo";

      optionsRoot.innerHTML = items.length
        ? items.map((item) => `<div class="option" data-value="${escapeHtml(item)}">${escapeHtml(item)}</div>`).join("")
        : `<div class="option" data-empty="true">${escapeHtml(emptyLabel)}</div>`;

      if (search) search.value = "";
      if (!items.includes(localState.value)) {
        controller.reset({ silent: true, placeholder: localState.placeholder });
      } else {
        controller.setValue(localState.value, { silent: true });
      }
      controller.filter("");
    },
    setValue(value, options) {
      const option = findOptionByValue(optionsRoot, value);
      if (!option) { controller.reset(options); return false; }

      localState.value      = option.dataset.value;
      label.textContent     = option.dataset.value;
      trigger.classList.add("selected");
      trigger.classList.remove("open");
      drop.classList.remove("open");

      Array.from(optionsRoot.querySelectorAll(".option")).forEach((item) => {
        item.classList.toggle("selected", item === option);
      });

      if (!(options && options.silent) && typeof controller.onSelect === "function") {
        controller.onSelect(option.dataset.value);
      }
      return true;
    },
    getValue() { return localState.value; },
    reset(options) {
      localState.value   = null;
      label.textContent  = options && options.placeholder ? options.placeholder : localState.placeholder;
      trigger.classList.remove("selected", "open");
      drop.classList.remove("open");
      Array.from(optionsRoot.querySelectorAll(".option")).forEach((item) => item.classList.remove("selected"));
    },
    enable()   { trigger.classList.remove("disabled"); },
    disable(customPlaceholder) {
      controller.reset({ silent: true, placeholder: customPlaceholder || localState.placeholder });
      trigger.classList.add("disabled");
    }
  };

  drop.addEventListener("click", (event) => {
    const option = event.target.closest(".option[data-value]");
    if (!option) return;
    controller.setValue(option.dataset.value);
  });

  if (search) {
    search.addEventListener("input", () => controller.filter(search.value));
  }

  drop.__portalController = controller;
  patchLegacySelect(legacyBinding, controller);
  return controller;
}

// ── Tipo options hydration ────────────────────────────────────────────────────

function getTipoOptionAliases(serviceName) {
  const normalizedService = normalizeServiceName(serviceName);
  const aliases = LEGACY_TIPO_OPTION_ALIASES[normalizedService] || [normalizedService];
  return Array.from(new Set(
    aliases.map((label) => normalizeOptionLabel(label)).filter(Boolean)
  ));
}

export async function hydratePortalTipoOptions() {
  const tipoOptions = getPortalTipoOptions();
  if (!tipoOptions || state.tipoOptionsHydrated || state.tipoOptionsPromise) {
    return state.tipoOptionsPromise || Promise.resolve();
  }

  const listId  = typeof CU_LIST_ID  !== "undefined" ? String(CU_LIST_ID  || "").trim() : "";
  const fieldId = typeof CF_TIPO_ID  !== "undefined" ? String(CF_TIPO_ID  || "").trim() : "";
  if (!listId || !fieldId) { state.tipoOptionsHydrated = true; return Promise.resolve(); }

  // FIX (pentest HIGH): rota via proxy server-side em vez de chamar api.clickup.com direto
  // (que exporia GP_CLICKUP_API_KEY no browser). Backend autentica e repassa.
  const clientSlug = typeof CLIENTE_SLUG !== "undefined" ? CLIENTE_SLUG : "";
  state.tipoOptionsPromise = fetch("/api/clickup.php", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "GET", path: `list/${listId}/field`, clientSlug, body: null }),
  })
    .then((response) => response.json().catch(() => null).then((payload) => ({ response, payload })))
    .then(({ response, payload }) => {
      if (!response.ok || !payload) throw new Error(`Erro ${response.status}`);

      const fields = Array.isArray(payload.fields) ? payload.fields : Array.isArray(payload) ? payload : [];
      const tipoField = fields.find((field) => {
        const id   = String(field && field.id || "").trim();
        const name = normalizeOptionLabel(field && field.name || "");
        return id === fieldId || name === "TIPO DE SERVICO" || name === "TIPO DE SERVIÇO";
      });

      const options = Array.isArray(tipoField && tipoField.type_config && tipoField.type_config.options)
        ? tipoField.type_config.options : [];

      const optionLookup = new Map(
        options
          .map((option) => [normalizeOptionLabel(option && (option.name || option.label) || ""), String(option && option.id || "").trim()])
          .filter(([l, id]) => l && id)
      );

      Object.keys(tipoOptions).forEach((serviceName) => {
        if (tipoOptions[serviceName]) return;
        const aliases = getTipoOptionAliases(serviceName);
        const match   = aliases.find((alias) => optionLookup.has(alias));
        if (match) tipoOptions[serviceName] = optionLookup.get(match);
      });

      state.tipoOptionsHydrated = true;
    })
    .catch(() => { state.tipoOptionsHydrated = false; })
    .finally(() => { state.tipoOptionsPromise = null; });

  return state.tipoOptionsPromise;
}

// ── Portal contract bindings ──────────────────────────────────────────────────

export function applyPortalContractBindings() {
  if (!document.getElementById("mainForm")) return;

  const context = getClientContext();
  if (!context.slug) return;
  ensurePortalProfileUI(context, { applyPortalContractBindings });
  const profile = getClientProfile(context.slug);

  const autoMap          = getPortalAutoMap();
  const assigneeIds      = getPortalAssigneeIds();
  const assigneeTypeById = getPortalAssigneeTypeById();
  const tipoOptions      = getPortalTipoOptions();
  const typeController     = getOrCreateSelectController("tipoSelect",    "tipoServico", "dropTipo",      "Selecionar opção...");
  const providerController = getOrCreateSelectController("prestadorSelect","prestador",   "dropPrestador", "Selecionar opção...");
  const autofillBadge    = document.getElementById("autofillBadge");

  if (!autoMap || !assigneeIds || !assigneeTypeById || !tipoOptions || !typeController || !providerController) return;

  Object.assign(assigneeIds, GLOBAL_ASSIGNEE_IDS);

  const client          = getClientContract(context.slug);
  const activeServices  = client ? client.services.filter((s) => s.status !== "canceled") : [];
  const assignmentMap   = activeServices.reduce((map, item) => {
    if (!map[item.service]) map[item.service] = [];
    map[item.service].push(item.employee);
    return map;
  }, {});
  const allActiveEmployees = uniqueValues(activeServices.map((item) => item.employee));

  Object.keys(autoMap).forEach((key) => delete autoMap[key]);
  Object.entries(assignmentMap).forEach(([service, employees]) => {
    autoMap[service] = employees[0];
    if (!Object.prototype.hasOwnProperty.call(tipoOptions, service)) {
      tipoOptions[service] = null;
    }
  });

  Object.keys(assigneeTypeById).forEach((key) => delete assigneeTypeById[key]);
  Object.entries(assignmentMap).forEach(([service, employees]) => {
    employees.forEach((employee) => {
      const assigneeId = assigneeIds[employee];
      if (assigneeId) assigneeTypeById[String(assigneeId)] = service;
    });
  });

  const serviceNames    = Object.keys(assignmentMap);
  const selectedService = typeController.getValue();

  typeController.onSelect = (serviceName) => {
    const employeeName = assignmentMap[serviceName] && assignmentMap[serviceName][0];
    providerController.setOptions(employeeName ? [employeeName] : [], { emptyLabel: "Sem prestador ativo" });
    if (employeeName) {
      providerController.enable();
      providerController.setValue(employeeName, { silent: true });
      renderPortalExtraAssignees(employeeName, allActiveEmployees);
      if (autofillBadge) autofillBadge.classList.add("visible");
    } else {
      providerController.disable("Sem prestador ativo");
      renderPortalExtraAssignees("", []);
      if (autofillBadge) autofillBadge.classList.remove("visible");
    }
  };

  typeController.setOptions(serviceNames, { emptyLabel: "Nenhum serviço ativo" });

  if (!serviceNames.length) {
    typeController.disable("Nenhum serviço ativo");
    providerController.setOptions([], { emptyLabel: "Sem prestador ativo" });
    providerController.disable("Sem prestador ativo");
    renderPortalExtraAssignees("", []);
    if (autofillBadge) autofillBadge.classList.remove("visible");
    refreshPortalSubmissionGate(activeServices, profile);
    return;
  }

  refreshPortalSubmissionGate(activeServices, profile);
  typeController.enable();
  providerController.setOptions([], { emptyLabel: "Sem prestador ativo" });
  providerController.disable("Selecionar opção...");

  if (selectedService && assignmentMap[selectedService] && assignmentMap[selectedService][0]) {
    typeController.setValue(selectedService, { silent: false });
    return;
  }

  typeController.reset();
  providerController.reset({ placeholder: "Selecionar opção..." });
  providerController.disable("Selecionar opção...");
  renderPortalExtraAssignees("", []);
  if (autofillBadge) autofillBadge.classList.remove("visible");
}

// ── Live refresh ──────────────────────────────────────────────────────────────

async function refreshPortalStateInBackground() {
  if (state.portalRefreshBusy || !document.getElementById("mainForm")) return;
  const context = getClientContext();
  if (!context.slug) return;

  state.portalRefreshBusy = true;
  try {
    await init({ force: true, silent: true });
    applyPortalContractBindings();
  } catch (_) {
    // Keep the portal usable even if background refresh fails.
  } finally {
    state.portalRefreshBusy = false;
  }
}

function startPortalLiveRefresh() {
  if (state.portalRefreshBound || !document.getElementById("mainForm")) return;
  state.portalRefreshBound = true;
  state.portalRefreshTimer = window.setInterval(() => {
    if (!document.hidden) refreshPortalStateInBackground();
  }, 30000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshPortalStateInBackground();
  });
  window.addEventListener("focus", () => { refreshPortalStateInBackground(); });
}

// ── Client context ────────────────────────────────────────────────────────────

function getStoredClientContext() {
  return readJson(CLIENT_CONTEXT_KEY, {});
}

function setStoredClientContext(slug, payload) {
  const next = getStoredClientContext();
  next[slug] = payload;
  writeJson(CLIENT_CONTEXT_KEY, next);
}

function syncClientContext(payload) {
  const context = getClientContext();
  if (!context.slug) return;
  setStoredClientContext(context.slug, {
    clientName: payload.clientName || context.name,
    updatedAt:  new Date().toISOString()
  });
}

function getSelectedTaskAssignees() {
  return Array.from(document.querySelectorAll(".gp-extra-assignee:checked"))
    .map((input) => normalizeEntityName(input.value))
    .map((employee) => GLOBAL_ASSIGNEE_IDS[employee])
    .filter(Boolean);
}

// ── Task handling ─────────────────────────────────────────────────────────────

function enqueueResolvedTasks(context, tasks) {
  const unresolved = tasks
    .map((task) => buildTaskPayload(task, context))
    .filter((task) => {
      const reviewState = getTaskReviewState(task);
      return task.status === "resolvido" && reviewState.stage === "approved" && !reviewState.rating;
    })
    .sort((a, b) => Number(b.resolvedAt || b.createdAt || 0) - Number(a.resolvedAt || a.createdAt || 0));

  state.context      = context;
  state.pendingQueue = unresolved;
  if (!state.activeTaskId && unresolved.length) {
    openRatingModal(unresolved[0], context);
  }
}

function handleTasksLoadedInternal(payload) {
  const context = getClientContext();
  if (!payload || !Array.isArray(payload.tasks)) return;
  enhanceTaskCards(payload.tasks, context);
  installChatMentionUI(context);
  enqueueResolvedTasks(
    { slug: context.slug, name: payload.clientName || context.name },
    payload.tasks
  );
}

// ── Boot ─────────────────────────────────────────────────────────────────────

function bootPortalContracts() {
  applyPortalContractBindings();
  hydratePortalTipoOptions();
  init({ silent: true });
  startPortalLiveRefresh();
}

bootPortalContracts();

// ── Public API (window.PortalInsights) ────────────────────────────────────────

window.PortalInsights = {
  init,
  getContracts,
  getClientProfiles,
  getClientProfile,
  getClientProfileSchema() { return clone(CLIENT_PROFILE_SCHEMA); },
  getServiceCatalog,
  getEmployeesForService,
  getRatings,
  getTaskReviews,
  getTaskRating,
  getTaskReview,
  getRatingMeta,
  saveRating,
  saveTaskReview,
  saveClientProfile,
  upsertContract,
  removeContract,
  setContractStatus,
  toggleContractStatus,
  getDashboardSnapshot,
  formatClientName,
  formatEmployeeName,
  formatServiceName,
  formatProfileDate,
  formatProfileDateTime,
  getBillingStatusMeta,
  getMonthlyProfileMeta,
  getOpeningTaskFiles,
  clearOpeningTaskFiles,
  ensurePortalTipoOptions: hydratePortalTipoOptions,
  getSelectedTaskAssignees,
  handleTasksLoaded(payload) {
    syncClientContext(payload || {});
    init({ silent: true }).then(() => {
      handleTasksLoadedInternal(payload);
    });
  }
};

