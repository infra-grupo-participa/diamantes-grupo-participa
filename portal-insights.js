(function () {
  const RATINGS_KEY = "gp_service_ratings_v1";
  const TASK_REVIEWS_KEY = "gp_task_reviews_v1";
  const CONTRACT_REGISTRY_KEY = "gp_contract_registry_v1";
  const CONTRACT_STATUS_KEY = "gp_contract_status_v1";
  const CLIENT_PROFILES_KEY = "gp_client_profiles_v1";
  const CLIENT_CONTEXT_KEY = "gp_client_context_v1";
  const scriptUrl = document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : window.location.href;
  const appRootUrl = new URL("./", scriptUrl);
  const insightsApiUrl = new URL("api/insights.php", appRootUrl).href;

  const SCORE_META = [
    { min: 1, max: 2, label: "Péssimo", tone: "terrible" },
    { min: 3, max: 4, label: "Ruim", tone: "bad" },
    { min: 5, max: 6, label: "Razoável", tone: "fair" },
    { min: 7, max: 8, label: "Bom", tone: "good" },
    { min: 9, max: 10, label: "Excelente", tone: "great" }
  ];

  const SERVICE_LABELS = {
    "AUTOMAÇÃO": "Automação",
    "EDIÇÃO": "Edição de vídeo",
    "EDIÇÃO DE VÍDEO": "Edição de vídeo",
    "DESENVOLVEDOR WEB": "Webdesigner",
    "ANÚNCIOS PAGOS": "Anúncios Pagos",
    "WEBDESIGNER": "Webdesigner",
    "DESIGNER": "Designer",
    "SOCIAL MEDIA": "Social Media",
    "COPY": "Copywriter",
    "COPYWRITER": "Copywriter",
    "HOST": "Host"
  };

  const CLIENT_PROFILE_SCHEMA = [
    {
      title: "Canais e páginas",
      fields: [
        { key: "instagram", label: "Qual seu Instagram?", type: "text", placeholder: "@seuinstagram" },
        { key: "facebook", label: "Qual seu Facebook?", type: "text", placeholder: "facebook.com/seuperfil" },
        { key: "youtube", label: "Qual seu YouTube?", type: "text", placeholder: "youtube.com/@seucanal" },
        { key: "siteUrl", label: "Qual o endereço do seu site?", type: "url", placeholder: "https://seusite.com.br" },
        { key: "capturePageUrl", label: "Qual o endereço da página de captura do seminário?", type: "url", placeholder: "https://..." },
        { key: "thankYouPageUrl", label: "Qual o endereço da página de obrigado do seminário?", type: "url", placeholder: "https://..." },
        { key: "driveUrl", label: "Qual o link do Drive desse cliente?", type: "url", placeholder: "https://drive.google.com/..." },
      ]
    },
    {
      title: "Datas do próximo seminário",
      fields: [
        { key: "seminarDay1Date", label: "Data do dia 1 do próximo seminário", type: "date" },
        { key: "pitchDate", label: "Data do pitch", type: "date" },
        { key: "cartCloseDate", label: "Data do fechamento de carrinho", type: "date" },
        { key: "testsStartDate", label: "Data do dia 1 dos testes de captação", type: "date" },
        { key: "scaleStartDate", label: "Data do dia 1 da escala de captação", type: "date" },
        { key: "lastSeminarDate", label: "Quando foi seu último seminário?", type: "date" },
      ]
    },
    {
      title: "Captação e mídia",
      fields: [
        { key: "acquisitionChannels", label: "Captação no Google e Meta?", type: "multicheck", options: [{ value: "google", label: "Google" }, { value: "meta", label: "Meta" }] },
        { key: "acquisitionInvestment", label: "Valor a ser investido em captação", type: "text", placeholder: "Ex.: 5000" },
        { key: "acquisitionGoogleShare", label: "Proporção do Google na captação", type: "text", placeholder: "Ex.: 40%" },
        { key: "acquisitionMetaShare", label: "Proporção da Meta na captação", type: "text", placeholder: "Ex.: 60%" },
        { key: "contentDistributionEnabled", label: "Existe investimento em distribuição de conteúdo?", type: "toggle" },
        { key: "contentDistributionAmount", label: "Se sim, quanto será investido em distribuição?", type: "text", placeholder: "Ex.: 1500" },
        { key: "contentDistributionGoogleShare", label: "Proporção do Google na distribuição", type: "text", placeholder: "Ex.: 30%" },
        { key: "contentDistributionMetaShare", label: "Proporção da Meta na distribuição", type: "text", placeholder: "Ex.: 70%" },
        { key: "targetRegion", label: "Sua captação será direcionada para qual região?", type: "text", placeholder: "Cidade, estado ou região" },
      ]
    },
    {
      title: "Metas e ferramentas",
      fields: [
        { key: "lastSeminarLeads", label: "Quantos leads captou no último seminário?", type: "text", placeholder: "Ex.: 320" },
        { key: "targetLeads", label: "Quantos leads pretende captar?", type: "text", placeholder: "Ex.: 500" },
        { key: "emailMarketingTool", label: "Qual ferramenta de e-mail marketing você usa?", type: "text", placeholder: "Ex.: ActiveCampaign" },
        { key: "pageBuilder", label: "Qual construtor de páginas você usa?", type: "text", placeholder: "Ex.: Elementor" },
        { key: "whatsappApiEnabled", label: "Você usa API do WhatsApp?", type: "toggle" },
        { key: "whatsappApiTool", label: "Se sim, por qual ferramenta?", type: "text", placeholder: "Ex.: Z-API" },
      ]
    }
  ];

  const GLOBAL_ASSIGNEE_IDS = {
    "ALEXANDRE MAGNO": 81934453,
    "MATEUS CASTRO": 81934455,
    "JADSON": 81934456,
    "VINÍCIUS PEREIRA": 81934459,
    "LUIS FERNANDO": 81934454,
    "MANUELA RIOS": 84099161,
    "CAIO MARCONDES": 84118999,
    "MARCOS PAULO": 118013882,
    "GABRIEL MENEZES": 84782862,
    "ELAINE MONTENEGRO": 90616609,
    "RENAN SCHWARZ": 106071076,
    "JUNIOR": 111931366,
    "GABRIEL ALVES": 230453991
  };

  const LEGACY_TIPO_OPTION_ALIASES = {
    "AUTOMAÇÃO": ["AUTOMAÇÃO", "AUTOMACAO"],
    "WEBDESIGNER": ["WEBDESIGNER", "WEB DESIGNER", "PÁGINA", "PAGINA"],
    "EDIÇÃO DE VÍDEO": ["EDIÇÃO DE VÍDEO", "EDICAO DE VIDEO", "EDIÇÃO", "EDICAO", "VÍDEO", "VIDEO"],
    "ANÚNCIOS PAGOS": ["ANÚNCIOS PAGOS", "ANUNCIOS PAGOS", "TRÁFEGO", "TRAFEGO"],
    "DESIGNER": ["DESIGNER"],
    "SOCIAL MEDIA": ["SOCIAL MEDIA"],
    "COPYWRITER": ["COPYWRITER", "COPY"],
    "HOST": ["HOST"],
  };

  const state = {
    modalReady: false,
    reviewModalReady: false,
    activeTaskId: null,
    activeReviewTaskId: null,
    reviewTask: null,
    pendingQueue: [],
    context: null,
    initialized: false,
    initPromise: null,
    currentAreaFilter: "all",
    openingTaskFiles: [],
    chatMentionReady: false,
    store: {
      [RATINGS_KEY]: [],
      [TASK_REVIEWS_KEY]: [],
      [CONTRACT_REGISTRY_KEY]: null,
      [CONTRACT_STATUS_KEY]: {},
      [CLIENT_PROFILES_KEY]: {},
      [CLIENT_CONTEXT_KEY]: {}
    },
    tipoOptionsHydrated: false,
    tipoOptionsPromise: null,
    portalRefreshTimer: null,
    portalRefreshBusy: false,
    portalRefreshBound: false,
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function readJson(key, fallback) {
    if (key === CLIENT_CONTEXT_KEY) {
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return clone(fallback);
        return JSON.parse(raw);
      } catch (error) {
        return clone(fallback);
      }
    }

    try {
      const value = state.store[key];
      if (value == null) return clone(fallback);
      return clone(value);
    } catch (error) {
      return clone(fallback);
    }
  }

  function writeJson(key, value) {
    if (key === CLIENT_CONTEXT_KEY) {
      window.localStorage.setItem(key, JSON.stringify(value));
      return;
    }

    state.store[key] = clone(value);
  }

  function normalizeEntityName(value) {
    return String(value || "").trim().toLocaleUpperCase("pt-BR");
  }

  function normalizeServiceName(value) {
    const normalized = normalizeEntityName(value);
    if (normalized === "DESENVOLVEDOR WEB") return "WEBDESIGNER";
    if (normalized === "COPY") return "COPYWRITER";
    if (normalized === "EDIÇÃO") return "EDIÇÃO DE VÍDEO";
    return normalized;
  }

  function blankSeminarData() {
    return {
      instagram: "",
      facebook: "",
      youtube: "",
      siteUrl: "",
      capturePageUrl: "",
      thankYouPageUrl: "",
      driveUrl: "",
      seminarDay1Date: "",
      pitchDate: "",
      cartCloseDate: "",
      testsStartDate: "",
      scaleStartDate: "",
      acquisitionChannels: [],
      acquisitionInvestment: "",
      acquisitionGoogleShare: "",
      acquisitionMetaShare: "",
      contentDistributionEnabled: false,
      contentDistributionAmount: "",
      contentDistributionGoogleShare: "",
      contentDistributionMetaShare: "",
      targetRegion: "",
      lastSeminarDate: "",
      lastSeminarLeads: "",
      targetLeads: "",
      emailMarketingTool: "",
      pageBuilder: "",
      whatsappApiEnabled: false,
      whatsappApiTool: "",
    };
  }

  function blankClientProfile(slug, name) {
    return {
      slug: String(slug || "").trim(),
      name: String(name || "").trim(),
      billingStatus: "current",
      contractStartedAt: "",
      contractEndedAt: "",
      seminar: blankSeminarData(),
      updatedAt: "",
    };
  }

  function normalizeClientProfile(slug, rawProfile, fallbackName) {
    const next = {
      ...blankClientProfile(slug, fallbackName),
      ...(rawProfile || {}),
    };
    const seminar = {
      ...blankSeminarData(),
      ...(next.seminar || {}),
    };

    next.slug = String(slug || next.slug || "").trim();
    next.name = String(next.name || fallbackName || next.slug || "").trim();
    next.billingStatus = ["current", "late", "canceled"].includes(next.billingStatus) ? next.billingStatus : "current";
    next.contractStartedAt = String(next.contractStartedAt || "").trim();
    next.contractEndedAt = String(next.contractEndedAt || "").trim();
    next.updatedAt = String(next.updatedAt || "").trim();
    next.seminar = {
      ...seminar,
      acquisitionChannels: Array.from(new Set(
        (Array.isArray(seminar.acquisitionChannels) ? seminar.acquisitionChannels : [])
          .map((channel) => String(channel || "").trim().toLowerCase())
          .filter((channel) => channel === "google" || channel === "meta")
      )),
      contentDistributionEnabled: Boolean(seminar.contentDistributionEnabled),
      whatsappApiEnabled: Boolean(seminar.whatsappApiEnabled),
    };
    return next;
  }

  function normalizeClientContracts(clients) {
    if (!Array.isArray(clients)) return [];

    return clients
      .map((client) => {
        const slug = String(client && client.slug || "").trim();
        const name = normalizeEntityName(client && client.name || slug);
        const serviceMap = new Map();

        (Array.isArray(client && client.services) ? client.services : []).forEach((service) => {
          const serviceName = normalizeServiceName(service && service.service);
          const employeeName = normalizeEntityName(service && service.employee);
          if (!slug || !serviceName || !employeeName) return;
          serviceMap.set(`${serviceName}::${employeeName}`, {
            service: serviceName,
            employee: employeeName,
            startedAt: String(service && service.startedAt || "").trim(),
            endedAt: String(service && service.endedAt || "").trim(),
          });
        });

        return {
          slug,
          name,
          services: Array.from(serviceMap.values()).sort((a, b) =>
            a.service.localeCompare(b.service, "pt-BR") || a.employee.localeCompare(b.employee, "pt-BR")
          )
        };
      })
      .filter((client) => client.slug)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  function saveContractsSource(clients) {
    const normalized = normalizeClientContracts(clients);
    writeJson(CONTRACT_REGISTRY_KEY, normalized);
    return normalized;
  }

  function getBaseContractsSource() {
    return normalizeClientContracts(
      Array.isArray(window.PortalContracts && window.PortalContracts.clients)
        ? window.PortalContracts.clients
        : []
    );
  }

  function getBaseStore() {
    return {
      [RATINGS_KEY]: [],
      [TASK_REVIEWS_KEY]: [],
      [CONTRACT_REGISTRY_KEY]: getBaseContractsSource(),
      [CONTRACT_STATUS_KEY]: {},
      [CLIENT_PROFILES_KEY]: {},
    };
  }

  function applyServerSnapshot(payload) {
    const fallback = getBaseStore();
    state.store[CONTRACT_REGISTRY_KEY] = normalizeClientContracts(
      Array.isArray(payload && payload.contractRegistry) ? payload.contractRegistry : fallback[CONTRACT_REGISTRY_KEY]
    );
    state.store[CONTRACT_STATUS_KEY] = payload && typeof payload.contractStatus === "object" && payload.contractStatus
      ? clone(payload.contractStatus)
      : fallback[CONTRACT_STATUS_KEY];
    state.store[RATINGS_KEY] = Array.isArray(payload && payload.ratings) ? clone(payload.ratings) : [];
    state.store[TASK_REVIEWS_KEY] = Array.isArray(payload && payload.taskReviews) ? clone(payload.taskReviews) : [];
    state.store[CLIENT_PROFILES_KEY] = payload && typeof payload.clientProfiles === "object" && payload.clientProfiles
      ? clone(payload.clientProfiles)
      : fallback[CLIENT_PROFILES_KEY];
    state.initialized = true;
  }

  async function apiRequest(action, options) {
    const settings = options || {};
    const headers = new Headers(settings.headers || {});
    const init = {
      method: settings.method || "GET",
      credentials: "same-origin",
      headers,
    };

    if (Object.prototype.hasOwnProperty.call(settings, "body")) {
      headers.set("Content-Type", "application/json");
      init.body = JSON.stringify(settings.body);
    }

    const response = await window.fetch(`${insightsApiUrl}?action=${action}`, init);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.ok === false) {
      throw new Error(payload && payload.error ? payload.error : `Erro ${response.status}`);
    }
    return payload;
  }

  async function init(options) {
    const settings = options || {};
    const force = settings.force === true;
    const silent = settings.silent === true;

    if (state.initPromise && !force) {
      return state.initPromise;
    }

    if (state.initialized && !force) {
      return {
        contractRegistry: readJson(CONTRACT_REGISTRY_KEY, []),
        contractStatus: readJson(CONTRACT_STATUS_KEY, {}),
        ratings: readJson(RATINGS_KEY, []),
        taskReviews: readJson(TASK_REVIEWS_KEY, []),
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
        state.store[CONTRACT_REGISTRY_KEY] = clone(fallback[CONTRACT_REGISTRY_KEY]);
        state.store[CONTRACT_STATUS_KEY] = clone(fallback[CONTRACT_STATUS_KEY]);
        state.store[RATINGS_KEY] = clone(fallback[RATINGS_KEY]);
        state.store[TASK_REVIEWS_KEY] = clone(fallback[TASK_REVIEWS_KEY]);
        state.store[CLIENT_PROFILES_KEY] = clone(fallback[CLIENT_PROFILES_KEY]);
        state.initialized = false;
        applyPortalContractBindings();
        return {
          contractRegistry: readJson(CONTRACT_REGISTRY_KEY, []),
          contractStatus: readJson(CONTRACT_STATUS_KEY, {}),
          ratings: readJson(RATINGS_KEY, []),
          taskReviews: readJson(TASK_REVIEWS_KEY, []),
          clientProfiles: readJson(CLIENT_PROFILES_KEY, {}),
        };
      })
      .finally(() => {
        state.initPromise = null;
      });

    return state.initPromise;
  }

  function getContractsSource() {
    const stored = readJson(CONTRACT_REGISTRY_KEY, null);
    if (Array.isArray(stored) && stored.length) {
      return normalizeClientContracts(stored);
    }

    const base = getBaseContractsSource();
    if (base.length) saveContractsSource(base);
    return base;
  }

  function getContractStatusMap() {
    return readJson(CONTRACT_STATUS_KEY, {});
  }

  function getClientProfiles() {
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

  function getClientProfile(clientSlug) {
    const slug = String(clientSlug || "").trim();
    if (!slug) return blankClientProfile("", "");
    const client = getContractsSource().find((item) => item.slug === slug);
    const profiles = getClientProfiles();
    return normalizeClientProfile(slug, profiles[slug] || {}, client ? client.name : slug);
  }

  function getContractKey(contract) {
    return `${contract.clientSlug}::${contract.service}::${contract.employee}`;
  }

  function humanizeText(value) {
    return String(value || "")
      .toLocaleLowerCase("pt-BR")
      .replace(/\b\p{L}/gu, (char) => char.toLocaleUpperCase("pt-BR"));
  }

  function formatClientName(value) {
    return humanizeText(value);
  }

  function formatEmployeeName(value) {
    return humanizeText(value);
  }

  function formatServiceName(value) {
    return SERVICE_LABELS[value] || humanizeText(value);
  }

  function getContracts() {
    const statusMap = getContractStatusMap();
    return getContractsSource().map((client) => ({
      slug: client.slug,
      name: client.name,
      services: (client.services || []).map((service) => {
        const contract = {
          clientSlug: client.slug,
          clientName: client.name,
          service: service.service,
          employee: service.employee
        };
        return {
          ...contract,
          status: statusMap[getContractKey(contract)] || "active",
          startedAt: String(service.startedAt || "").trim(),
          endedAt: String(service.endedAt || "").trim(),
        };
      })
    }));
  }

  function getClientContract(clientSlug) {
    const slug = String(clientSlug || "").trim();
    return getContracts().find((client) => client.slug === slug) || null;
  }

  function getServiceCatalog() {
    const catalog = new Map();

    (Array.isArray(window.PortalContracts && window.PortalContracts.serviceCatalog)
      ? window.PortalContracts.serviceCatalog
      : []
    ).forEach((entry) => {
      const serviceName = normalizeServiceName(entry && entry.service);
      if (!serviceName) return;
      if (!catalog.has(serviceName)) {
        catalog.set(serviceName, new Set());
      }
      (Array.isArray(entry && entry.employees) ? entry.employees : []).forEach((employee) => {
        const employeeName = normalizeEntityName(employee);
        if (employeeName) catalog.get(serviceName).add(employeeName);
      });
    });

    getContractsSource().forEach((client) => {
      client.services.forEach((service) => {
        if (!catalog.has(service.service)) {
          catalog.set(service.service, new Set());
        }
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

  function getEmployeesForService(service) {
    const normalizedService = normalizeServiceName(service);
    const entry = getServiceCatalog().find((item) => item.service === normalizedService);
    return entry ? entry.employees : [];
  }

  function getKnownEmployees() {
    const employees = new Set(
      Array.isArray(window.PortalContracts && window.PortalContracts.employees)
        ? window.PortalContracts.employees.map((employee) => normalizeEntityName(employee)).filter(Boolean)
        : []
    );
    getContractsSource().forEach((client) => {
      client.services.forEach((service) => {
        employees.add(service.employee);
      });
    });
    return employees;
  }

  function resolveContractEmployee(clientSlug, service, employee) {
    const slug = String(clientSlug || "").trim();
    const serviceName = normalizeServiceName(service);
    const employeeName = normalizeEntityName(employee);
    const client = getContractsSource().find((item) => item.slug === slug);

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

  async function upsertContract(clientSlug, service, employee, options) {
    const slug = String(clientSlug || "").trim();
    const serviceName = normalizeServiceName(service);
    const employeeName = normalizeEntityName(employee);
    const requestedStatus = options && options.status === "canceled" ? "canceled" : "active";

    if (!slug) throw new Error("Cliente obrigatório.");
    if (!serviceName) throw new Error("Serviço obrigatório.");
    if (!employeeName) throw new Error("Prestador obrigatório.");

    const routeLabel = typeof window.PortalAuth !== "undefined" && window.PortalAuth.getClientRouteBySlug
      ? window.PortalAuth.getClientRouteBySlug(slug)?.label
      : "";

    const payload = await apiRequest("upsert_contract", {
      method: "POST",
      body: {
        clientSlug: slug,
        clientName: normalizeEntityName(options && options.clientName || routeLabel || slug),
        service: serviceName,
        employee: employeeName,
        status: requestedStatus,
        startedAt: options && options.startedAt || "",
      }
    });

    await init({ force: true, silent: true });
    applyPortalContractBindings();
    return payload.contract || {
      clientSlug: slug,
      service: serviceName,
      employee: employeeName,
      status: requestedStatus,
      startedAt: options && options.startedAt || "",
    };
  }

  async function removeContract(clientSlug, service, employee) {
    const slug = String(clientSlug || "").trim();
    const serviceName = normalizeServiceName(service);
    const employeeName = normalizeEntityName(employee);
    const payload = await apiRequest("remove_contract", {
      method: "POST",
      body: {
        clientSlug: slug,
        service: serviceName,
        employee: employeeName,
      }
    });

    await init({ force: true, silent: true });
    applyPortalContractBindings();
    return payload.removed === true;
  }

  async function setContractStatus(clientSlug, service, employee, status) {
    const nextStatus = status === "canceled" ? "canceled" : "active";
    await apiRequest("set_contract_status", {
      method: "POST",
      body: {
        clientSlug: String(clientSlug || "").trim(),
        service: normalizeServiceName(service),
        employee: normalizeEntityName(employee),
        status: nextStatus,
      }
    });

    await init({ force: true, silent: true });
    applyPortalContractBindings();
    return nextStatus;
  }

  async function toggleContractStatus(clientSlug, service, employee) {
    const contracts = getContracts();
    const client = contracts.find((item) => item.slug === clientSlug);
    const contract = client && client.services.find((item) => item.service === service && item.employee === employee);
    if (!contract) return "active";
    return setContractStatus(clientSlug, service, employee, contract.status === "active" ? "canceled" : "active");
  }

  function getRatings() {
    const stored = readJson(RATINGS_KEY, []);
    if (!Array.isArray(stored)) return [];

    let changed = false;
    const ratings = stored
      .map((rating) => {
        const clientSlug = String(rating.clientSlug || "").trim();
        const service = normalizeServiceName(rating.service || "");
        const employee = resolveContractEmployee(clientSlug, service, rating.employee || "");
        const next = {
          ...rating,
          clientSlug,
          service,
          employee
        };

        if (
          next.clientSlug !== rating.clientSlug ||
          next.service !== rating.service ||
          next.employee !== rating.employee
        ) {
          changed = true;
        }

        return next;
      })
      .filter((rating) => String(rating.taskId || "").trim());

    if (ratings.length !== stored.length) {
      changed = true;
    }

    if (changed) {
      writeJson(RATINGS_KEY, ratings);
    }

    return ratings;
  }

  function getTaskReviews() {
    const stored = readJson(TASK_REVIEWS_KEY, []);
    if (!Array.isArray(stored)) return [];

    let changed = false;
    const reviews = stored
      .map((review) => {
        const clientSlug = String(review.clientSlug || "").trim();
        const service = normalizeServiceName(review.service || "");
        const employee = resolveContractEmployee(clientSlug, service, review.employee || "");
        const next = {
          ...review,
          clientSlug,
          service,
          employee,
          status: review.status === "changes_requested" ? "changes_requested" : "approved",
          revisionKey: String(review.revisionKey || review.resolvedAt || "").trim()
        };

        if (
          next.clientSlug !== review.clientSlug ||
          next.service !== review.service ||
          next.employee !== review.employee ||
          next.revisionKey !== String(review.revisionKey || review.resolvedAt || "").trim()
        ) {
          changed = true;
        }

        return next;
      })
      .filter((review) => String(review.taskId || "").trim());

    if (reviews.length !== stored.length) {
      changed = true;
    }

    if (changed) {
      writeJson(TASK_REVIEWS_KEY, reviews);
    }

    return reviews;
  }

  function getTaskRevisionKey(taskOrRevisionKey) {
    if (taskOrRevisionKey && typeof taskOrRevisionKey === "object") {
      return String(taskOrRevisionKey.revisionKey || taskOrRevisionKey.resolvedAt || taskOrRevisionKey.createdAt || "").trim();
    }
    return String(taskOrRevisionKey || "").trim();
  }

  function getTaskReview(taskId, revisionKey) {
    const normalizedTaskId = String(taskId || "").trim();
    const normalizedRevisionKey = getTaskRevisionKey(revisionKey);
    return getTaskReviews().find((review) => (
      review.taskId === normalizedTaskId
      && (
        !normalizedRevisionKey
        || String(review.revisionKey || "").trim() === normalizedRevisionKey
      )
    )) || null;
  }

  function getRatingMeta(score) {
    const numeric = Number(score || 0);
    return SCORE_META.find((item) => numeric >= item.min && numeric <= item.max) || null;
  }

  function getTaskRating(taskId, revisionKey) {
    const normalizedTaskId = String(taskId || "").trim();
    const normalizedRevisionKey = getTaskRevisionKey(revisionKey);
    return getRatings().find((rating) => (
      rating.taskId === normalizedTaskId
      && (
        !normalizedRevisionKey
        || String(rating.resolvedAt || "").trim() === normalizedRevisionKey
      )
    )) || null;
  }

  async function saveRating(record) {
    const score = Number(record.score);
    if (!Number.isFinite(score) || score < 1 || score > 10) {
      throw new Error("Nota inválida.");
    }

    const clientSlug = String(record.clientSlug || "").trim();
    const service = normalizeServiceName(record.service || "");
    const employee = resolveContractEmployee(clientSlug, service, record.employee || "");
    const payload = await apiRequest("save_rating", {
      method: "POST",
      body: {
        taskId: String(record.taskId),
        taskName: String(record.taskName || ""),
        clientSlug,
        clientName: String(record.clientName || ""),
        service,
        employee,
        score,
        resolvedAt: record.resolvedAt || null,
        revisionKey: getTaskRevisionKey(record),
        url: record.url || "",
      }
    });

    const next = payload.rating || {
      taskId: String(record.taskId),
      taskName: String(record.taskName || ""),
      clientSlug,
      clientName: String(record.clientName || ""),
      service,
      employee,
      score,
      label: getRatingMeta(score)?.label || "",
      resolvedAt: record.resolvedAt || null,
      revisionKey: getTaskRevisionKey(record),
      url: record.url || "",
      submittedAt: new Date().toISOString()
    };

    const ratings = getRatings().filter((rating) => rating.taskId !== next.taskId);
    ratings.push(next);
    writeJson(RATINGS_KEY, ratings);

    const nextReview = {
      taskId: next.taskId,
      taskName: next.taskName,
      clientSlug,
      clientName: next.clientName,
      service,
      employee,
      status: "approved",
      notes: "",
      resolvedAt: next.resolvedAt || null,
      revisionKey: getTaskRevisionKey(next),
      url: next.url || "",
      submittedAt: next.submittedAt,
    };
    const reviews = getTaskReviews().filter((review) => (
      review.taskId !== nextReview.taskId
      || String(review.revisionKey || "").trim() !== String(nextReview.revisionKey || "").trim()
    ));
    reviews.push(nextReview);
    writeJson(TASK_REVIEWS_KEY, reviews);
    return next;
  }

  async function saveTaskReview(record) {
    const clientSlug = String(record.clientSlug || "").trim();
    if (!clientSlug) throw new Error("Cliente obrigatório.");

    const service = normalizeServiceName(record.service || "");
    const employee = resolveContractEmployee(clientSlug, service, record.employee || "");
    const revisionKey = getTaskRevisionKey(record);
    const response = await apiRequest("save_task_review", {
      method: "POST",
      body: {
        taskId: String(record.taskId || ""),
        taskName: String(record.taskName || ""),
        clientSlug,
        clientName: String(record.clientName || ""),
        service,
        employee,
        status: record.status === "changes_requested" ? "changes_requested" : "approved",
        notes: String(record.notes || "").trim(),
        resolvedAt: record.resolvedAt || null,
        revisionKey,
        url: record.url || "",
      }
    });

    const next = response.review || {
      taskId: String(record.taskId || ""),
      taskName: String(record.taskName || ""),
      clientSlug,
      clientName: String(record.clientName || ""),
      service,
      employee,
      status: record.status === "changes_requested" ? "changes_requested" : "approved",
      notes: String(record.notes || "").trim(),
      resolvedAt: record.resolvedAt || null,
      revisionKey,
      url: record.url || "",
      submittedAt: new Date().toISOString()
    };

    const reviews = getTaskReviews().filter((review) => (
      review.taskId !== next.taskId
      || String(review.revisionKey || "").trim() !== String(next.revisionKey || "").trim()
    ));
    reviews.push(next);
    writeJson(TASK_REVIEWS_KEY, reviews);
    return next;
  }

  async function saveClientProfile(clientSlug, payload) {
    const slug = String(clientSlug || "").trim();
    if (!slug) throw new Error("Cliente obrigatório.");

    const response = await apiRequest("save_client_profile", {
      method: "POST",
      body: {
        clientSlug: slug,
        ...payload,
      }
    });

    state.store[CLIENT_PROFILES_KEY] = {
      ...getClientProfiles(),
      [slug]: normalizeClientProfile(slug, response.profile || payload, response.profile?.name || payload.name || slug),
    };

    return state.store[CLIENT_PROFILES_KEY][slug];
  }

  function getClientSlugFromLocation() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    if (!parts.length) return "";
    const last = decodeURIComponent(parts[parts.length - 1]);
    if (last.toLowerCase() === "index.html") {
      return parts.length > 1 ? decodeURIComponent(parts[parts.length - 2]) : "";
    }
    return last.includes(".") ? "" : last;
  }

  function getClientContext() {
    const slug = getClientSlugFromLocation();
    const client = getContracts().find((item) => item.slug === slug);
    return {
      slug,
      name: client ? client.name : String(window.CLIENTE_NAME || ""),
      services: client ? client.services : []
    };
  }

  function buildTaskPayload(rawTask, context) {
    const service = normalizeServiceName(rawTask.tipo || rawTask.service || "");
    const employee = resolveContractEmployee(context && context.slug, service, rawTask.prestador || rawTask.employee || "");
    return {
      id: String(rawTask.id),
      name: String(rawTask.name || ""),
      status: String(rawTask.status || "").toLowerCase(),
      statusLabel: String(rawTask.statusLabel || rawTask.status || ""),
      service,
      employee,
      createdAt: rawTask.createdAt || null,
      resolvedAt: rawTask.resolvedAt || null,
      revisionKey: getTaskRevisionKey(rawTask),
      url: rawTask.url || ""
    };
  }

  function getTaskReviewState(task) {
    const review = getTaskReview(task.id, task.revisionKey);
    const rating = getTaskRating(task.id, task.revisionKey);

    if (task.status !== "resolvido") {
      return {
        review,
        rating,
        stage: task.status === "em resolução" ? "in_progress" : "open",
        progressIndex: task.status === "em resolução" ? 1 : 0,
        footerTone: "",
        footerTitle: "",
        footerCopy: "",
      };
    }

    if (rating) {
      return {
        review,
        rating,
        stage: "rated",
        progressIndex: 3,
        footerTone: "approved",
        footerTitle: "Entrega aprovada e avaliada",
        footerCopy: `Nota registrada: ${rating.score}/10.`,
      };
    }

    if (review && review.status === "approved") {
      return {
        review,
        rating,
        stage: "approved",
        progressIndex: 3,
        footerTone: "approved",
        footerTitle: "Entrega aprovada",
        footerCopy: "Falta apenas registrar a avaliação final dessa entrega.",
      };
    }

    if (review && review.status === "changes_requested") {
      return {
        review,
        rating,
        stage: "changes_requested",
        progressIndex: 2,
        footerTone: "warning",
        footerTitle: "Ajustes solicitados",
        footerCopy: review.notes || "A equipe foi avisada de que essa entrega precisa de ajustes.",
      };
    }

    return {
      review,
      rating,
      stage: "awaiting_review",
      progressIndex: 2,
      footerTone: "pending",
      footerTitle: "Aguardando sua revisão",
      footerCopy: "Confira a entrega antes de concluir com a avaliação.",
    };
  }

  function enqueueResolvedTasks(context, tasks) {
    const unresolved = tasks
      .map((task) => buildTaskPayload(task, context))
      .filter((task) => {
        const reviewState = getTaskReviewState(task);
        return task.status === "resolvido" && reviewState.stage === "approved" && !reviewState.rating;
      })
      .sort((a, b) => Number(b.resolvedAt || b.createdAt || 0) - Number(a.resolvedAt || a.createdAt || 0));

    state.context = context;
    state.pendingQueue = unresolved;
    if (!state.activeTaskId && unresolved.length) {
      openRatingModal(unresolved[0], context);
    }
  }

  function ensureModal() {
    if (state.modalReady) return;
    state.modalReady = true;

    const style = document.createElement("style");
    style.textContent = `
      .rating-modal {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(15, 23, 42, 0.55);
        backdrop-filter: blur(8px);
        z-index: 2200;
      }
      .rating-modal.show { display: flex; }
      .rating-card {
        width: min(720px, 100%);
        background: #ffffff;
        color: #0f172a;
        border-radius: 28px;
        border: 1px solid rgba(15, 23, 42, 0.08);
        box-shadow: 0 28px 80px rgba(0,0,0,0.22);
        overflow: hidden;
      }
      .rating-head {
        padding: 26px 28px 18px;
        border-bottom: 1px solid #eef2f7;
      }
      .rating-kicker {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        background: #ffffff;
        color: #F29725;
        border: 1px solid rgba(242, 151, 37, 0.28);
        font-size: 0.74rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .rating-title {
        margin: 14px 0 0;
        font-size: 1.7rem;
        letter-spacing: -0.06em;
      }
      .rating-copy {
        margin: 10px 0 0;
        color: #64748b;
        font-size: 0.95rem;
        line-height: 1.7;
      }
      .rating-task {
        margin-top: 16px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .rating-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 9px 12px;
        border-radius: 999px;
        background: #f8fafc;
        color: #475569;
        font-size: 0.78rem;
        font-weight: 700;
      }
      .rating-body {
        padding: 24px 28px 28px;
      }
      .rating-scale {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 10px;
      }
      .rating-band {
        padding: 14px 12px;
        border-radius: 18px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
      }
      .rating-band strong {
        display: block;
        font-size: 0.9rem;
        color: #0f172a;
      }
      .rating-band span {
        display: block;
        margin-top: 6px;
        font-size: 0.78rem;
        line-height: 1.55;
        color: #64748b;
      }
      .rating-grid {
        display: grid;
        grid-template-columns: repeat(10, minmax(0, 1fr));
        gap: 10px;
        margin-top: 18px;
      }
      .rating-score {
        border: 1px solid #e2e8f0;
        border-radius: 18px;
        background: #ffffff;
        color: #334155;
        font: inherit;
        font-size: 1rem;
        font-weight: 800;
        min-height: 64px;
        cursor: pointer;
        transition: transform 0.16s, border-color 0.2s, box-shadow 0.2s, background 0.2s, color 0.2s;
      }
      .rating-score:hover {
        transform: translateY(-1px);
        border-color: #F29725;
        background: #ffffff;
      }
      .rating-score.active {
        border-color: #F29725;
        background: linear-gradient(135deg, #F29725 0%, #F29725 100%);
        color: #fff;
        box-shadow: 0 16px 24px rgba(242, 151, 37, 0.22);
      }
      .rating-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 20px;
        flex-wrap: wrap;
      }
      .rating-caption {
        color: #64748b;
        font-size: 0.88rem;
        line-height: 1.7;
      }
      .rating-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .rating-actions button {
        border: none;
        border-radius: 16px;
        padding: 13px 16px;
        font: inherit;
        font-size: 0.9rem;
        font-weight: 800;
        cursor: pointer;
      }
      .rating-later {
        background: #f8fafc;
        color: #475569;
      }
      .rating-submit {
        color: #fff;
        background: linear-gradient(135deg, #F29725 0%, #F29725 100%);
        box-shadow: 0 16px 24px rgba(242, 151, 37, 0.22);
      }
      .rating-submit:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        box-shadow: none;
      }
      @media (max-width: 760px) {
        .rating-card { border-radius: 24px; }
        .rating-head, .rating-body { padding-inline: 18px; }
        .rating-scale { grid-template-columns: 1fr; }
        .rating-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
      }
    `;

    const modal = document.createElement("div");
    modal.className = "rating-modal";
    modal.id = "serviceRatingModal";
    modal.innerHTML = `
      <div class="rating-card">
        <div class="rating-head">
          <div class="rating-kicker">Avalie esse serviço</div>
          <h3 class="rating-title">Sua tarefa foi concluída.</h3>
          <p class="rating-copy">Escolha uma nota de 1 a 10. Essa avaliação entra no ambiente interno do admin para medir satisfação geral, por área, por cliente e por funcionário.</p>
          <div class="rating-task" id="serviceRatingTask"></div>
        </div>
        <div class="rating-body">
          <div class="rating-scale">
            ${SCORE_META.map((item) => `
              <div class="rating-band">
                <strong>${item.min}-${item.max} ${item.label}</strong>
                <span>${item.label === "Péssimo" ? "Entrega muito abaixo do esperado." : item.label === "Ruim" ? "Resultado abaixo do ideal." : item.label === "Razoável" ? "Cumpriu o básico." : item.label === "Bom" ? "Entrega consistente e positiva." : "Entrega de alto nível."}</span>
              </div>
            `).join("")}
          </div>
          <div class="rating-grid" id="serviceRatingGrid">
            ${Array.from({ length: 10 }, (_, index) => `<button type="button" class="rating-score" data-score="${index + 1}">${index + 1}</button>`).join("")}
          </div>
          <div class="rating-footer">
            <div class="rating-caption" id="serviceRatingCaption">Selecione uma nota para continuar.</div>
            <div class="rating-actions">
              <button type="button" class="rating-later" id="serviceRatingLater">Agora não</button>
              <button type="button" class="rating-submit" id="serviceRatingSubmit" disabled>Enviar avaliação</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.head.appendChild(style);
    document.body.appendChild(modal);

    let selectedScore = null;

    function paintSelection() {
      modal.querySelectorAll(".rating-score").forEach((button) => {
        button.classList.toggle("active", Number(button.dataset.score) === selectedScore);
      });
      const meta = getRatingMeta(selectedScore);
      modal.querySelector("#serviceRatingSubmit").disabled = !selectedScore;
      modal.querySelector("#serviceRatingCaption").textContent = meta
        ? `Nota ${selectedScore} • ${meta.label}`
        : "Selecione uma nota para continuar.";
    }

    modal.querySelectorAll(".rating-score").forEach((button) => {
      button.addEventListener("click", () => {
        selectedScore = Number(button.dataset.score);
        paintSelection();
      });
    });

    modal.querySelector("#serviceRatingLater").addEventListener("click", () => {
      modal.classList.remove("show");
      state.activeTaskId = null;
      selectedScore = null;
      paintSelection();
    });

    modal.querySelector("#serviceRatingSubmit").addEventListener("click", async () => {
      if (!selectedScore || !state.activeTaskId || !state.context) return;
      const task = state.pendingQueue.find((item) => item.id === state.activeTaskId);
      if (!task) return;

      const submitButton = modal.querySelector("#serviceRatingSubmit");
      submitButton.disabled = true;

      try {
        await saveRating({
          taskId: task.id,
          taskName: task.name,
          clientSlug: state.context.slug,
          clientName: state.context.name,
          service: task.service,
          employee: task.employee,
          score: selectedScore,
          resolvedAt: task.resolvedAt,
          url: task.url
        });

        if (typeof window.showToast === "function") {
          window.showToast(`✅ Avaliação enviada: nota ${selectedScore}.`);
        }

        state.pendingQueue = state.pendingQueue.filter((item) => item.id !== task.id);
        state.activeTaskId = null;
        selectedScore = null;
        paintSelection();
        modal.classList.remove("show");

        if (state.pendingQueue.length) {
          openRatingModal(state.pendingQueue[0], state.context);
        }
      } catch (error) {
        if (typeof window.showToast === "function") {
          window.showToast(error.message || "❌ Não foi possível enviar a avaliação.", true);
        }
      } finally {
        submitButton.disabled = !selectedScore;
      }
    });
  }

  function openRatingModal(task, context) {
    ensureModal();
    state.activeTaskId = task.id;
    state.context = context;
    const modal = document.getElementById("serviceRatingModal");
    const chips = [
      `<span class="rating-chip">${formatClientName(context.name)}</span>`,
      task.service ? `<span class="rating-chip">${formatServiceName(task.service)}</span>` : "",
      task.employee ? `<span class="rating-chip">${formatEmployeeName(task.employee)}</span>` : "",
      task.name ? `<span class="rating-chip">${escapeHtml(task.name)}</span>` : ""
    ].filter(Boolean).join("");
    modal.querySelector("#serviceRatingTask").innerHTML = chips;
    modal.classList.add("show");
  }

  async function postPortalTaskComment(taskId, message) {
    const response = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/comment`, {
      method: "POST",
      headers: {
        Authorization: typeof CU_API_KEY !== "undefined" ? CU_API_KEY : "",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        comment_text: `${typeof CLIENT_COMMENT_PREFIX !== "undefined" ? CLIENT_COMMENT_PREFIX : ""}${String(message || "").trim()}`,
      })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload && payload.err ? payload.err : `Erro ${response.status} ao enviar comentário.`);
    }

    return payload;
  }

  async function refreshPortalTaskList() {
    if (typeof loadChamados !== "function") return;
    await loadChamados({ silent: true });
  }

  function ensureReviewModal() {
    if (state.reviewModalReady) return;
    state.reviewModalReady = true;

    const style = document.createElement("style");
    style.textContent = `
      .gp-review-modal {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(15, 23, 42, 0.55);
        backdrop-filter: blur(8px);
        z-index: 2250;
      }
      .gp-review-modal.show { display: flex; }
      .gp-review-card {
        width: min(680px, 100%);
        background: #ffffff;
        color: #0f172a;
        border-radius: 28px;
        border: 1px solid rgba(15, 23, 42, 0.08);
        box-shadow: 0 28px 80px rgba(0,0,0,0.22);
        overflow: hidden;
      }
      .gp-review-head {
        padding: 26px 28px 18px;
        border-bottom: 1px solid #eef2f7;
      }
      .gp-review-kicker {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        background: #fff7ed;
        color: #c2410c;
        border: 1px solid rgba(242, 151, 37, 0.28);
        font-size: 0.74rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .gp-review-title {
        margin: 14px 0 0;
        font-size: 1.7rem;
        letter-spacing: -0.06em;
      }
      .gp-review-copy {
        margin: 10px 0 0;
        color: #64748b;
        font-size: 0.95rem;
        line-height: 1.7;
      }
      .gp-review-body {
        padding: 24px 28px 28px;
        display: grid;
        gap: 16px;
      }
      .gp-review-task {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .gp-review-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 9px 12px;
        border-radius: 999px;
        background: #f8fafc;
        color: #475569;
        font-size: 0.78rem;
        font-weight: 700;
      }
      .gp-review-textarea {
        width: 100%;
        min-height: 118px;
        border: 1px solid #e2e8f0;
        border-radius: 18px;
        padding: 14px 16px;
        font: inherit;
        font-size: 0.94rem;
        line-height: 1.65;
        resize: vertical;
        color: #0f172a;
        background: #f8fafc;
      }
      .gp-review-textarea:focus {
        outline: none;
        border-color: #F29725;
        box-shadow: 0 0 0 4px rgba(242, 151, 37, 0.12);
        background: #ffffff;
      }
      .gp-review-actions {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        align-items: center;
      }
      .gp-review-actions small {
        color: #64748b;
        line-height: 1.6;
      }
      .gp-review-buttons {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .gp-review-buttons button {
        border: none;
        border-radius: 16px;
        padding: 13px 16px;
        font: inherit;
        font-size: 0.9rem;
        font-weight: 800;
        cursor: pointer;
      }
      .gp-review-later {
        background: #f8fafc;
        color: #475569;
      }
      .gp-review-request {
        background: #fff7ed;
        color: #c2410c;
      }
      .gp-review-approve {
        color: #fff;
        background: linear-gradient(135deg, #F29725 0%, #F29725 100%);
        box-shadow: 0 16px 24px rgba(242, 151, 37, 0.22);
      }
      @media (max-width: 760px) {
        .gp-review-head, .gp-review-body { padding-inline: 18px; }
      }
    `;

    const modal = document.createElement("div");
    modal.className = "gp-review-modal";
    modal.id = "gpTaskReviewModal";
    modal.innerHTML = `
      <div class="gp-review-card">
        <div class="gp-review-head">
          <div class="gp-review-kicker">Revisão do solicitante</div>
          <h3 class="gp-review-title">Essa entrega precisa da sua confirmação.</h3>
          <p class="gp-review-copy">Antes da avaliação final, confirme se a equipe pode encerrar esse chamado ou se ainda faltam ajustes.</p>
        </div>
        <div class="gp-review-body">
          <div class="gp-review-task" id="gpTaskReviewChips"></div>
          <textarea class="gp-review-textarea" id="gpTaskReviewNotes" placeholder="Se precisar de ajuste, descreva aqui o que deve ser revisto."></textarea>
          <div class="gp-review-actions">
            <small>Quando você pedir ajustes, a equipe recebe seu retorno dentro do chamado no ClickUp.</small>
            <div class="gp-review-buttons">
              <button type="button" class="gp-review-later" id="gpTaskReviewLater">Agora não</button>
              <button type="button" class="gp-review-request" id="gpTaskReviewRequest">Pedir ajuste</button>
              <button type="button" class="gp-review-approve" id="gpTaskReviewApprove">Aprovar e avaliar</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.head.appendChild(style);
    document.body.appendChild(modal);

    modal.querySelector("#gpTaskReviewLater").addEventListener("click", () => {
      modal.classList.remove("show");
      state.activeReviewTaskId = null;
      state.reviewTask = null;
    });

    modal.querySelector("#gpTaskReviewApprove").addEventListener("click", async () => {
      const task = state.reviewTask;
      if (!task || !state.context) return;

      const approveButton = modal.querySelector("#gpTaskReviewApprove");
      const requestButton = modal.querySelector("#gpTaskReviewRequest");
      approveButton.disabled = true;
      requestButton.disabled = true;

      try {
        await saveTaskReview({
          taskId: task.id,
          taskName: task.name,
          clientSlug: state.context.slug,
          clientName: state.context.name,
          service: task.service,
          employee: task.employee,
          status: "approved",
          notes: "",
          resolvedAt: task.resolvedAt,
          revisionKey: task.revisionKey,
          url: task.url
        });
        await postPortalTaskComment(task.id, "Entrega revisada e aprovada pelo solicitante.");
        modal.classList.remove("show");
        state.activeReviewTaskId = null;
        state.reviewTask = null;
        if (typeof window.showToast === "function") {
          window.showToast("✅ Entrega aprovada. Agora falta só a avaliação.");
        }
        await refreshPortalTaskList();
        openRatingModal(task, state.context);
      } catch (error) {
        if (typeof window.showToast === "function") {
          window.showToast(error.message || "❌ Não foi possível aprovar essa entrega.", true);
        }
      } finally {
        approveButton.disabled = false;
        requestButton.disabled = false;
      }
    });

    modal.querySelector("#gpTaskReviewRequest").addEventListener("click", async () => {
      const task = state.reviewTask;
      if (!task || !state.context) return;

      const notes = String(modal.querySelector("#gpTaskReviewNotes").value || "").trim();
      if (!notes) {
        modal.querySelector("#gpTaskReviewNotes").focus();
        if (typeof window.showToast === "function") {
          window.showToast("⚠️ Descreva o ajuste solicitado antes de enviar.", true);
        }
        return;
      }

      const approveButton = modal.querySelector("#gpTaskReviewApprove");
      const requestButton = modal.querySelector("#gpTaskReviewRequest");
      approveButton.disabled = true;
      requestButton.disabled = true;

      try {
        await saveTaskReview({
          taskId: task.id,
          taskName: task.name,
          clientSlug: state.context.slug,
          clientName: state.context.name,
          service: task.service,
          employee: task.employee,
          status: "changes_requested",
          notes,
          resolvedAt: task.resolvedAt,
          revisionKey: task.revisionKey,
          url: task.url
        });
        await postPortalTaskComment(task.id, `Solicitei ajustes nessa entrega.\n\n${notes}`);
        modal.classList.remove("show");
        state.activeReviewTaskId = null;
        state.reviewTask = null;
        if (typeof window.showToast === "function") {
          window.showToast("✅ Ajustes solicitados para a equipe.");
        }
        await refreshPortalTaskList();
      } catch (error) {
        if (typeof window.showToast === "function") {
          window.showToast(error.message || "❌ Não foi possível registrar o pedido de ajuste.", true);
        }
      } finally {
        approveButton.disabled = false;
        requestButton.disabled = false;
      }
    });
  }

  function openReviewModal(task, context) {
    ensureReviewModal();
    state.activeReviewTaskId = task.id;
    state.reviewTask = task;
    state.context = context;
    const modal = document.getElementById("gpTaskReviewModal");
    modal.querySelector("#gpTaskReviewNotes").value = "";
    modal.querySelector("#gpTaskReviewChips").innerHTML = [
      `<span class="gp-review-chip">${formatClientName(context.name)}</span>`,
      task.service ? `<span class="gp-review-chip">${formatServiceName(task.service)}</span>` : "",
      task.employee ? `<span class="gp-review-chip">${formatEmployeeName(task.employee)}</span>` : "",
      task.name ? `<span class="gp-review-chip">${escapeHtml(task.name)}</span>` : ""
    ].filter(Boolean).join("");
    modal.classList.add("show");
  }

  function handleTasksLoadedInternal(payload) {
    const context = getClientContext();
    if (!payload || !Array.isArray(payload.tasks)) return;
    enhanceTaskCards(payload.tasks, context);
    installChatMentionUI(context);
    enqueueResolvedTasks(
      {
        slug: context.slug,
        name: payload.clientName || context.name
      },
      payload.tasks
    );
  }

  function getTaskAreaKey(task) {
    return normalizeServiceName(task.tipo || task.service || "");
  }

  function getTaskAreaLabel(task) {
    const areaKey = getTaskAreaKey(task);
    return areaKey ? formatServiceName(areaKey) : "Área não informada";
  }

  function buildTaskProgressMarkup(reviewState) {
    const steps = [
      "Solicitado",
      "Em andamento",
      "Sua revisão",
      "Finalizado"
    ];

    return `
      <div class="progress-track gp-progress-track">
        ${steps.map((label, index) => `
          <div class="progress-step ${index <= reviewState.progressIndex ? "active" : ""}">
            <span class="progress-dot"></span>
            <span class="progress-label">${escapeHtml(label)}</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  function getTaskCardById(taskId) {
    const taskButton = Array.from(document.querySelectorAll(".btn-chat[data-task-id]"))
      .find((button) => button.dataset.taskId === String(taskId));
    return taskButton ? taskButton.closest(".chamado-item") : null;
  }

  function ensureAreaFilters(tasks) {
    const statusFilters = document.getElementById("statusFilters");
    if (!statusFilters || !statusFilters.parentElement) return null;

    let wrapper = document.getElementById("gpAreaFilters");
    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.id = "gpAreaFilters";
      wrapper.className = "gp-area-filters";
      statusFilters.insertAdjacentElement("afterend", wrapper);
    }

    const uniqueAreas = Array.from(new Map(
      tasks
        .map((task) => [getTaskAreaKey(task), getTaskAreaLabel(task)])
        .filter(([key]) => key)
    ).entries()).sort((left, right) => left[1].localeCompare(right[1], "pt-BR"));

    if (state.currentAreaFilter !== "all" && !uniqueAreas.some(([key]) => key === state.currentAreaFilter)) {
      state.currentAreaFilter = "all";
    }

    wrapper.innerHTML = `
      <span class="gp-filter-caption">Área</span>
      <button type="button" class="status-filter gp-area-filter ${state.currentAreaFilter === "all" ? "active" : ""}" data-area-filter="all">Todas</button>
      ${uniqueAreas.map(([key, label]) => `
        <button
          type="button"
          class="status-filter gp-area-filter ${state.currentAreaFilter === key ? "active" : ""}"
          data-area-filter="${escapeHtml(key)}"
        >
          ${escapeHtml(label)}
        </button>
      `).join("")}
    `;

    wrapper.querySelectorAll("[data-area-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.currentAreaFilter = button.dataset.areaFilter || "all";
        wrapper.querySelectorAll("[data-area-filter]").forEach((item) => {
          item.classList.toggle("active", item === button);
        });
        applyTaskAreaFilter(tasks);
      });
    });

    return wrapper;
  }

  function applyTaskAreaFilter(tasks) {
    const list = document.getElementById("chamadosList");
    const count = document.getElementById("chamadosCount");
    if (!list || !count) return;

    const cards = Array.from(list.querySelectorAll(".chamado-item"));
    let visibleCount = 0;
    cards.forEach((card) => {
      const areaKey = card.dataset.areaKey || "";
      const visible = state.currentAreaFilter === "all" || areaKey === state.currentAreaFilter;
      card.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    const baseLabel = count.dataset.statusCount || count.textContent || "—";
    if (state.currentAreaFilter === "all") {
      count.textContent = baseLabel;
    } else {
      count.textContent = `${visibleCount} de ${tasks.length} chamado${tasks.length !== 1 ? "s" : ""}`;
    }

    let empty = document.getElementById("gpAreaEmpty");
    if (!empty) {
      empty = document.createElement("div");
      empty.id = "gpAreaEmpty";
      empty.className = "chamados-empty";
      empty.hidden = true;
      empty.innerHTML = `<div class="empty-icon">🎯</div>Nenhum chamado encontrado nessa área.`;
      list.appendChild(empty);
    }

    empty.hidden = visibleCount > 0;
  }

  function decorateTaskCard(rawTask, context) {
    const task = buildTaskPayload(rawTask, context);
    const reviewState = getTaskReviewState(task);
    const card = getTaskCardById(task.id);
    if (!card) return;

    const areaKey = getTaskAreaKey(rawTask);
    const areaLabel = getTaskAreaLabel(rawTask);
    card.dataset.areaKey = areaKey;

    const meta = card.querySelector(".chamado-meta");
    if (meta) {
      let areaTag = meta.querySelector(".gp-area-tag");
      if (!areaTag) {
        areaTag = Array.from(meta.querySelectorAll(".chamado-tag")).find((tag) => (
          !tag.classList.contains("priority-urgent")
          && !tag.classList.contains("priority-normal")
        ));
      }

      if (!areaTag) {
        areaTag = document.createElement("span");
        areaTag.className = "chamado-tag gp-area-tag";
        meta.insertAdjacentElement("afterbegin", areaTag);
      } else {
        areaTag.classList.add("gp-area-tag");
      }

      areaTag.textContent = areaLabel;
    }

    const progress = card.querySelector(".progress-track");
    if (progress) {
      progress.outerHTML = buildTaskProgressMarkup(reviewState);
    }

    let footer = card.querySelector(".gp-task-review-box");
    if (!footer) {
      footer = document.createElement("div");
      footer.className = "gp-task-review-box";
      card.appendChild(footer);
    }

    if (task.status !== "resolvido") {
      footer.hidden = true;
      footer.innerHTML = "";
      return;
    }

    footer.hidden = false;
    footer.className = `gp-task-review-box ${reviewState.footerTone || ""}`;

    const actions = [];
    if (reviewState.stage === "awaiting_review") {
      actions.push(`<button type="button" class="gp-task-review-button primary" data-review-task="${escapeHtml(task.id)}">Revisar entrega</button>`);
    }
    if (reviewState.stage === "changes_requested") {
      actions.push(`<button type="button" class="gp-task-review-button" data-review-task="${escapeHtml(task.id)}">Atualizar revisão</button>`);
    }
    if (reviewState.stage === "approved") {
      actions.push(`<button type="button" class="gp-task-review-button primary" data-rate-task="${escapeHtml(task.id)}">Avaliar agora</button>`);
    }
    actions.push(`<button type="button" class="gp-task-review-button" data-open-chat-task="${escapeHtml(task.id)}">Abrir mensagens</button>`);

    footer.innerHTML = `
      <div class="gp-task-review-copy">
        <strong>${escapeHtml(reviewState.footerTitle)}</strong>
        <span>${escapeHtml(reviewState.footerCopy)}</span>
      </div>
      <div class="gp-task-review-actions">${actions.join("")}</div>
    `;

    footer.querySelectorAll("[data-review-task]").forEach((button) => {
      button.addEventListener("click", () => openReviewModal(task, context));
    });
    footer.querySelectorAll("[data-rate-task]").forEach((button) => {
      button.addEventListener("click", () => openRatingModal(task, context));
    });
    footer.querySelectorAll("[data-open-chat-task]").forEach((button) => {
      button.addEventListener("click", () => {
        const chatButton = card.querySelector(".btn-chat");
        if (chatButton) chatButton.click();
      });
    });
  }

  function enhanceTaskCards(tasks, context) {
    const count = document.getElementById("chamadosCount");
    if (count) {
      count.dataset.statusCount = count.textContent || "—";
    }

    const areaFilters = ensureAreaFilters(tasks);
    if (areaFilters) areaFilters.hidden = tasks.length === 0;
    if (!tasks.length) {
      const empty = document.getElementById("gpAreaEmpty");
      if (empty) empty.remove();
      return;
    }

    tasks.forEach((task) => decorateTaskCard(task, context));
    applyTaskAreaFilter(tasks);
  }

  function normalizeSearchKey(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .trim();
  }

  function getMentionCandidates(context) {
    const client = context && context.slug ? getClientContract(context.slug) : null;
    const activeEmployees = client
      ? client.services.filter((service) => service.status !== "canceled").map((service) => service.employee)
      : [];
    const pool = activeEmployees.length ? activeEmployees : Array.from(getKnownEmployees());
    return uniqueValues(pool)
      .map((employee) => ({
        value: employee,
        label: formatEmployeeName(employee),
        search: normalizeSearchKey(employee)
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));
  }

  function installChatMentionUI(context) {
    const form = document.getElementById("chatForm");
    const input = document.getElementById("chatInput");
    if (!form || !input) return;

    if (!state.chatMention) {
      state.chatMention = {
        candidates: [],
        activeIndex: 0,
        matchStart: -1,
      };
    }

    state.chatMention.candidates = getMentionCandidates(context);

    let box = document.getElementById("gpChatMentionBox");
    if (!box) {
      box = document.createElement("div");
      box.id = "gpChatMentionBox";
      box.className = "gp-chat-mentions";
      box.hidden = true;
      form.appendChild(box);
    }

    if (state.chatMentionReady) return;
    state.chatMentionReady = true;
    form.classList.add("gp-chat-form");

    const closeMentionBox = () => {
      box.hidden = true;
      box.innerHTML = "";
      state.chatMention.activeIndex = 0;
      state.chatMention.matchStart = -1;
    };

    const findMentionMatch = () => {
      const caret = input.selectionStart || 0;
      const before = input.value.slice(0, caret);
      const match = before.match(/(?:^|\s)@([^\n]*)$/);
      if (!match) return null;
      const rawQuery = match[1] || "";
      const start = caret - rawQuery.length - 1;
      return {
        start,
        query: normalizeSearchKey(rawQuery)
      };
    };

    const applyMentionSelection = (candidate) => {
      const match = findMentionMatch();
      if (!match) return;
      const caret = input.selectionStart || 0;
      input.value = `${input.value.slice(0, match.start)}@${candidate.label} ${input.value.slice(caret)}`;
      const nextCaret = match.start + candidate.label.length + 2;
      input.selectionStart = nextCaret;
      input.selectionEnd = nextCaret;
      input.focus();
      closeMentionBox();
    };

    const renderMentionSuggestions = () => {
      const match = findMentionMatch();
      if (!match) {
        closeMentionBox();
        return;
      }

      const candidates = state.chatMention.candidates
        .filter((candidate) => !match.query || candidate.search.includes(match.query))
        .slice(0, 6);

      if (!candidates.length) {
        closeMentionBox();
        return;
      }

      state.chatMention.matchStart = match.start;
      state.chatMention.activeIndex = Math.min(state.chatMention.activeIndex, candidates.length - 1);
      box.hidden = false;
      box.innerHTML = candidates.map((candidate, index) => `
        <button type="button" class="gp-chat-mention-option ${index === state.chatMention.activeIndex ? "active" : ""}" data-mention-index="${index}">
          <strong>@${escapeHtml(candidate.label)}</strong>
          <span>Mencionar no ClickUp</span>
        </button>
      `).join("");

      box.querySelectorAll("[data-mention-index]").forEach((button) => {
        button.addEventListener("mousedown", (event) => {
          event.preventDefault();
          applyMentionSelection(candidates[Number(button.dataset.mentionIndex)]);
        });
      });
    };

    input.addEventListener("input", renderMentionSuggestions);
    input.addEventListener("click", renderMentionSuggestions);
    input.addEventListener("keydown", (event) => {
      if (box.hidden) return;

      const options = Array.from(box.querySelectorAll("[data-mention-index]"));
      if (!options.length) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        state.chatMention.activeIndex = (state.chatMention.activeIndex + 1) % options.length;
        renderMentionSuggestions();
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        state.chatMention.activeIndex = (state.chatMention.activeIndex - 1 + options.length) % options.length;
        renderMentionSuggestions();
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const candidates = state.chatMention.candidates
          .filter((candidate) => {
            const match = findMentionMatch();
            return !match || !match.query || candidate.search.includes(match.query);
          })
          .slice(0, 6);
        if (candidates[state.chatMention.activeIndex]) {
          applyMentionSelection(candidates[state.chatMention.activeIndex]);
        }
        return;
      }

      if (event.key === "Escape") {
        closeMentionBox();
      }
    });

    document.addEventListener("click", (event) => {
      if (!form.contains(event.target)) {
        closeMentionBox();
      }
    });
  }

  function average(values) {
    const nums = values.filter((value) => Number.isFinite(value));
    if (!nums.length) return null;
    return nums.reduce((sum, value) => sum + value, 0) / nums.length;
  }

  function roundOne(value) {
    return value == null ? null : Math.round(value * 10) / 10;
  }

  function getDashboardSnapshot() {
    const contracts = getContracts();
    const ratings = getRatings();
    const taskReviews = getTaskReviews();
    const profiles = getClientProfiles();
    const activeContracts = [];
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
        serviceMap.set(key, {
          service: key,
          activeCount: 0,
          canceledCount: 0,
          clients: new Set()
        });
      }
      const item = serviceMap.get(key);
      if (contract.status === "canceled") item.canceledCount += 1;
      else item.activeCount += 1;
      item.clients.add(contract.clientSlug);
    });

    const employeeMap = new Map();
    window.PortalContracts && Array.isArray(window.PortalContracts.employees) && window.PortalContracts.employees.forEach((employee) => {
      employeeMap.set(employee, {
        employee,
        activeDiamonds: new Set(),
        canceledServices: 0,
        ratings: []
      });
    });

    contracts.forEach((client) => {
      client.services.forEach((service) => {
        if (!employeeMap.has(service.employee)) {
          employeeMap.set(service.employee, {
            employee: service.employee,
            activeDiamonds: new Set(),
            canceledServices: 0,
            ratings: []
          });
        }
        const employee = employeeMap.get(service.employee);
        if (service.status === "canceled") employee.canceledServices += 1;
        else employee.activeDiamonds.add(client.slug);
      });
    });

    const knownEmployees = getKnownEmployees();

    ratings.forEach((rating) => {
      const employeeName = resolveContractEmployee(rating.clientSlug, rating.service, rating.employee);
      if (!employeeName || !knownEmployees.has(employeeName)) return;
      if (!employeeMap.has(employeeName)) {
        employeeMap.set(employeeName, {
          employee: employeeName,
          activeDiamonds: new Set(),
          canceledServices: 0,
          ratings: []
        });
      }
      employeeMap.get(employeeName).ratings.push(rating.score);
    });

    const satisfactionByService = new Map();
    const satisfactionByClient = new Map();
    const reviewByService = new Map();
    const reviewByClient = new Map();
    const reviewByEmployee = new Map();

    ratings.forEach((rating) => {
      if (rating.service) {
        if (!satisfactionByService.has(rating.service)) satisfactionByService.set(rating.service, []);
        satisfactionByService.get(rating.service).push(rating.score);
      }
      if (rating.clientSlug) {
        if (!satisfactionByClient.has(rating.clientSlug)) {
          satisfactionByClient.set(rating.clientSlug, {
            clientSlug: rating.clientSlug,
            clientName: rating.clientName,
            scores: []
          });
        }
        satisfactionByClient.get(rating.clientSlug).scores.push(rating.score);
      }
    });

    taskReviews.forEach((review) => {
      if (review.service) {
        if (!reviewByService.has(review.service)) {
          reviewByService.set(review.service, { total: 0, approved: 0, changesRequested: 0 });
        }
        const entry = reviewByService.get(review.service);
        entry.total += 1;
        if (review.status === "changes_requested") entry.changesRequested += 1;
        else entry.approved += 1;
      }

      if (review.clientSlug) {
        if (!reviewByClient.has(review.clientSlug)) {
          reviewByClient.set(review.clientSlug, { total: 0, approved: 0, changesRequested: 0 });
        }
        const entry = reviewByClient.get(review.clientSlug);
        entry.total += 1;
        if (review.status === "changes_requested") entry.changesRequested += 1;
        else entry.approved += 1;
      }

      if (review.employee) {
        if (!reviewByEmployee.has(review.employee)) {
          reviewByEmployee.set(review.employee, { total: 0, approved: 0, changesRequested: 0 });
        }
        const entry = reviewByEmployee.get(review.employee);
        entry.total += 1;
        if (review.status === "changes_requested") entry.changesRequested += 1;
        else entry.approved += 1;
      }
    });

    const serviceSummary = Array.from(serviceMap.values())
      .map((item) => ({
        service: item.service,
        activeCount: item.activeCount,
        canceledCount: item.canceledCount,
        clientCount: item.clients.size,
        averageRating: roundOne(average((satisfactionByService.get(item.service) || []).map(Number))),
        totalReviews: reviewByService.get(item.service)?.total || 0,
        approvedReviews: reviewByService.get(item.service)?.approved || 0,
        changesRequested: reviewByService.get(item.service)?.changesRequested || 0,
      }))
      .sort((a, b) => (b.activeCount + b.canceledCount) - (a.activeCount + a.canceledCount) || a.service.localeCompare(b.service, "pt-BR"));

    const employeeSummary = Array.from(employeeMap.values())
      .map((item) => ({
        employee: item.employee,
        activeDiamonds: item.activeDiamonds.size,
        canceledServices: item.canceledServices,
        averageRating: roundOne(average(item.ratings.map(Number))),
        totalRatings: item.ratings.length,
        totalReviews: reviewByEmployee.get(item.employee)?.total || 0,
        approvedReviews: reviewByEmployee.get(item.employee)?.approved || 0,
        changesRequested: reviewByEmployee.get(item.employee)?.changesRequested || 0,
      }))
      .sort((a, b) => b.activeDiamonds - a.activeDiamonds || a.employee.localeCompare(b.employee, "pt-BR"));

    const clientSummary = contracts
      .map((client) => {
        const ratingInfo = satisfactionByClient.get(client.slug);
        const scores = ratingInfo ? ratingInfo.scores : [];
        const profile = profiles[client.slug] || blankClientProfile(client.slug, client.name);
        const lastProfileUpdate = profile.updatedAt ? new Date(profile.updatedAt) : null;
        const monthlyProfilePending = !lastProfileUpdate || Number.isNaN(lastProfileUpdate.getTime())
          ? true
          : (Date.now() - lastProfileUpdate.getTime()) > (1000 * 60 * 60 * 24 * 30);
        return {
          slug: client.slug,
          name: client.name,
          activeServices: client.services.filter((service) => service.status !== "canceled").length,
          canceledServices: client.services.filter((service) => service.status === "canceled").length,
          averageRating: roundOne(average(scores)),
          totalRatings: scores.length,
          totalReviews: reviewByClient.get(client.slug)?.total || 0,
          approvedReviews: reviewByClient.get(client.slug)?.approved || 0,
          changesRequested: reviewByClient.get(client.slug)?.changesRequested || 0,
          services: client.services,
          profile,
          billingStatus: profile.billingStatus || "current",
          contractStartedAt: profile.contractStartedAt || "",
          contractEndedAt: profile.contractEndedAt || "",
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
        totalClients: contracts.length,
        totalActiveServices: activeContracts.length,
        totalCanceledServices: canceledContracts.length,
        lateBillingClients: clientSummary.filter((client) => client.billingStatus === "late").length,
        monthlyProfilePending: clientSummary.filter((client) => client.monthlyProfilePending).length,
        mostContractedServices: serviceSummary.slice(0, 5),
        services: serviceSummary,
        clients: clientSummary
      },
      employees: employeeSummary,
      satisfaction: {
        overallAverage: roundOne(average(ratings.map((rating) => Number(rating.score)))),
        totalRatings: ratings.length,
        byService: serviceSummary
          .filter((service) => service.averageRating != null)
          .sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0)),
        byClient: clientSummary
          .filter((client) => client.averageRating != null)
          .sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0)),
        byEmployee: employeeSummary
          .filter((employee) => employee.averageRating != null)
          .sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0))
      },
      reviewFlow: {
        total: taskReviews.length,
        approved: taskReviews.filter((review) => review.status !== "changes_requested").length,
        changesRequested: taskReviews.filter((review) => review.status === "changes_requested").length
      }
    };
  }

  function getPortalAutoMap() {
    return typeof AUTO_MAP !== "undefined" ? AUTO_MAP : undefined;
  }

  function getPortalAssigneeIds() {
    return typeof ASSIGNEE_IDS !== "undefined" ? ASSIGNEE_IDS : undefined;
  }

  function getPortalAssigneeTypeById() {
    return typeof ASSIGNEE_TYPE_BY_ID !== "undefined" ? ASSIGNEE_TYPE_BY_ID : undefined;
  }

  function getPortalTipoOptions() {
    return typeof CF_TIPO_OPTIONS !== "undefined" ? CF_TIPO_OPTIONS : undefined;
  }

  function getPortalTipoSelect() {
    return typeof tipoSelect !== "undefined" ? tipoSelect : undefined;
  }

  function getPortalPrestadorSelect() {
    return typeof prestadorSelect !== "undefined" ? prestadorSelect : undefined;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function uniqueValues(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function makeDomSafeId(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_");
  }

  function normalizeOptionLabel(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleUpperCase("pt-BR");
  }

  function getTipoOptionAliases(serviceName) {
    const normalizedService = normalizeServiceName(serviceName);
    const aliases = LEGACY_TIPO_OPTION_ALIASES[normalizedService] || [normalizedService];
    return Array.from(new Set(
      aliases
        .map((label) => normalizeOptionLabel(label))
        .filter(Boolean)
    ));
  }

  async function hydratePortalTipoOptions() {
    const tipoOptions = getPortalTipoOptions();
    if (!tipoOptions || state.tipoOptionsHydrated || state.tipoOptionsPromise) {
      return state.tipoOptionsPromise || Promise.resolve();
    }

    const listId = typeof CU_LIST_ID !== "undefined" ? String(CU_LIST_ID || "").trim() : "";
    const fieldId = typeof CF_TIPO_ID !== "undefined" ? String(CF_TIPO_ID || "").trim() : "";
    if (!listId || !fieldId) {
      state.tipoOptionsHydrated = true;
      return Promise.resolve();
    }

    state.tipoOptionsPromise = fetch(`https://api.clickup.com/api/v2/list/${listId}/field`, {
      method: "GET",
      headers: {
        Authorization: typeof CU_API_KEY !== "undefined" ? CU_API_KEY : "",
      },
    })
      .then((response) => response.json().catch(() => null).then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok || !payload) {
          throw new Error(`Erro ${response.status}`);
        }

        const fields = Array.isArray(payload.fields)
          ? payload.fields
          : Array.isArray(payload)
            ? payload
            : [];

        const tipoField = fields.find((field) => {
          const id = String(field && field.id || "").trim();
          const name = normalizeOptionLabel(field && field.name || "");
          return id === fieldId || name === "TIPO DE SERVICO" || name === "TIPO DE SERVIÇO";
        });

        const options = Array.isArray(tipoField && tipoField.type_config && tipoField.type_config.options)
          ? tipoField.type_config.options
          : [];

        const optionLookup = new Map(
          options
            .map((option) => [normalizeOptionLabel(option && (option.name || option.label) || ""), String(option && option.id || "").trim()])
            .filter(([label, id]) => label && id)
        );

        Object.keys(tipoOptions).forEach((serviceName) => {
          if (tipoOptions[serviceName]) return;
          const aliases = getTipoOptionAliases(serviceName);
          const match = aliases.find((alias) => optionLookup.has(alias));
          if (match) {
            tipoOptions[serviceName] = optionLookup.get(match);
          }
        });

        state.tipoOptionsHydrated = true;
      })
      .catch(() => {
        state.tipoOptionsHydrated = false;
      })
      .finally(() => {
        state.tipoOptionsPromise = null;
      });

    return state.tipoOptionsPromise;
  }

  function findOptionByValue(root, value) {
    return Array.from(root.querySelectorAll(".option[data-value]")).find((option) => option.dataset.value === value) || null;
  }

  function patchLegacySelect(binding, controller) {
    if (!binding || typeof binding !== "object") return controller;
    binding.setOptions = (values, options) => controller.setOptions(values, options);
    binding.setValue = (value) => controller.setValue(value);
    binding.getValue = () => controller.getValue();
    binding.reset = () => controller.reset();
    binding.enable = () => controller.enable();
    binding.disable = () => controller.disable();
    binding.__portalController = controller;
    return controller;
  }

  function getOrCreateSelectController(bindingName, triggerId, dropId, placeholder) {
    const trigger = document.getElementById(triggerId);
    const drop = document.getElementById(dropId);
    const optionsRoot = drop && drop.querySelector(".dropdown-options");
    const search = drop && drop.querySelector(".search-input");
    const label = trigger && trigger.querySelector(".select-label");
    const legacyBinding = bindingName === "tipoSelect" ? getPortalTipoSelect() : getPortalPrestadorSelect();

    if (!trigger || !drop || !optionsRoot || !label) return null;

    if (drop.__portalController) {
      patchLegacySelect(legacyBinding, drop.__portalController);
      return drop.__portalController;
    }

    const state = {
      value: null,
      placeholder
    };

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
        const items = uniqueValues(values);
        const emptyLabel = options && options.emptyLabel ? options.emptyLabel : "Nenhum serviço ativo";

        optionsRoot.innerHTML = items.length
          ? items.map((item) => `<div class="option" data-value="${escapeHtml(item)}">${escapeHtml(item)}</div>`).join("")
          : `<div class="option" data-empty="true">${escapeHtml(emptyLabel)}</div>`;

        if (search) search.value = "";

        if (!items.includes(state.value)) {
          controller.reset({ silent: true, placeholder: state.placeholder });
        } else {
          controller.setValue(state.value, { silent: true });
        }

        controller.filter("");
      },
      setValue(value, options) {
        const option = findOptionByValue(optionsRoot, value);
        if (!option) {
          controller.reset(options);
          return false;
        }

        state.value = option.dataset.value;
        label.textContent = option.dataset.value;
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
      getValue() {
        return state.value;
      },
      reset(options) {
        state.value = null;
        label.textContent = options && options.placeholder ? options.placeholder : state.placeholder;
        trigger.classList.remove("selected");
        trigger.classList.remove("open");
        drop.classList.remove("open");
        Array.from(optionsRoot.querySelectorAll(".option")).forEach((item) => item.classList.remove("selected"));
      },
      enable() {
        trigger.classList.remove("disabled");
      },
      disable(customPlaceholder) {
        controller.reset({ silent: true, placeholder: customPlaceholder || state.placeholder });
        trigger.classList.add("disabled");
      }
    };

    drop.addEventListener("click", (event) => {
      const option = event.target.closest(".option[data-value]");
      if (!option) return;
      controller.setValue(option.dataset.value);
    });

    if (search) {
      search.addEventListener("input", () => {
        controller.filter(search.value);
      });
    }

    drop.__portalController = controller;
    patchLegacySelect(legacyBinding, controller);
    return controller;
  }

  function formatProfileDate(value) {
    if (!value) return "—";
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date);
  }

  function formatProfileDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function getBillingStatusMeta(status) {
    if (status === "late") {
      return {
        label: "Assinatura atrasada",
        className: "late",
        description: "Existe uma pendência financeira em acompanhamento pela equipe."
      };
    }
    if (status === "canceled") {
      return {
        label: "Contrato encerrado",
        className: "canceled",
        description: "O contrato foi encerrado e novos chamados ficam bloqueados."
      };
    }
    return {
      label: "Assinatura ativa",
      className: "current",
      description: "Cliente liberado para seguir usando o portal normalmente."
    };
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
    const answered = hasMonthlyProfileResponse(profile);
    const updatedAt = answered && profile && profile.updatedAt ? new Date(profile.updatedAt) : null;
    const due = !updatedAt || Number.isNaN(updatedAt.getTime())
      ? true
      : (Date.now() - updatedAt.getTime()) > (1000 * 60 * 60 * 24 * 30);

    return {
      answered,
      due,
      label: due ? "Não respondido" : "Respondido",
      className: due ? "pending" : "current",
      title: !answered
        ? "Formulário mensal não respondido"
        : due
          ? "Atualização mensal pendente"
          : "Formulário mensal respondido",
      description: !answered
        ? "Nenhuma resposta mensal foi enviada ainda."
        : due
          ? `Última resposta enviada em ${formatProfileDateTime(profile.updatedAt)}. Atualize o formulário deste mês.`
          : `Última atualização enviada em ${formatProfileDateTime(profile.updatedAt)}.`
    };
  }

  function getProfilePreviewItems(profile) {
    const seminar = profile && profile.seminar ? profile.seminar : blankSeminarData();
    return [
      ["Instagram", seminar.instagram],
      ["Site", seminar.siteUrl],
      ["Drive", seminar.driveUrl],
      ["Página de captura", seminar.capturePageUrl],
      ["Próximo seminário", formatProfileDate(seminar.seminarDay1Date)],
      ["Pitch", formatProfileDate(seminar.pitchDate)],
      ["Região", seminar.targetRegion],
      ["Meta de leads", seminar.targetLeads],
      ["Ferramenta de e-mail", seminar.emailMarketingTool],
      ["Construtor de páginas", seminar.pageBuilder],
      ["API do WhatsApp", seminar.whatsappApiEnabled ? (seminar.whatsappApiTool || "Sim") : "Não"],
    ].filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return String(value || "").trim() && value !== "—";
    });
  }

  function getProfileFieldValue(profile, key) {
    if (Object.prototype.hasOwnProperty.call(profile, key)) {
      return profile[key];
    }
    return profile.seminar && Object.prototype.hasOwnProperty.call(profile.seminar, key)
      ? profile.seminar[key]
      : "";
  }

  function renderProfileField(field, prefix) {
    const inputId = `${prefix}_${field.key}`;
    if (field.type === "toggle") {
      return `
        <div class="gp-profile-field gp-profile-toggle-field">
          <label class="gp-toggle-card" for="${inputId}">
            <input type="checkbox" id="${inputId}" data-profile-key="${field.key}" />
            <span>
              <strong>${escapeHtml(field.label)}</strong>
              <small>Marque quando essa operação estiver ativa.</small>
            </span>
          </label>
        </div>`;
    }

    if (field.type === "multicheck") {
      return `
        <div class="gp-profile-field gp-profile-span-2">
          <label>${escapeHtml(field.label)}</label>
          <div class="gp-check-grid">
            ${field.options.map((option) => `
              <label class="gp-check-chip" for="${inputId}_${option.value}">
                <input type="checkbox" id="${inputId}_${option.value}" data-profile-key="${field.key}" value="${escapeHtml(option.value)}" />
                <span>${escapeHtml(option.label)}</span>
              </label>
            `).join("")}
          </div>
        </div>`;
    }

    return `
      <div class="gp-profile-field">
        <label for="${inputId}">${escapeHtml(field.label)}</label>
        <input
          id="${inputId}"
          type="${field.type === "date" ? "date" : field.type === "url" ? "url" : "text"}"
          data-profile-key="${field.key}"
          placeholder="${escapeHtml(field.placeholder || "")}"
        />
      </div>`;
  }

  function renderProfileSections(prefix) {
    return CLIENT_PROFILE_SCHEMA.map((section) => `
      <section class="gp-profile-section">
        <div class="gp-profile-section-head">
          <strong>${escapeHtml(section.title)}</strong>
        </div>
        <div class="gp-profile-fields">
          ${section.fields.map((field) => renderProfileField(field, prefix)).join("")}
        </div>
      </section>
    `).join("");
  }

  function ensurePortalEnhancementStyles() {
    if (document.getElementById("gpPortalEnhancementStyle")) return;

    const style = document.createElement("style");
    style.id = "gpPortalEnhancementStyle";
    style.textContent = `
      .gp-profile-panel {
        display: grid;
        gap: 18px;
      }
      .gp-profile-summary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }
      .gp-summary-card {
        padding: 18px;
        border-radius: 18px;
        border: 1px solid #e5e7eb;
        background: #ffffff;
      }
      .gp-summary-card span {
        display: block;
        font-size: 0.76rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #94a3b8;
      }
      .gp-summary-card strong {
        display: block;
        margin-top: 10px;
        font-size: 1rem;
        line-height: 1.35;
        color: #0f172a;
      }
      .gp-summary-card small {
        display: block;
        margin-top: 8px;
        font-size: 0.85rem;
        line-height: 1.6;
        color: #64748b;
      }
      .gp-summary-card.primary {
        grid-column: span 2;
        background: linear-gradient(135deg, rgba(242, 151, 37, 0.12), rgba(255,255,255,1));
      }
      .gp-summary-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        font-size: 0.78rem;
        font-weight: 800;
        background: #f8fafc;
        color: #475569;
      }
      .gp-summary-chip.current { background: #ecfdf5; color: #047857; }
      .gp-summary-chip.late { background: #fff7ed; color: #c2410c; }
      .gp-summary-chip.canceled { background: #f8fafc; color: #64748b; }
      .gp-profile-gate {
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid rgba(242, 151, 37, 0.25);
        background: rgba(242, 151, 37, 0.1);
        color: #9a3412;
        font-size: 0.92rem;
        line-height: 1.6;
      }
      .gp-profile-gate.pending {
        border-color: rgba(242, 151, 37, 0.25);
        background: rgba(242, 151, 37, 0.1);
        color: #9a3412;
      }
      .gp-profile-gate.late {
        border-color: rgba(242, 151, 37, 0.28);
        background: #fff7ed;
        color: #c2410c;
      }
      .gp-profile-gate.blocked {
        border-color: rgba(15, 23, 42, 0.12);
        background: #f1f5f9;
        color: #475569;
      }
      .card.gp-portal-card {
        max-width: min(1180px, 100%);
        padding: clamp(24px, 3vw, 40px);
      }
      .card.gp-portal-card .tabs {
        margin-bottom: 24px;
      }
      .gp-profile-form {
        display: grid;
        gap: 18px;
      }
      .gp-profile-section {
        padding: 18px;
        border-radius: 18px;
        border: 1px solid #e5e7eb;
        background: #ffffff;
      }
      .gp-profile-section-head {
        margin-bottom: 14px;
      }
      .gp-profile-section-head strong {
        font-size: 1rem;
        color: #0f172a;
      }
      .gp-profile-fields {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }
      .gp-profile-field {
        display: grid;
        gap: 8px;
      }
      .gp-profile-field label {
        font-size: 0.86rem;
        font-weight: 700;
        color: #334155;
      }
      .gp-profile-field input {
        width: 100%;
        border: 1px solid #e5e7eb;
        border-radius: 14px;
        padding: 13px 14px;
        font: inherit;
        background: #f8fafc;
        color: #0f172a;
      }
      .gp-profile-span-2 {
        grid-column: span 2;
      }
      .gp-toggle-card {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 56px;
        padding: 14px;
        border-radius: 14px;
        border: 1px solid #e5e7eb;
        background: #f8fafc;
      }
      .gp-toggle-card input,
      .gp-check-chip input,
      .gp-collab-chip input {
        width: 18px;
        height: 18px;
        margin: 0;
      }
      .gp-toggle-card small {
        display: block;
        margin-top: 4px;
        color: #64748b;
        font-size: 0.8rem;
      }
      .gp-check-grid,
      .gp-collab-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .gp-check-chip,
      .gp-collab-chip {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 999px;
        border: 1px solid #e5e7eb;
        background: #ffffff;
        color: #334155;
        font-size: 0.86rem;
        font-weight: 700;
      }
      .gp-profile-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .gp-profile-actions small {
        color: #64748b;
        line-height: 1.6;
      }
      .gp-secondary-copy {
        color: #64748b;
        line-height: 1.6;
      }
      .gp-collab-group[hidden] { display: none; }
      .gp-collab-group {
        display: grid;
        gap: 10px;
        padding: 16px 18px;
        border-radius: 18px;
        border: 1px solid #e5e7eb;
        background: #ffffff;
        margin-bottom: 18px;
      }
      .gp-collab-group strong {
        color: #0f172a;
      }
      .gp-collab-group small {
        color: #64748b;
      }
      .gp-portal-grid {
        display: grid;
        grid-template-columns: minmax(340px, 0.96fr) minmax(0, 1.24fr);
        gap: 24px;
        align-items: start;
      }
      .gp-portal-profile-card,
      .gp-portal-form-shell {
        min-width: 0;
        padding: 24px;
        border-radius: 26px;
        border: 1px solid #e5e7eb;
        background: #ffffff;
      }
      .gp-portal-profile-card {
        display: grid;
        gap: 18px;
      }
      .gp-portal-kicker,
      .gp-portal-form-kicker {
        display: block;
        font-size: 0.76rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #94a3b8;
      }
      .gp-portal-profile-title,
      .gp-portal-form-title {
        margin: 10px 0 0;
        color: #0f172a;
        font-size: clamp(1.3rem, 2.4vw, 1.9rem);
        line-height: 1.06;
        letter-spacing: -0.05em;
      }
      .gp-portal-profile-copy,
      .gp-portal-form-copy {
        margin: 10px 0 0;
        color: #64748b;
        font-size: 0.94rem;
        line-height: 1.7;
      }
      .gp-portal-status-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .gp-portal-status-card {
        padding: 18px;
        border-radius: 20px;
        border: 1px solid #e5e7eb;
        background: #f8fafc;
      }
      .gp-portal-status-card span {
        display: block;
        font-size: 0.74rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #94a3b8;
      }
      .gp-portal-status-card strong {
        display: block;
        margin-top: 10px;
        color: #0f172a;
        font-size: 1.05rem;
        line-height: 1.16;
        letter-spacing: -0.05em;
      }
      .gp-portal-status-card small {
        display: block;
        margin-top: 10px;
        color: #64748b;
        line-height: 1.65;
      }
      .gp-profile-response-pill {
        display: inline-flex;
        align-items: center;
        width: fit-content;
        padding: 8px 12px;
        border-radius: 999px;
        font-size: 0.78rem;
        font-weight: 800;
      }
      .gp-profile-response-pill.current {
        background: #ecfdf5;
        color: #047857;
      }
      .gp-profile-response-pill.pending {
        background: #fee2e2;
        color: #b91c1c;
      }
      .gp-profile-response-pill.late {
        background: #fff7ed;
        color: #c2410c;
      }
      .gp-profile-response-pill.canceled {
        background: #f1f5f9;
        color: #64748b;
      }
      .gp-profile-preview {
        display: grid;
        gap: 10px;
        padding: 16px 18px;
        border-radius: 20px;
        border: 1px solid #e5e7eb;
        background: #f8fafc;
      }
      .gp-profile-preview-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }
      .gp-profile-preview-head strong {
        color: #0f172a;
      }
      .gp-profile-preview-list {
        display: grid;
        gap: 8px;
      }
      .gp-profile-preview-row {
        display: grid;
        grid-template-columns: minmax(0, 120px) minmax(0, 1fr);
        gap: 10px;
        align-items: start;
      }
      .gp-profile-preview-row span {
        color: #94a3b8;
        font-size: 0.8rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .gp-profile-preview-row strong {
        color: #334155;
        font-size: 0.88rem;
        line-height: 1.6;
        word-break: break-word;
      }
      .gp-profile-preview-empty {
        color: #94a3b8;
        line-height: 1.7;
      }
      .gp-drive-shortcut {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 14px;
        align-items: center;
        padding: 16px 18px;
        border-radius: 20px;
        border: 1px solid #e5e7eb;
        background: linear-gradient(135deg, rgba(242, 151, 37, 0.1), #fffdf9);
      }
      .gp-drive-shortcut.empty {
        grid-template-columns: 1fr;
        background: #f8fafc;
      }
      .gp-drive-shortcut-copy {
        display: grid;
        gap: 6px;
      }
      .gp-drive-shortcut-copy span {
        color: #94a3b8;
        font-size: 0.76rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .gp-drive-shortcut-copy strong {
        color: #0f172a;
        font-size: 1rem;
        letter-spacing: -0.04em;
      }
      .gp-drive-shortcut-copy small {
        color: #64748b;
        line-height: 1.6;
      }
      .gp-drive-shortcut-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 46px;
        padding: 0 18px;
        border-radius: 16px;
        background: linear-gradient(135deg, #F29725 0%, #F29725 100%);
        color: #ffffff;
        text-decoration: none;
        font-size: 0.88rem;
        font-weight: 800;
        box-shadow: 0 16px 24px rgba(242, 151, 37, 0.22);
      }
      .gp-portal-profile-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .gp-portal-profile-actions small {
        color: #64748b;
        line-height: 1.6;
      }
      .gp-portal-form-shell #gpPortalFormSlot {
        min-width: 0;
      }
      .gp-portal-form-shell #mainForm {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 18px 16px;
        align-items: start;
        margin-top: 8px;
      }
      .gp-portal-form-shell #mainForm > * {
        min-width: 0;
      }
      .gp-portal-form-shell #mainForm > .form-group {
        margin-bottom: 0;
      }
      .gp-portal-form-shell #mainForm > .form-group:nth-of-type(3),
      .gp-portal-form-shell #mainForm > .form-group:nth-of-type(4),
      .gp-portal-form-shell #mainForm > .form-group:nth-of-type(5),
      .gp-portal-form-shell #mainForm > #gpOpeningAttachments,
      .gp-portal-form-shell #mainForm > #gpExtraAssignees,
      .gp-portal-form-shell #mainForm > #btnSubmit {
        grid-column: 1 / -1;
      }
      .gp-portal-form-shell .form-group label {
        font-size: 0.86rem;
        margin-bottom: 8px;
      }
      .gp-portal-form-shell .hint {
        margin-bottom: 10px;
        font-size: 0.78rem;
        line-height: 1.55;
      }
      .gp-portal-form-shell .select-wrapper,
      .gp-portal-form-shell .custom-select,
      .gp-portal-form-shell input[type="text"],
      .gp-portal-form-shell textarea {
        min-width: 0;
      }
      .gp-portal-form-shell .custom-select,
      .gp-portal-form-shell input[type="text"],
      .gp-portal-form-shell textarea {
        font-size: 0.92rem;
      }
      .gp-portal-form-shell textarea {
        min-height: 148px;
      }
      .gp-portal-form-shell .urgency-group {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .gp-portal-form-shell .urgency-card {
        align-items: flex-start;
        min-height: 96px;
        padding: 14px;
      }
      .gp-portal-form-shell .urgency-card > span:last-child {
        display: grid;
        gap: 4px;
        min-width: 0;
      }
      .gp-portal-form-shell .urgency-card strong {
        font-size: 0.88rem;
        line-height: 1.2;
      }
      .gp-portal-form-shell .urgency-card span {
        font-size: 0.78rem;
        line-height: 1.45;
      }
      .gp-portal-form-shell .btn-submit {
        margin-top: 4px;
      }
      .gp-opening-upload-group {
        display: grid;
        gap: 10px;
      }
      .gp-opening-upload-card {
        display: grid;
        gap: 12px;
        padding: 16px 18px;
        border-radius: 18px;
        border: 1px dashed #cbd5e1;
        background: #f8fafc;
      }
      .gp-opening-upload-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .gp-opening-upload-button {
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        background: #ffffff;
        color: #334155;
        font: inherit;
        font-size: 0.86rem;
        font-weight: 800;
        padding: 12px 14px;
        cursor: pointer;
      }
      .gp-opening-upload-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .gp-opening-file-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        color: #334155;
        font-size: 0.82rem;
        font-weight: 700;
      }
      .gp-opening-file-chip button {
        width: 22px;
        height: 22px;
        border: none;
        border-radius: 999px;
        background: #f1f5f9;
        color: #475569;
        font: inherit;
        cursor: pointer;
      }
      .gp-area-filters {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin: 14px 0 0;
      }
      .gp-filter-caption {
        color: #94a3b8;
        font-size: 0.74rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .gp-progress-track {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }
      .gp-task-review-box {
        margin-top: 12px;
        padding: 14px 16px;
        border-radius: 18px;
        border: 1px solid #e5e7eb;
        background: #f8fafc;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        flex-wrap: wrap;
      }
      .gp-task-review-box.pending {
        border-color: rgba(242, 151, 37, 0.28);
        background: rgba(242, 151, 37, 0.08);
      }
      .gp-task-review-box.warning {
        border-color: rgba(251, 146, 60, 0.28);
        background: #fff7ed;
      }
      .gp-task-review-box.approved {
        border-color: rgba(22, 163, 74, 0.18);
        background: #ecfdf5;
      }
      .gp-task-review-copy {
        display: grid;
        gap: 4px;
        min-width: 0;
      }
      .gp-task-review-copy strong {
        color: #0f172a;
        font-size: 0.92rem;
      }
      .gp-task-review-copy span {
        color: #64748b;
        font-size: 0.84rem;
        line-height: 1.55;
      }
      .gp-task-review-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .gp-task-review-button {
        border: none;
        border-radius: 14px;
        padding: 11px 13px;
        background: #ffffff;
        color: #334155;
        font: inherit;
        font-size: 0.82rem;
        font-weight: 800;
        cursor: pointer;
      }
      .gp-task-review-button.primary {
        background: linear-gradient(135deg, #F29725 0%, #F29725 100%);
        color: #ffffff;
        box-shadow: 0 14px 22px rgba(242, 151, 37, 0.18);
      }
      .gp-chat-form {
        position: relative;
      }
      .gp-chat-mentions {
        position: absolute;
        left: 14px;
        right: 14px;
        bottom: calc(100% + 10px);
        display: grid;
        gap: 8px;
        padding: 10px;
        border-radius: 18px;
        border: 1px solid rgba(15, 23, 42, 0.08);
        background: #ffffff;
        box-shadow: 0 18px 40px rgba(15, 23, 42, 0.16);
        z-index: 20;
      }
      .gp-chat-mention-option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
        padding: 12px 14px;
        border: none;
        border-radius: 14px;
        background: #f8fafc;
        color: #334155;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .gp-chat-mention-option strong {
        font-size: 0.86rem;
      }
      .gp-chat-mention-option span {
        color: #64748b;
        font-size: 0.76rem;
      }
      .gp-chat-mention-option.active {
        background: rgba(242, 151, 37, 0.12);
        color: #9a3412;
      }
      .gp-profile-modal {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(15, 23, 42, 0.58);
        backdrop-filter: blur(8px);
        z-index: 2600;
      }
      .gp-profile-modal.show {
        display: flex;
      }
      .gp-profile-modal-card {
        width: min(980px, 100%);
        max-height: min(88vh, 980px);
        overflow: auto;
        padding: 26px;
        border-radius: 28px;
        border: 1px solid rgba(15, 23, 42, 0.08);
        background: #ffffff;
        box-shadow: 0 30px 80px rgba(15, 23, 42, 0.22);
      }
      .gp-profile-modal-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 18px;
      }
      .gp-profile-modal-head h3 {
        margin: 10px 0 0;
        color: #0f172a;
        font-size: clamp(1.4rem, 2.8vw, 2rem);
        line-height: 1.02;
        letter-spacing: -0.05em;
      }
      .gp-profile-modal-head p {
        margin: 10px 0 0;
        color: #64748b;
        line-height: 1.7;
      }
      .gp-profile-modal-close {
        width: 44px;
        height: 44px;
        border: none;
        border-radius: 14px;
        background: #f8fafc;
        color: #475569;
        font: inherit;
        font-size: 1.4rem;
        cursor: pointer;
      }
      .gp-profile-upload {
        padding: 18px;
        border-radius: 18px;
        border: 1px dashed #cbd5e1;
        background: #f8fafc;
        display: grid;
        gap: 12px;
      }
      .gp-profile-upload label {
        font-size: 0.86rem;
        font-weight: 700;
        color: #334155;
      }
      .gp-profile-upload input[type="file"] {
        width: 100%;
      }
      .gp-profile-upload small {
        color: #64748b;
        line-height: 1.6;
      }
      .gp-profile-upload-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .gp-profile-upload-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        color: #334155;
        font-size: 0.82rem;
        font-weight: 700;
      }
      @media (max-width: 1120px) {
        .card.gp-portal-card {
          max-width: min(860px, 100%);
        }
        .gp-portal-grid {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 860px) {
        .gp-portal-form-shell #mainForm,
        .gp-profile-fields {
          grid-template-columns: 1fr;
        }
        .gp-portal-status-grid {
          grid-template-columns: 1fr;
        }
        .gp-profile-preview-row {
          grid-template-columns: 1fr;
        }
        .gp-portal-form-shell .urgency-group {
          grid-template-columns: 1fr;
        }
        .gp-drive-shortcut {
          grid-template-columns: 1fr;
        }
        .gp-task-review-box {
          flex-direction: column;
          align-items: flex-start;
        }
      }
      @media (max-width: 780px) {
        .gp-profile-summary,
        .gp-profile-fields {
          grid-template-columns: 1fr;
        }
        .gp-summary-card.primary,
        .gp-profile-span-2 {
          grid-column: span 1;
        }
        .gp-profile-modal-card {
          padding: 20px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function getOpeningTaskFileKey(file) {
    return `${file.name}::${file.size}::${file.lastModified}`;
  }

  function getOpeningTaskFiles() {
    return [...state.openingTaskFiles];
  }

  function renderOpeningTaskFiles() {
    const list = document.getElementById("gpOpeningFileList");
    if (!list) return;

    list.innerHTML = state.openingTaskFiles.length
      ? state.openingTaskFiles.map((file, index) => `
        <span class="gp-opening-file-chip">
          <span>${file.type.startsWith("image/") ? "🖼️" : "📎"}</span>
          <span>${escapeHtml(file.name)}</span>
          <button type="button" data-opening-file-remove="${index}" aria-label="Remover arquivo">×</button>
        </span>
      `).join("")
      : "";

    list.querySelectorAll("[data-opening-file-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        state.openingTaskFiles.splice(Number(button.dataset.openingFileRemove), 1);
        renderOpeningTaskFiles();
      });
    });
  }

  function addOpeningTaskFiles(files) {
    const known = new Set(state.openingTaskFiles.map(getOpeningTaskFileKey));
    files.forEach((file) => {
      const key = getOpeningTaskFileKey(file);
      if (known.has(key)) return;
      state.openingTaskFiles.push(file);
      known.add(key);
    });
    renderOpeningTaskFiles();
  }

  function clearOpeningTaskFiles() {
    state.openingTaskFiles = [];
    const images = document.getElementById("gpOpeningImages");
    const documents = document.getElementById("gpOpeningDocuments");
    if (images) images.value = "";
    if (documents) documents.value = "";
    renderOpeningTaskFiles();
  }

  function ensureOpeningTaskUploadUI(mainForm) {
    if (!mainForm || document.getElementById("gpOpeningAttachments")) return;

    const group = document.createElement("div");
    group.className = "form-group gp-opening-upload-group";
    group.id = "gpOpeningAttachments";
    group.innerHTML = `
      <label>Anexos da abertura</label>
      <p class="hint">Se quiser, já envie fotos, PDFs ou documentos junto com o chamado.</p>
      <div class="gp-opening-upload-card">
        <input id="gpOpeningImages" type="file" accept="image/*" multiple hidden />
        <input id="gpOpeningDocuments" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.psd,.ai,.mp4,.mov,.avi,.mp3,.wav,application/*,text/*,video/*,audio/*" multiple hidden />
        <div class="gp-opening-upload-actions">
          <button type="button" class="gp-opening-upload-button" data-opening-kind="image">Adicionar foto</button>
          <button type="button" class="gp-opening-upload-button" data-opening-kind="document">Adicionar documento</button>
        </div>
        <div class="gp-opening-upload-list" id="gpOpeningFileList"></div>
      </div>
    `;

    const submitButton = document.getElementById("btnSubmit");
    if (submitButton && submitButton.parentElement === mainForm) {
      mainForm.insertBefore(group, submitButton);
    } else {
      mainForm.appendChild(group);
    }

    group.querySelectorAll("[data-opening-kind]").forEach((button) => {
      button.addEventListener("click", () => {
        document.getElementById(button.dataset.openingKind === "image" ? "gpOpeningImages" : "gpOpeningDocuments").click();
      });
    });

    group.querySelector("#gpOpeningImages").addEventListener("change", (event) => {
      addOpeningTaskFiles(Array.from(event.target.files || []));
      event.target.value = "";
    });
    group.querySelector("#gpOpeningDocuments").addEventListener("change", (event) => {
      addOpeningTaskFiles(Array.from(event.target.files || []));
      event.target.value = "";
    });
  }

  function ensurePortalProfileUI(context) {
    const mainForm = document.getElementById("mainForm");
    const novoPanel = document.getElementById("panel-novo");
    if (!mainForm || !novoPanel) return;

    ensurePortalEnhancementStyles();
    const portalCard = document.querySelector(".card");
    if (portalCard) {
      portalCard.classList.add("gp-portal-card");
    }

    if (!document.getElementById("gpPortalSplit")) {
      const split = document.createElement("div");
      split.id = "gpPortalSplit";
      split.className = "gp-portal-grid";
      split.innerHTML = `
        <aside class="gp-portal-profile-card">
          <div>
            <span class="gp-portal-kicker">Perfil do cliente</span>
            <h3 class="gp-portal-profile-title">Seu perfil mensal</h3>
            <p class="gp-portal-profile-copy">Veja o resumo do mês, mantenha seu formulário do próximo seminário atualizado e siga abrindo chamados normalmente.</p>
          </div>
          <div class="gp-portal-status-grid" id="gpProfileSummary"></div>
          <div class="gp-profile-preview" id="gpProfilePreview"></div>
          <div class="gp-drive-shortcut" id="gpDriveShortcut"></div>
          <div class="gp-profile-gate" id="gpProfileMonthlyGate"></div>
          <div class="gp-portal-profile-actions">
            <small>Esse formulário alimenta o histórico mensal do seu cliente para toda a equipe.</small>
            <button type="button" class="btn-submit" id="gpOpenProfileModal">Responder formulário</button>
          </div>
        </aside>
        <section class="gp-portal-form-shell">
          <div>
            <span class="gp-portal-form-kicker">Chamados</span>
            <h3 class="gp-portal-form-title">Abrir chamado</h3>
            <p class="gp-portal-form-copy">Envie sua demanda para a equipe usando os serviços que estão ativos no seu contrato.</p>
          </div>
          <div id="gpPortalFormSlot"></div>
        </section>
      `;
      novoPanel.prepend(split);
      split.querySelector("#gpPortalFormSlot").appendChild(mainForm);

      const modal = document.createElement("div");
      modal.className = "gp-profile-modal";
      modal.id = "gpProfileModal";
      modal.innerHTML = `
        <div class="gp-profile-modal-card">
          <div class="gp-profile-modal-head">
            <div>
              <span class="gp-portal-kicker">Formulário mensal</span>
              <h3>Responder formulário do próximo seminário</h3>
              <p>Preencha os dados mais recentes do seu próximo seminário. Você também pode anexar fotos ou referências para a equipe ver junto no ClickUp.</p>
            </div>
            <button type="button" class="gp-profile-modal-close" id="gpCloseProfileModal">×</button>
          </div>
          <form class="gp-profile-form" id="gpProfileForm">
            ${renderProfileSections("gpProfile")}
            <section class="gp-profile-upload">
              <label for="gpProfilePhotos">Adicionar foto</label>
              <input id="gpProfilePhotos" type="file" accept="image/*" multiple />
              <small>As imagens vão como anexo para o ClickUp junto com a atualização do formulário.</small>
              <div class="gp-profile-upload-list" id="gpProfilePhotoList"></div>
            </section>
            <div class="gp-profile-actions">
              <small>Quando você salva esse formulário, a equipe recebe a atualização no ClickUp ligada ao seu cliente.</small>
              <button type="submit" class="btn-submit" id="gpProfileSubmit">Salvar formulário mensal</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(modal);

      split.querySelector("#gpOpenProfileModal").addEventListener("click", () => {
        modal.classList.add("show");
      });

      modal.querySelector("#gpCloseProfileModal").addEventListener("click", () => {
        modal.classList.remove("show");
      });

      modal.addEventListener("click", (event) => {
        if (event.target === modal) {
          modal.classList.remove("show");
        }
      });

      modal.querySelector("#gpProfilePhotos").addEventListener("change", updatePortalUploadPreview);

      modal.querySelector("#gpProfileForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitButton = modal.querySelector("#gpProfileSubmit");
        submitButton.disabled = true;
        try {
          const seminar = collectPortalProfileForm();
          const profile = await saveClientProfile(context.slug, { seminar });
          await syncProfileAttachments(context, Array.from(modal.querySelector("#gpProfilePhotos").files || []));
          fillPortalProfileForm(profile);
          renderPortalProfileSummary(context, profile);
          applyPortalContractBindings();
          modal.querySelector("#gpProfilePhotos").value = "";
          updatePortalUploadPreview();
          modal.classList.remove("show");
          if (typeof window.showToast === "function") {
            window.showToast("✅ Formulário mensal salvo e enviado para a equipe.");
          }
        } catch (error) {
          if (typeof window.showToast === "function") {
            window.showToast(error.message || "❌ Não foi possível salvar o formulário.", true);
          }
        } finally {
          submitButton.disabled = false;
        }
      });
    }

    ensureOpeningTaskUploadUI(mainForm);

    if (!document.getElementById("gpExtraAssignees")) {
      const wrapper = document.createElement("div");
      wrapper.className = "gp-collab-group";
      wrapper.id = "gpExtraAssignees";
      wrapper.hidden = true;
      wrapper.innerHTML = `
        <div>
          <strong>Envolver mais pessoas nessa tarefa</strong>
          <small>Além do responsável principal, você pode incluir outros profissionais ativos do seu cliente.</small>
        </div>
        <div class="gp-collab-grid" id="gpExtraAssigneeList"></div>
      `;

      const submitButton = document.getElementById("btnSubmit");
      if (submitButton && submitButton.parentElement) {
        submitButton.parentElement.insertBefore(wrapper, submitButton);
      } else {
        mainForm.appendChild(wrapper);
      }
    }

    const profile = getClientProfile(context.slug);
    fillPortalProfileForm(profile);
    updatePortalUploadPreview();
    renderPortalProfileSummary(context, profile);
  }

  function renderPortalProfileSummary(context, profile) {
    const summary = document.getElementById("gpProfileSummary");
    const preview = document.getElementById("gpProfilePreview");
    const driveShortcut = document.getElementById("gpDriveShortcut");
    const gate = document.getElementById("gpProfileMonthlyGate");
    const ctaButton = document.getElementById("gpOpenProfileModal");
    if (!summary || !gate) return;

    const billingMeta = getBillingStatusMeta(profile.billingStatus);
    const monthlyMeta = getMonthlyProfileMeta(profile);
    const previewItems = getProfilePreviewItems(profile);
    const driveUrl = String(profile && profile.seminar && profile.seminar.driveUrl || "").trim();

    summary.innerHTML = `
      <article class="gp-portal-status-card">
        <span>Formulário mensal</span>
        <strong><span class="gp-profile-response-pill ${monthlyMeta.className}">${escapeHtml(monthlyMeta.label)}</span></strong>
        <small>${escapeHtml(monthlyMeta.description)}</small>
      </article>
      <article class="gp-portal-status-card">
        <span>Assinatura</span>
        <strong><span class="gp-profile-response-pill ${billingMeta.className}">${escapeHtml(billingMeta.label)}</span></strong>
        <small>${escapeHtml(billingMeta.description)}</small>
      </article>
    `;

    if (preview) {
      preview.innerHTML = previewItems.length ? `
        <div class="gp-profile-preview-head">
          <strong>Dados já respondidos</strong>
          <span class="gp-secondary-copy">${escapeHtml(formatClientName(context.name))}</span>
        </div>
        <div class="gp-profile-preview-list">
          ${previewItems.slice(0, 8).map(([label, value]) => `
            <div class="gp-profile-preview-row">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
            </div>
          `).join("")}
        </div>
      ` : `
        <div class="gp-profile-preview-head">
          <strong>Dados já respondidos</strong>
        </div>
        <div class="gp-profile-preview-empty">Nenhuma resposta mensal foi enviada ainda. Use o botão abaixo para preencher o formulário pela primeira vez.</div>
      `;
    }

    if (driveShortcut) {
      driveShortcut.className = `gp-drive-shortcut ${driveUrl ? "ready" : "empty"}`;
      driveShortcut.innerHTML = driveUrl ? `
        <div class="gp-drive-shortcut-copy">
          <span>Drive do cliente</span>
          <strong>Acesso rápido aos arquivos</strong>
          <small>Esse atalho fica sempre visível para você abrir materiais, referências e entregas em um clique.</small>
        </div>
        <a class="gp-drive-shortcut-link" href="${escapeHtml(driveUrl)}" target="_blank" rel="noopener noreferrer">Abrir Drive</a>
      ` : `
        <div class="gp-drive-shortcut-copy">
          <span>Drive do cliente</span>
          <strong>Link ainda não cadastrado</strong>
          <small>Preencha o formulário mensal para deixar esse atalho fixo no portal.</small>
        </div>
      `;
    }

    gate.hidden = !monthlyMeta.due;
    gate.textContent = monthlyMeta.due
      ? "Seu formulário mensal está pendente. Você ainda pode enviar chamados, mas vale responder para manter a equipe alinhada."
      : "";
    if (ctaButton) {
      ctaButton.textContent = monthlyMeta.due ? "Responder formulário" : "Atualizar formulário";
    }
  }

  function fillPortalProfileForm(profile) {
    CLIENT_PROFILE_SCHEMA.forEach((section) => {
      section.fields.forEach((field) => {
        if (field.type === "multicheck") {
          const values = Array.isArray(getProfileFieldValue(profile, field.key)) ? getProfileFieldValue(profile, field.key) : [];
          field.options.forEach((option) => {
            const input = document.getElementById(`gpProfile_${field.key}_${option.value}`);
            if (input) input.checked = values.includes(option.value);
          });
          return;
        }

        const input = document.getElementById(`gpProfile_${field.key}`);
        if (!input) return;
        if (field.type === "toggle") {
          input.checked = Boolean(getProfileFieldValue(profile, field.key));
        } else {
          input.value = getProfileFieldValue(profile, field.key) || "";
        }
      });
    });
  }

  function updatePortalUploadPreview() {
    const input = document.getElementById("gpProfilePhotos");
    const list = document.getElementById("gpProfilePhotoList");
    if (!list) return;
    const files = Array.from(input && input.files ? input.files : []);
    list.innerHTML = files.length
      ? files.map((file) => `<span class="gp-profile-upload-chip">${escapeHtml(file.name)}</span>`).join("")
      : "";
  }

  function collectPortalProfileForm() {
    const seminar = blankSeminarData();
    CLIENT_PROFILE_SCHEMA.forEach((section) => {
      section.fields.forEach((field) => {
        if (field.type === "multicheck") {
          seminar[field.key] = field.options
            .filter((option) => {
              const input = document.getElementById(`gpProfile_${field.key}_${option.value}`);
              return input && input.checked;
            })
            .map((option) => option.value);
          return;
        }

        const input = document.getElementById(`gpProfile_${field.key}`);
        if (!input) return;
        seminar[field.key] = field.type === "toggle" ? input.checked : String(input.value || "").trim();
      });
    });
    return seminar;
  }

  async function syncProfileAttachments(context, files) {
    if (typeof CLIENTE_TASK_ID === "undefined" || !CLIENTE_TASK_ID || !files.length) return;
    for (const file of files) {
      const formData = new FormData();
      formData.append("attachment", file, file.name);

      const response = await fetch(`https://api.clickup.com/api/v2/task/${CLIENTE_TASK_ID}/attachment`, {
        method: "POST",
        headers: {
          Authorization: typeof CU_API_KEY !== "undefined" ? CU_API_KEY : "",
        },
        body: formData,
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.err || `Erro ${response.status} ao enviar foto do formulário.`);
      }
    }
  }

  function renderPortalExtraAssignees(primaryEmployee, activeEmployees) {
    const wrapper = document.getElementById("gpExtraAssignees");
    const list = document.getElementById("gpExtraAssigneeList");
    if (!wrapper || !list) return;

    const extras = activeEmployees.filter((employee) => employee !== primaryEmployee);
    wrapper.hidden = extras.length === 0;
    if (!extras.length) {
      list.innerHTML = "";
      return;
    }

    list.innerHTML = extras.map((employee) => `
      <label class="gp-collab-chip" for="gpExtraAssignee_${makeDomSafeId(employee)}">
        <input type="checkbox" id="gpExtraAssignee_${makeDomSafeId(employee)}" class="gp-extra-assignee" value="${escapeHtml(employee)}" />
        <span>${escapeHtml(formatEmployeeName(employee))}</span>
      </label>
    `).join("");
  }

  function refreshPortalSubmissionGate(activeServices, profile) {
    const submitButton = document.getElementById("btnSubmit");
    const monthlyMeta = getMonthlyProfileMeta(profile);
    const gate = document.getElementById("gpProfileMonthlyGate");
    const hasActiveServices = activeServices.length > 0;
    let gateMessage = "";
    let gateClassName = "gp-profile-gate";
    let shouldDisable = !hasActiveServices;

    if (!hasActiveServices) {
      gateMessage = "Seu portal está sem serviços ativos no momento. Fale com a equipe para reativar a carteira antes de abrir novos chamados.";
      gateClassName += " blocked";
    } else if (profile && profile.billingStatus === "canceled") {
      gateMessage = "Sua assinatura está encerrada. Novos chamados ficam bloqueados até a equipe reativar o contrato.";
      gateClassName += " blocked";
      shouldDisable = true;
    } else if (monthlyMeta.due) {
      gateMessage = "Seu formulário mensal está pendente. Você ainda pode enviar chamados, mas recomendamos atualizar esse formulário.";
      gateClassName += " pending";
    } else if (profile && profile.billingStatus === "late") {
      gateMessage = "Sua assinatura está marcada como atrasada. O portal segue ativo, mas a equipe financeira já foi sinalizada.";
      gateClassName += " late";
    }

    if (submitButton) {
      submitButton.disabled = shouldDisable;
    }

    if (gate) {
      gate.hidden = !gateMessage;
      gate.className = gateClassName;
      gate.textContent = gateMessage;
    }
  }

  function applyPortalContractBindings() {
    if (!document.getElementById("mainForm")) return;

    const context = getClientContext();
    if (!context.slug) return;
    ensurePortalProfileUI(context);
    const profile = getClientProfile(context.slug);

    const autoMap = getPortalAutoMap();
    const assigneeIds = getPortalAssigneeIds();
    const assigneeTypeById = getPortalAssigneeTypeById();
    const tipoOptions = getPortalTipoOptions();
    const typeController = getOrCreateSelectController("tipoSelect", "tipoServico", "dropTipo", "Selecionar opção...");
    const providerController = getOrCreateSelectController("prestadorSelect", "prestador", "dropPrestador", "Selecionar opção...");
    const autofillBadge = document.getElementById("autofillBadge");
    const submitButton = document.getElementById("btnSubmit");

    if (!autoMap || !assigneeIds || !assigneeTypeById || !tipoOptions || !typeController || !providerController) {
      return;
    }

    Object.assign(assigneeIds, GLOBAL_ASSIGNEE_IDS);

    const client = getClientContract(context.slug);
    const activeServices = client
      ? client.services.filter((service) => service.status !== "canceled")
      : [];
    const assignmentMap = activeServices.reduce((map, item) => {
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

    const serviceNames = Object.keys(assignmentMap);
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

  async function refreshPortalStateInBackground() {
    if (state.portalRefreshBusy || !document.getElementById("mainForm")) {
      return;
    }

    const context = getClientContext();
    if (!context.slug) {
      return;
    }

    state.portalRefreshBusy = true;
    try {
      await init({ force: true, silent: true });
      applyPortalContractBindings();
    } catch (error) {
      // Keep the portal usable even if the background refresh fails temporarily.
    } finally {
      state.portalRefreshBusy = false;
    }
  }

  function startPortalLiveRefresh() {
    if (state.portalRefreshBound || !document.getElementById("mainForm")) {
      return;
    }

    state.portalRefreshBound = true;
    state.portalRefreshTimer = window.setInterval(() => {
      if (!document.hidden) {
        refreshPortalStateInBackground();
      }
    }, 30000);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        refreshPortalStateInBackground();
      }
    });

    window.addEventListener("focus", () => {
      refreshPortalStateInBackground();
    });
  }

  function bootPortalContracts() {
    applyPortalContractBindings();
    hydratePortalTipoOptions();
    init({ silent: true });
    startPortalLiveRefresh();
  }

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
      updatedAt: new Date().toISOString()
    });
  }

  function getSelectedTaskAssignees() {
    return Array.from(document.querySelectorAll(".gp-extra-assignee:checked"))
      .map((input) => normalizeEntityName(input.value))
      .map((employee) => GLOBAL_ASSIGNEE_IDS[employee])
      .filter(Boolean);
  }

  bootPortalContracts();

  window.PortalInsights = {
    init,
    getContracts,
    getClientProfiles,
    getClientProfile,
    getClientProfileSchema() {
      return clone(CLIENT_PROFILE_SCHEMA);
    },
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
})();
