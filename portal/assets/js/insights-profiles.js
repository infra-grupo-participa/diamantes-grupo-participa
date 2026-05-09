/**
 * insights-profiles.js — Client profile forms, seminars, billing UI.
 */

import { CLIENT_PROFILES_KEY, CLIENT_PROFILE_SCHEMA, state } from "./insights-state.js";
import {
  escapeHtml,
  formatProfileDate,
  formatProfileDateTime,
  makeDomSafeId,
  uniqueValues
} from "./insights-utils.js";
import {
  blankClientProfile,
  blankSeminarData,
  normalizeClientProfile,
  getContractsSource,
  getClientProfile,
  getClientProfiles,
  getClientContract,
  formatClientName,
  formatEmployeeName,
  getBillingStatusMeta,
  getProfileFieldValue
} from "./insights-contracts.js";
import { apiRequest } from "./insights-api.js";

// ── Billing & monthly profile meta ──────────────────────────────────────────

export function hasMonthlyProfileResponse(profile) {
  const seminar = profile && profile.seminar ? profile.seminar : blankSeminarData();
  return Object.values(seminar).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "boolean") return value === true;
    return String(value ?? "").trim() !== "";
  });
}

export function getMonthlyProfileMeta(profile) {
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
    title:       !answered
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

export function getProfilePreviewItems(profile) {
  const seminar = profile && profile.seminar ? profile.seminar : blankSeminarData();
  return [
    ["Instagram",          seminar.instagram],
    ["Site",               seminar.siteUrl],
    ["Drive",              seminar.driveUrl],
    ["Página de captura",  seminar.capturePageUrl],
    ["Próximo seminário",  formatProfileDate(seminar.seminarDay1Date)],
    ["Pitch",              formatProfileDate(seminar.pitchDate)],
    ["Região",             seminar.targetRegion],
    ["Meta de leads",      seminar.targetLeads],
    ["Ferramenta de e-mail", seminar.emailMarketingTool],
    ["Construtor de páginas", seminar.pageBuilder],
    ["API do WhatsApp",    seminar.whatsappApiEnabled ? (seminar.whatsappApiTool || "Sim") : "Não"],
  ].filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    return String(value || "").trim() && value !== "—";
  });
}

// ── API: save client profile ─────────────────────────────────────────────────

export async function saveClientProfile(clientSlug, payload) {
  const slug = String(clientSlug || "").trim();
  if (!slug) throw new Error("Cliente obrigatório.");

  const response = await apiRequest("save_client_profile", {
    method: "POST",
    body:   { clientSlug: slug, ...payload }
  });

  state.store[CLIENT_PROFILES_KEY] = {
    ...getClientProfiles(),
    [slug]: normalizeClientProfile(
      slug,
      response.profile || payload,
      response.profile?.name || payload.name || slug
    ),
  };

  return state.store[CLIENT_PROFILES_KEY][slug];
}

// ── Profile form rendering ────────────────────────────────────────────────────

export function renderProfileField(field, prefix) {
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

export function renderProfileSections(prefix) {
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

// ── Form fill / collect ───────────────────────────────────────────────────────

export function fillPortalProfileForm(profile) {
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

export function collectPortalProfileForm() {
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

export function updatePortalUploadPreview() {
  const input = document.getElementById("gpProfilePhotos");
  const list  = document.getElementById("gpProfilePhotoList");
  if (!list) return;
  const files = Array.from(input && input.files ? input.files : []);
  list.innerHTML = files.length
    ? files.map((file) => `<span class="gp-profile-upload-chip">${escapeHtml(file.name)}</span>`).join("")
    : "";
}

export async function syncProfileAttachments(context, files) {
  if (typeof CLIENTE_TASK_ID === "undefined" || !CLIENTE_TASK_ID || !files.length) return;
  // FIX (pentest HIGH): rota via proxy server-side. CSRF token + auth são tratados pelo PHP.
  const clientSlug = typeof CLIENTE_SLUG !== "undefined" ? CLIENTE_SLUG : "";
  for (const file of files) {
    const formData = new FormData();
    formData.append("clientSlug", clientSlug);
    formData.append("method", "POST");
    formData.append("path", `task/${CLIENTE_TASK_ID}/attachment`);
    formData.append("attachment", file, file.name);

    const response = await fetch("/api/clickup.php", {
      method: "POST",
      credentials: "same-origin",
      body: formData,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.err || payload?.error || `Erro ${response.status} ao enviar foto do formulário.`);
    }
  }
}

// ── Profile summary rendering ─────────────────────────────────────────────────

export function renderPortalProfileSummary(context, profile) {
  const summary      = document.getElementById("gpProfileSummary");
  const preview      = document.getElementById("gpProfilePreview");
  const driveShortcut = document.getElementById("gpDriveShortcut");
  const gate         = document.getElementById("gpProfileMonthlyGate");
  const ctaButton    = document.getElementById("gpOpenProfileModal");
  if (!summary || !gate) return;

  const billingMeta  = getBillingStatusMeta(profile.billingStatus);
  const monthlyMeta  = getMonthlyProfileMeta(profile);
  const previewItems = getProfilePreviewItems(profile);
  const driveUrl     = String(profile && profile.seminar && profile.seminar.driveUrl || "").trim();

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

// ── Submission gate ───────────────────────────────────────────────────────────

export function refreshPortalSubmissionGate(activeServices, profile) {
  const submitButton  = document.getElementById("btnSubmit");
  const monthlyMeta   = getMonthlyProfileMeta(profile);
  const gate          = document.getElementById("gpProfileMonthlyGate");
  const hasActiveServices = activeServices.length > 0;
  let gateMessage  = "";
  let gateClassName = "gp-profile-gate";
  let shouldDisable = !hasActiveServices;

  if (!hasActiveServices) {
    gateMessage    = "Seu portal está sem serviços ativos no momento. Fale com a equipe para reativar a carteira antes de abrir novos chamados.";
    gateClassName += " blocked";
  } else if (profile && profile.billingStatus === "canceled") {
    gateMessage    = "Sua assinatura está encerrada. Novos chamados ficam bloqueados até a equipe reativar o contrato.";
    gateClassName += " blocked";
    shouldDisable  = true;
  } else if (monthlyMeta.due) {
    gateMessage    = "Seu formulário mensal está pendente. Você ainda pode enviar chamados, mas recomendamos atualizar esse formulário.";
    gateClassName += " pending";
  } else if (profile && profile.billingStatus === "late") {
    gateMessage    = "Sua assinatura está marcada como atrasada. O portal segue ativo, mas a equipe financeira já foi sinalizada.";
    gateClassName += " late";
  }

  if (submitButton) submitButton.disabled = shouldDisable;

  if (gate) {
    gate.hidden    = !gateMessage;
    gate.className  = gateClassName;
    gate.textContent = gateMessage;
  }
}

// ── Extra assignees ────────────────────────────────────────────────────────────

export function renderPortalExtraAssignees(primaryEmployee, activeEmployees) {
  const wrapper = document.getElementById("gpExtraAssignees");
  const list    = document.getElementById("gpExtraAssigneeList");
  if (!wrapper || !list) return;

  const extras = activeEmployees.filter((employee) => employee !== primaryEmployee);
  wrapper.hidden = extras.length === 0;
  if (!extras.length) { list.innerHTML = ""; return; }

  list.innerHTML = extras.map((employee) => `
    <label class="gp-collab-chip" for="gpExtraAssignee_${makeDomSafeId(employee)}">
      <input type="checkbox" id="gpExtraAssignee_${makeDomSafeId(employee)}" class="gp-extra-assignee" value="${escapeHtml(employee)}" />
      <span>${escapeHtml(formatEmployeeName(employee))}</span>
    </label>
  `).join("");
}

// ── Opening task uploads ───────────────────────────────────────────────────────

export function getOpeningTaskFileKey(file) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

export function getOpeningTaskFiles() {
  return [...state.openingTaskFiles];
}

export function renderOpeningTaskFiles() {
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

export function addOpeningTaskFiles(files) {
  const known = new Set(state.openingTaskFiles.map(getOpeningTaskFileKey));
  files.forEach((file) => {
    const key = getOpeningTaskFileKey(file);
    if (known.has(key)) return;
    state.openingTaskFiles.push(file);
    known.add(key);
  });
  renderOpeningTaskFiles();
}

export function clearOpeningTaskFiles() {
  state.openingTaskFiles = [];
  const images    = document.getElementById("gpOpeningImages");
  const documents = document.getElementById("gpOpeningDocuments");
  if (images)    images.value    = "";
  if (documents) documents.value = "";
  renderOpeningTaskFiles();
}

export function ensureOpeningTaskUploadUI(mainForm) {
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

// ── Portal profile main UI ─────────────────────────────────────────────────────

export function ensurePortalProfileUI(context, { applyPortalContractBindings } = {}) {
  const mainForm  = document.getElementById("mainForm");
  const novoPanel = document.getElementById("panel-novo");
  if (!mainForm || !novoPanel) return;

  // CSS is now served via portal/assets/css/portal-base.css (linked in <head>).
  const portalCard = document.querySelector(".card");
  if (portalCard) portalCard.classList.add("gp-portal-card");

  if (!document.getElementById("gpPortalSplit")) {
    const split = document.createElement("div");
    split.id        = "gpPortalSplit";
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
    modal.id        = "gpProfileModal";
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
      if (event.target === modal) modal.classList.remove("show");
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
        if (typeof applyPortalContractBindings === "function") applyPortalContractBindings();
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
    wrapper.id        = "gpExtraAssignees";
    wrapper.hidden    = true;
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
