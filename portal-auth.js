(function () {
  const scriptUrl = document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : window.location.href;
  const appRootUrl = new URL("./", scriptUrl);
  const authApiUrl = new URL("api/auth.php", appRootUrl).href;
  const usersApiUrl = new URL("api/users.php", appRootUrl).href;
  const clickupProxyUrl = new URL("api/clickup.php", appRootUrl).href;
  const clickupBasePrefix = "https://api.clickup.com/api/v2";

  const clientRoutes = [
    { slug: "alessandro-lima", label: "Alessandro Lima", path: "alessandro-lima/index.html" },
    { slug: "anthony-sodre", label: "Anthony Sodré", path: "anthony-sodre/index.html" },
    { slug: "bartira-paes", label: "Bartira Paes", path: "bartira-paes/index.html" },
    { slug: "bernadete", label: "Bernadete", path: "bernadete/index.html" },
    { slug: "bruno-couto", label: "Bruno Couto", path: "bruno-couto/index.html" },
    { slug: "claudia-kellner", label: "Claudia Kellner", path: "claudia-kellner/index.html" },
    { slug: "deyse-engel", label: "Deyse Engel", path: "deyse-engel/index.html" },
    { slug: "fabiana-parro", label: "Fabiana Parro", path: "fabiana-parro/index.html" },
    { slug: "isabela-teixeira", label: "Isabela Teixeira", path: "isabela-teixeira/index.html" },
    { slug: "felipe-schroeder", label: "Felipe Schroeder", path: "felipe-schroeder/index.html" },
    { slug: "fernanda-lessa", label: "Fernanda Lessa", path: "fernanda-lessa/index.html" },
    { slug: "joao-carlos-lima", label: "João Carlos Lima", path: "joao-carlos-lima/index.html" },
    { slug: "joao-eduardo-zanela", label: "João Eduardo Zanela", path: "joao-eduardo-zanela/index.html" },
    { slug: "katia-paixao", label: "Katia Paixão", path: "katia-paixao/index.html" },
    { slug: "luciano-simionato", label: "Luciano Simionato", path: "luciano-simionato/index.html" },
    { slug: "luis-rocha", label: "Luís Rocha", path: "luis-rocha/index.html" },
    { slug: "matheus-borges", label: "Matheus Borges", path: "matheus-borges/index.html" },
    { slug: "nairio", label: "Naírio", path: "nairio/index.html" },
    { slug: "osvaldo-catena", label: "Osvaldo Catena", path: "osvaldo-catena/index.html" },
    { slug: "paulo-guaraciaba", label: "Paulo Guaraciaba", path: "paulo-guaraciaba/index.html" },
    { slug: "pedro-nery", label: "Pedro Nery", path: "pedro-nery/index.html" },
    { slug: "priscila-ziliani", label: "Priscila Ziliani", path: "priscila-ziliani/index.html" },
    { slug: "rafael-molino", label: "Rafael Molino", path: "rafael-molino/index.html" },
    { slug: "roberto-gaspar", label: "Roberto Gaspar", path: "roberto-gaspar/index.html" },
    { slug: "suely-resende", label: "Suely Resende", path: "suely-resende/index.html" },
    { slug: "vitor-negrao", label: "Vitor Negrão", path: "vitor-negrao/index.html" },
    { slug: "willian-loro", label: "Willian Loro", path: "willian-loro/index.html" }
  ];

  const state = {
    users: [],
    usersLoaded: false,
    sessionUser: null,
    clientRoutes: clone(clientRoutes),
    initPromise: null,
    initialized: false,
    csrfToken: "",
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function toAppUrl(path) {
    return new URL(path.replace(/^\.\//, ""), appRootUrl).href;
  }

  function getCurrentPortalSlug() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    if (!parts.length) return "";
    const last = decodeURIComponent(parts[parts.length - 1]);
    if (last.toLowerCase() === "index.html") {
      return parts.length > 1 ? decodeURIComponent(parts[parts.length - 2]) : "";
    }
    return last.includes(".") ? "" : last;
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeIdentifier(value) {
    return normalizeEmail(value).replace(/\s+/g, "");
  }

  function digitsOnly(value, maxLength = 11) {
    return String(value || "").replace(/\D+/g, "").slice(0, maxLength);
  }

  function normalizeDocumentType(value) {
    return value === "cnpj" ? "cnpj" : "cpf";
  }

  function getDocumentLength(type) {
    return normalizeDocumentType(type) === "cnpj" ? 14 : 11;
  }

  function normalizeDocumentValue(type, value) {
    return digitsOnly(value, getDocumentLength(type));
  }

  function inferDocumentType(value, fallback = "cpf") {
    const digits = String(value || "").replace(/\D+/g, "");
    if (digits.length === 14) return "cnpj";
    if (digits.length === 11) return "cpf";
    return normalizeDocumentType(fallback);
  }

  function formatDocument(value, type) {
    const documentType = inferDocumentType(value, type);
    const digits = normalizeDocumentValue(documentType, value);
    if (documentType === "cnpj") {
      const part1 = digits.slice(0, 2);
      const part2 = digits.slice(2, 5);
      const part3 = digits.slice(5, 8);
      const part4 = digits.slice(8, 12);
      const part5 = digits.slice(12, 14);
      let formatted = part1;
      if (part2) formatted += `.${part2}`;
      if (part3) formatted += `.${part3}`;
      if (part4) formatted += `/${part4}`;
      if (part5) formatted += `-${part5}`;
      return formatted;
    }

    const parts = [];
    if (digits.slice(0, 3)) parts.push(digits.slice(0, 3));
    if (digits.slice(3, 6)) parts.push(digits.slice(3, 6));
    if (digits.slice(6, 9)) parts.push(digits.slice(6, 9));
    const suffix = digits.slice(9, 11);
    return `${parts.slice(0, 3).join(".")}${suffix ? `-${suffix}` : ""}`;
  }

  function getUserDocument(user) {
    const storedValue = String(user && (user.documentValue || user.cpf) || "");
    const type = inferDocumentType(storedValue, user && user.documentType || "cpf");
    return {
      type,
      value: normalizeDocumentValue(type, storedValue)
    };
  }

  async function fetchCsrfToken() {
    try {
      const response = await window.fetch(new URL("api/csrf.php", appRootUrl).href, {
        method: "GET",
        credentials: "same-origin",
      });
      const data = await response.json().catch(() => null);
      if (data && data.csrfToken) {
        state.csrfToken = String(data.csrfToken);
      }
    } catch (_) {
      // Best-effort — server will reject mutating requests if token is missing.
    }
  }

  function getCsrfToken() {
    return state.csrfToken;
  }

  async function apiRequest(url, options) {
    const settings = options || {};
    const headers = new Headers(settings.headers || {});
    const method = (settings.method || "GET").toUpperCase();

    // Attach CSRF token for state-changing requests.
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && state.csrfToken) {
      headers.set("X-CSRF-Token", state.csrfToken);
    }

    const init = {
      method,
      credentials: "same-origin",
      headers,
    };

    if (settings.body instanceof FormData) {
      init.body = settings.body;
    } else if (Object.prototype.hasOwnProperty.call(settings, "body")) {
      headers.set("Content-Type", "application/json");
      init.body = JSON.stringify(settings.body);
    }

    const response = await window.fetch(url, init);
    const data = await response.json().catch(() => null);

    // Capture updated csrfToken from any response.
    if (data && data.csrfToken) {
      state.csrfToken = String(data.csrfToken);
    }

    if (!response.ok || !data || data.ok === false) {
      throw new Error(data && data.error ? data.error : `Erro ${response.status}`);
    }

    return data;
  }

  function updateCachedUser(user) {
    if (!user || !user.id) return;

    const index = state.users.findIndex((item) => item.id === user.id);
    if (index === -1) {
      state.users.push(clone(user));
    } else {
      state.users[index] = clone(user);
    }

    if (state.sessionUser && state.sessionUser.id === user.id) {
      state.sessionUser = clone(user);
    }
  }

  async function init(options) {
    const settings = options || {};
    const includeUsers = settings.includeUsers === true;
    const force = settings.force === true;

    if (state.initPromise && !force) {
      return state.initPromise;
    }

    if (state.initialized && !force && (!includeUsers || state.usersLoaded)) {
      return {
        sessionUser: getSessionUser(),
        users: includeUsers ? getUsers() : [],
      };
    }

    state.initPromise = apiRequest(
      `${authApiUrl}?action=bootstrap${includeUsers ? "&includeUsers=1" : ""}`,
      { method: "GET" }
    ).then(async (payload) => {
      state.sessionUser = payload.sessionUser ? clone(payload.sessionUser) : null;
      if (Array.isArray(payload.clientRoutes) && payload.clientRoutes.length) {
        state.clientRoutes = clone(payload.clientRoutes);
      }
      if (includeUsers) {
        state.users = Array.isArray(payload.users) ? clone(payload.users) : [];
        state.usersLoaded = true;
      }
      state.initialized = true;
      // Fetch CSRF token whenever we have an active session.
      if (state.sessionUser && !state.csrfToken) {
        await fetchCsrfToken();
      }
      return payload;
    }).finally(() => {
      state.initPromise = null;
    });

    return state.initPromise;
  }

  function getClientRoutes() {
    return clone(state.clientRoutes);
  }

  function getClientRouteBySlug(slug) {
    return state.clientRoutes.find((route) => route.slug === slug) || null;
  }

  function getClientUrl(slug) {
    const route = getClientRouteBySlug(slug);
    return route ? toAppUrl(route.path) : toAppUrl("index.html");
  }

  function getUsers() {
    return clone(state.users);
  }

  function getUserById(userId) {
    const user = state.users.find((item) => item.id === userId)
      || (state.sessionUser && state.sessionUser.id === userId ? state.sessionUser : null);
    return user ? clone(user) : null;
  }

  function getSession() {
    if (!state.sessionUser) return null;
    return {
      userId: state.sessionUser.id,
      role: state.sessionUser.role,
      email: state.sessionUser.email,
    };
  }

  function getSessionUser() {
    return state.sessionUser ? clone(state.sessionUser) : null;
  }

  function normalizeMentionKey(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function getMentionEntries() {
    const source = typeof ASSIGNEE_IDS !== "undefined" && ASSIGNEE_IDS && typeof ASSIGNEE_IDS === "object"
      ? ASSIGNEE_IDS
      : {};

    return Object.entries(source)
      .map(([name, id]) => ({
        id: Number(id),
        name: String(name || "").trim(),
        key: normalizeMentionKey(name)
      }))
      .filter((entry) => entry.id && entry.name && entry.key)
      .sort((left, right) => right.name.length - left.name.length);
  }

  function isMentionBoundary(char) {
    return !char || /\s|[.,!?;:()[\]{}"'`/\\-]/u.test(char);
  }

  function buildClickUpCommentBody(commentText) {
    const text = String(commentText || "");
    const mentionEntries = getMentionEntries();
    if (!text.includes("@") || !mentionEntries.length) {
      return { comment_text: text };
    }

    const pieces = [];
    const pushText = (value) => {
      if (!value) return;
      const last = pieces[pieces.length - 1];
      if (last && Object.prototype.hasOwnProperty.call(last, "text") && !last.type) {
        last.text += value;
      } else {
        pieces.push({ text: value });
      }
    };

    let cursor = 0;
    let matchedAny = false;

    while (cursor < text.length) {
      const atIndex = text.indexOf("@", cursor);
      if (atIndex === -1) {
        pushText(text.slice(cursor));
        break;
      }

      const previousChar = atIndex > 0 ? text.charAt(atIndex - 1) : "";
      if (previousChar && !/\s|[(\[{]/u.test(previousChar)) {
        pushText(text.slice(cursor, atIndex + 1));
        cursor = atIndex + 1;
        continue;
      }

      pushText(text.slice(cursor, atIndex));

      let matchedEntry = null;
      let matchedName = "";

      for (const entry of mentionEntries) {
        const candidate = text.slice(atIndex + 1, atIndex + 1 + entry.name.length);
        if (normalizeMentionKey(candidate) !== entry.key) continue;

        const nextChar = text.charAt(atIndex + 1 + candidate.length);
        if (!isMentionBoundary(nextChar)) continue;

        matchedEntry = entry;
        matchedName = candidate;
        break;
      }

      if (!matchedEntry) {
        pushText("@");
        cursor = atIndex + 1;
        continue;
      }

      matchedAny = true;
      pieces.push({
        type: "tag",
        user: {
          id: matchedEntry.id
        }
      });

      cursor = atIndex + 1 + matchedName.length;
    }

    return matchedAny ? { comment: pieces } : { comment_text: text };
  }

  async function uploadOpeningTaskFiles(nativeFetch, clientSlug, taskId) {
    const helper = window.PortalInsights;
    const getFiles = helper && typeof helper.getOpeningTaskFiles === "function"
      ? helper.getOpeningTaskFiles
      : null;
    const clearFiles = helper && typeof helper.clearOpeningTaskFiles === "function"
      ? helper.clearOpeningTaskFiles
      : null;

    const files = getFiles ? getFiles() : [];
    if (!Array.isArray(files) || !files.length || !taskId) {
      if (clearFiles) clearFiles();
      return;
    }

    const uploadedFiles = [];

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("method", "POST");
        formData.append("path", `/task/${taskId}/attachment`);
        if (clientSlug) formData.append("clientSlug", clientSlug);
        formData.append("attachment", file, file.name);

        const uploadResponse = await proxyClickUpRequest(nativeFetch, {
          method: "POST",
          credentials: "same-origin",
          body: formData,
        }, `/task/${taskId}/attachment`);

        const uploadPayload = await uploadResponse.json().catch(() => null);
        if (!uploadResponse.ok) {
          throw new Error(uploadPayload && (uploadPayload.error || uploadPayload.err) ? (uploadPayload.error || uploadPayload.err) : `Erro ${uploadResponse.status} ao anexar arquivo.`);
        }

        uploadedFiles.push(uploadPayload);
      }

      if (uploadedFiles.length) {
        const clientPrefix = typeof CLIENT_COMMENT_PREFIX !== "undefined" ? CLIENT_COMMENT_PREFIX : "";
        const note = `${clientPrefix}Arquivos enviados na abertura: ${uploadedFiles.map((file) => file.title || file.name || "arquivo").join(", ")}`;
        await proxyClickUpRequest(nativeFetch, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            method: "POST",
            path: `/task/${taskId}/comment`,
            clientSlug,
            body: {
              comment_text: note,
            },
          }),
        }, `/task/${taskId}/comment`).catch(() => null);
      }
    } finally {
      if (clearFiles) clearFiles();
    }
  }

  async function handleClickUpProxyResponse(response, path) {
    if (response.ok || (response.status !== 401 && response.status !== 403)) {
      return response;
    }

    let message = response.status === 401
      ? "❌ Credencial do ClickUp inválida ou expirada."
      : "❌ Credencial do ClickUp sem acesso a este workspace ou recurso.";

    const payload = await response.clone().json().catch(() => null);
    const backendMessage = payload && (payload.error || payload.err || payload.message);
    if (backendMessage) {
      message = String(backendMessage);
    }

    const now = Date.now();
    if (
      typeof window.showToast === "function"
      && (
        window.__gpClickUpAuthToastMessage !== message
        || !window.__gpClickUpAuthToastAt
        || (now - window.__gpClickUpAuthToastAt) > 8000
      )
    ) {
      window.__gpClickUpAuthToastMessage = message;
      window.__gpClickUpAuthToastAt = now;
      window.showToast(message, true);
    }

    window.__gpLastClickUpProxyError = {
      status: response.status,
      path: String(path || ""),
      message,
      at: new Date(now).toISOString(),
    };

    return response;
  }

  function proxyClickUpRequest(nativeFetch, init, path) {
    return nativeFetch(clickupProxyUrl, init).then((response) => handleClickUpProxyResponse(response, path));
  }

  function validateRegistrationInput(data) {
    const name = String(data.name || "").trim();
    const email = normalizeEmail(data.email);
    const password = String(data.password || "");
    const documentType = normalizeDocumentType(data.documentType);
    const documentValue = normalizeDocumentValue(documentType, data.documentValue || data.document || data.cpf);
    const documentLabel = documentType === "cnpj" ? "CNPJ" : "CPF";

    if (!name) throw new Error("Informe seu nome.");
    if (!email || !email.includes("@")) throw new Error("Informe um email válido.");
    if (password.length < 8) throw new Error("A senha precisa ter no mínimo 8 caracteres.");
    if (documentValue.length !== getDocumentLength(documentType)) {
      throw new Error(`Informe um ${documentLabel} válido com ${getDocumentLength(documentType)} dígitos.`);
    }

    return { name, email, password, documentType, documentValue };
  }

  async function createPendingUser(data, options) {
    const input = validateRegistrationInput(data);
    const shouldCreateSession = !(options && options.setSession === false);
    const payload = await apiRequest(`${authApiUrl}?action=register`, {
      method: "POST",
      body: {
        ...input,
        setSession: shouldCreateSession,
      }
    });

    const user = payload.user ? clone(payload.user) : null;
    if (user) {
      updateCachedUser(user);
      if (shouldCreateSession) {
        state.sessionUser = clone(user);
      }
    }

    return user;
  }

  async function updateUser(userId, patch) {
    const payload = await apiRequest(`${usersApiUrl}?action=update`, {
      method: "POST",
      body: {
        userId,
        patch,
      }
    });

    if (payload.user) {
      updateCachedUser(payload.user);
    }

    return payload.user ? clone(payload.user) : null;
  }

  async function login(identifier, password) {
    // Fetch a CSRF token before login (session may not exist yet).
    // The login endpoint accepts the token from the bootstrap session if any,
    // or the server issues a new one and returns it in the response.
    if (!state.csrfToken) {
      await fetchCsrfToken().catch(() => null);
    }

    const payload = await apiRequest(`${authApiUrl}?action=login`, {
      method: "POST",
      body: {
        identifier: String(identifier || ""),
        password: String(password || ""),
      }
    });

    if (payload.csrfToken) {
      state.csrfToken = String(payload.csrfToken);
    }

    const user = payload.user ? clone(payload.user) : null;
    state.sessionUser = user;

    if (!user) {
      throw new Error("Sessão inválida.");
    }

    if (user.role === "admin") {
      return { status: "admin", user, redirect: toAppUrl("admin/index.html") };
    }

    if (user.status === "approved") {
      if (user.clientSlug) {
        return { status: "approved", user, redirect: getClientUrl(user.clientSlug) };
      }
      return { status: "pending", user, redirect: null };
    }

    return { status: user.status || "pending", user, redirect: null };
  }

  async function logout(options) {
    const settings = options || {};
    try {
      await apiRequest(`${authApiUrl}?action=logout`, {
        method: "POST",
        body: {},
      });
    } catch (error) {
      // Keep the local state consistent even if the server session is already gone.
    }

    state.sessionUser = null;
    state.csrfToken = "";
    state.users = [];
    state.usersLoaded = false;
    state.initialized = false;

    if (settings.redirect !== false) {
      window.location.href = toAppUrl("index.html");
    }
  }

  async function clearSession() {
    await logout({ redirect: false });
  }

  function installClickUpProxy() {
    if (window.__gpClickUpProxyInstalled) return;
    window.__gpClickUpProxyInstalled = true;

    const nativeFetch = window.fetch.bind(window);

    window.fetch = function (input, init) {
      const request = input instanceof Request ? input : null;
      const url = typeof input === "string"
        ? input
        : request
          ? request.url
          : String(input || "");

      if (!url.startsWith(clickupBasePrefix)) {
        return nativeFetch(input, init);
      }

      const sourceUrl = new URL(url);
      const method = String((init && init.method) || (request && request.method) || "GET").toUpperCase();
      const clientSlug = getCurrentPortalSlug();
      const path = `${sourceUrl.pathname.replace(/^\/api\/v2/, "")}${sourceUrl.search}`;

      const sourceBody = init && Object.prototype.hasOwnProperty.call(init, "body")
        ? init.body
        : null;

      if (sourceBody instanceof FormData) {
        const formData = new FormData();
        formData.append("method", method);
        formData.append("path", path);
        if (clientSlug) formData.append("clientSlug", clientSlug);
        sourceBody.forEach((value, key) => {
          formData.append(key, value);
        });
        return proxyClickUpRequest(nativeFetch, {
          method: "POST",
          credentials: "same-origin",
          body: formData,
        }, path);
      }

      let body = null;
      if (sourceBody != null) {
        if (typeof sourceBody === "string") {
          try {
            body = JSON.parse(sourceBody);
          } catch {
            body = sourceBody;
          }
        } else {
          body = sourceBody;
        }
      }

      const isTaskCommentRequest = method === "POST" && /^\/task\/[^/]+\/comment(?:\?|$)/.test(path);
      if (
        isTaskCommentRequest
        && body
        && typeof body === "object"
        && !Array.isArray(body)
        && typeof body.comment_text === "string"
        && !Array.isArray(body.comment)
      ) {
        const nextCommentBody = buildClickUpCommentBody(body.comment_text);
        body = {
          ...body,
          ...nextCommentBody,
        };
        if (Object.prototype.hasOwnProperty.call(nextCommentBody, "comment")) {
          delete body.comment_text;
        }
      }

      const isCreateTaskRequest = method === "POST" && /^\/list\/[^/]+\/task(?:\?|$)/.test(path);
      let requestedAssignees = [];
      const helper = window.PortalInsights;
      if (isCreateTaskRequest && body && typeof body === "object" && !Array.isArray(body)) {
        const extraAssignees = helper && typeof helper.getSelectedTaskAssignees === "function"
          ? helper.getSelectedTaskAssignees()
          : [];
        requestedAssignees = Array.from(new Set([
          ...(Array.isArray(body.assignees) ? body.assignees : []),
          ...extraAssignees,
        ].filter(Boolean)));
        body = {
          ...body,
          assignees: requestedAssignees
        };
      }

      const dispatchRequest = () => proxyClickUpRequest(nativeFetch, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          method,
          path,
          clientSlug,
          body,
        }),
      }, path);

      const prepareCreateTaskRequest = async () => {
        if (!isCreateTaskRequest || !body || typeof body !== "object" || Array.isArray(body)) {
          return;
        }

        if (helper && typeof helper.ensurePortalTipoOptions === "function") {
          await helper.ensurePortalTipoOptions().catch(() => null);
        }

        const customFields = Array.isArray(body.custom_fields) ? [...body.custom_fields] : [];
        const hasTipoField = customFields.some((field) => String(field && field.id || "") === String(typeof CF_TIPO_ID !== "undefined" ? CF_TIPO_ID : ""));
        const description = String(body.description || "");
        const typeMatch = description.match(/Tipo de Serviço:\s*([^\n]+)/i);
        const selectedType = typeMatch ? String(typeMatch[1] || "").trim() : "";
        const tipoOptions = typeof CF_TIPO_OPTIONS !== "undefined" && CF_TIPO_OPTIONS ? CF_TIPO_OPTIONS : null;
        const tipoFieldId = typeof CF_TIPO_ID !== "undefined" ? String(CF_TIPO_ID || "").trim() : "";
        const resolvedTipoOptionId = selectedType && tipoOptions ? tipoOptions[selectedType] : null;

        if (!hasTipoField && tipoFieldId && resolvedTipoOptionId) {
          customFields.unshift({ id: tipoFieldId, value: resolvedTipoOptionId });
          body = {
            ...body,
            custom_fields: customFields,
            description: description.replace(/^Tipo de Serviço:\s*[^\n]+\nPrestador:\s*[^\n]+\n\n?/i, ""),
          };
        }
      };

      const requestPromise = isCreateTaskRequest
        ? prepareCreateTaskRequest().then(dispatchRequest)
        : dispatchRequest();

      if (!isCreateTaskRequest) {
        return requestPromise;
      }

      return requestPromise.then(async (response) => {
        try {
          const payload = await response.clone().json().catch(() => null);
          const taskId = String(payload && payload.id || "").trim();
          if (!response.ok || !taskId) {
            return response;
          }

          const currentAssignees = Array.isArray(payload.assignees)
            ? payload.assignees.map((assignee) => String(assignee && assignee.id || "")).filter(Boolean)
            : [];

          const missingAssignees = requestedAssignees
            .map((assigneeId) => String(assigneeId))
            .filter((assigneeId) => !currentAssignees.includes(assigneeId));

          if (missingAssignees.length) {
            await Promise.all(missingAssignees.map((assigneeId) => proxyClickUpRequest(nativeFetch, {
              method: "POST",
              credentials: "same-origin",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                method: "POST",
                path: `/task/${taskId}/assignee/${assigneeId}`,
                clientSlug,
              }),
            }, `/task/${taskId}/assignee/${assigneeId}`).catch(() => null)));
          }

          await uploadOpeningTaskFiles(nativeFetch, clientSlug, taskId);
        } catch (error) {
          if (typeof window.showToast === "function") {
            window.showToast("⚠️ Chamado criado, mas houve falha ao reforçar responsáveis ou anexar arquivos.", true);
          }
        }

        return response;
      });
    };
  }

  installClickUpProxy();

  window.PortalAuth = {
    init,
    ensureSeed: init,
    getUsers,
    getUserById,
    getSession,
    getSessionUser,
    clearSession,
    createPendingUser,
    updateUser,
    login,
    logout,
    normalizeEmail,
    normalizeIdentifier,
    digitsOnly,
    formatDocument,
    getUserDocument,
    getClientRoutes,
    getClientRouteBySlug,
    getClientUrl,
    toAppUrl,
    getCsrfToken,
    fetchCsrfToken,
  };
})();
