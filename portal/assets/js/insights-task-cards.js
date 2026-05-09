/**
 * insights-task-cards.js — Task card enhancement, progress track, area filtering.
 */

import { state } from "./insights-state.js";
import { escapeHtml, normalizeEntityName } from "./insights-utils.js";
import { normalizeServiceName, formatServiceName, resolveContractEmployee } from "./insights-contracts.js";
import { getTaskReviewState } from "./insights-task-state.js";
import { getTaskRevisionKey } from "./insights-ratings.js";
import { openReviewModal } from "./insights-review-modal.js";
import { openRatingModal } from "./insights-rating-modal.js";

// ── Task area helpers ─────────────────────────────────────────────────────────

export function getTaskAreaKey(task) {
  return normalizeServiceName(task.tipo || task.service || "");
}

export function getTaskAreaLabel(task) {
  const areaKey = getTaskAreaKey(task);
  return areaKey ? formatServiceName(areaKey) : "Área não informada";
}

// ── Progress markup ───────────────────────────────────────────────────────────

export function buildTaskProgressMarkup(reviewState) {
  const steps = ["Solicitado", "Em andamento", "Sua revisão", "Finalizado"];
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

// ── Task payload builder ──────────────────────────────────────────────────────

export function buildTaskPayload(rawTask, context) {
  const service  = normalizeServiceName(rawTask.tipo || rawTask.service || "");
  const employee = resolveContractEmployee(context && context.slug, service, rawTask.prestador || rawTask.employee || "");
  return {
    id:          String(rawTask.id),
    name:        String(rawTask.name || ""),
    status:      String(rawTask.status || "").toLowerCase(),
    statusLabel: String(rawTask.statusLabel || rawTask.status || ""),
    service,
    employee,
    createdAt:   rawTask.createdAt  || null,
    resolvedAt:  rawTask.resolvedAt || null,
    revisionKey: getTaskRevisionKey(rawTask),
    url:         rawTask.url || ""
  };
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

export function getTaskCardById(taskId) {
  const taskButton = Array.from(document.querySelectorAll(".btn-chat[data-task-id]"))
    .find((button) => button.dataset.taskId === String(taskId));
  return taskButton ? taskButton.closest(".chamado-item") : null;
}

// ── Area filters ──────────────────────────────────────────────────────────────

export function ensureAreaFilters(tasks) {
  const statusFilters = document.getElementById("statusFilters");
  if (!statusFilters || !statusFilters.parentElement) return null;

  let wrapper = document.getElementById("gpAreaFilters");
  if (!wrapper) {
    wrapper           = document.createElement("div");
    wrapper.id        = "gpAreaFilters";
    wrapper.className = "gp-area-filters";
    statusFilters.insertAdjacentElement("afterend", wrapper);
  }

  const uniqueAreas = Array.from(new Map(
    tasks
      .map((task) => [getTaskAreaKey(task), getTaskAreaLabel(task)])
      .filter(([key]) => key)
  ).entries()).sort((l, r) => l[1].localeCompare(r[1], "pt-BR"));

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

export function applyTaskAreaFilter(tasks) {
  const list  = document.getElementById("chamadosList");
  const count = document.getElementById("chamadosCount");
  if (!list || !count) return;

  const cards = Array.from(list.querySelectorAll(".chamado-item"));
  let visibleCount = 0;
  cards.forEach((card) => {
    const areaKey = card.dataset.areaKey || "";
    const visible  = state.currentAreaFilter === "all" || areaKey === state.currentAreaFilter;
    card.hidden    = !visible;
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
    empty           = document.createElement("div");
    empty.id        = "gpAreaEmpty";
    empty.className = "chamados-empty";
    empty.hidden    = true;
    empty.innerHTML = `<div class="empty-icon">🎯</div>Nenhum chamado encontrado nessa área.`;
    list.appendChild(empty);
  }
  empty.hidden = visibleCount > 0;
}

// ── Card decoration ───────────────────────────────────────────────────────────

export function decorateTaskCard(rawTask, context) {
  const task        = buildTaskPayload(rawTask, context);
  const reviewState = getTaskReviewState(task);
  const card        = getTaskCardById(task.id);
  if (!card) return;

  const areaKey   = getTaskAreaKey(rawTask);
  const areaLabel = getTaskAreaLabel(rawTask);
  card.dataset.areaKey = areaKey;

  const meta = card.querySelector(".chamado-meta");
  if (meta) {
    let areaTag = meta.querySelector(".gp-area-tag");
    if (!areaTag) {
      areaTag = Array.from(meta.querySelectorAll(".chamado-tag")).find((tag) => (
        !tag.classList.contains("priority-urgent") &&
        !tag.classList.contains("priority-normal")
      ));
    }
    if (!areaTag) {
      areaTag           = document.createElement("span");
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
    footer           = document.createElement("div");
    footer.className = "gp-task-review-box";
    card.appendChild(footer);
  }

  if (task.status !== "resolvido") {
    footer.hidden    = true;
    footer.innerHTML = "";
    return;
  }

  footer.hidden    = false;
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

export function enhanceTaskCards(tasks, context) {
  const count = document.getElementById("chamadosCount");
  if (count) count.dataset.statusCount = count.textContent || "—";

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
