/**
 * insights-review-modal.js — Review modal UI: approve / request changes flows.
 *
 * CSS is in portal/assets/css/insights-modals.css.
 */

import { state } from "./insights-state.js";
import { escapeHtml } from "./insights-utils.js";
import { formatClientName, formatEmployeeName, formatServiceName } from "./insights-contracts.js";
import { saveTaskReview } from "./insights-reviews.js";
import { openRatingModal } from "./insights-rating-modal.js";

async function postPortalTaskComment(taskId, message) {
  // FIX (pentest HIGH): rota via proxy server-side em vez de chamar api.clickup.com direto.
  const clientSlug = typeof CLIENTE_SLUG !== "undefined" ? CLIENTE_SLUG : "";
  const prefix = typeof CLIENT_COMMENT_PREFIX !== "undefined" ? CLIENT_COMMENT_PREFIX : "";
  const response = await fetch("/api/clickup.php", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "POST",
      path: `task/${taskId}/comment`,
      clientSlug,
      body: { comment_text: `${prefix}${String(message || "").trim()}` },
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.err || payload?.error || `Erro ${response.status} ao enviar comentário.`);
  }
  return payload;
}

async function refreshPortalTaskList() {
  if (typeof loadChamados !== "function") return;
  await loadChamados({ silent: true });
}

export function ensureReviewModal() {
  if (state.reviewModalReady) return;
  state.reviewModalReady = true;

  const modal = document.createElement("div");
  modal.className = "gp-review-modal";
  modal.id        = "gpTaskReviewModal";
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
            <button type="button" class="gp-review-later"   id="gpTaskReviewLater">Agora não</button>
            <button type="button" class="gp-review-request" id="gpTaskReviewRequest">Pedir ajuste</button>
            <button type="button" class="gp-review-approve" id="gpTaskReviewApprove">Aprovar e avaliar</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector("#gpTaskReviewLater").addEventListener("click", () => {
    modal.classList.remove("show");
    state.activeReviewTaskId = null;
    state.reviewTask         = null;
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
        taskId:      task.id,
        taskName:    task.name,
        clientSlug:  state.context.slug,
        clientName:  state.context.name,
        service:     task.service,
        employee:    task.employee,
        status:      "approved",
        notes:       "",
        resolvedAt:  task.resolvedAt,
        revisionKey: task.revisionKey,
        url:         task.url
      });
      await postPortalTaskComment(task.id, "Entrega revisada e aprovada pelo solicitante.");
      modal.classList.remove("show");
      state.activeReviewTaskId = null;
      state.reviewTask         = null;
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
        taskId:      task.id,
        taskName:    task.name,
        clientSlug:  state.context.slug,
        clientName:  state.context.name,
        service:     task.service,
        employee:    task.employee,
        status:      "changes_requested",
        notes,
        resolvedAt:  task.resolvedAt,
        revisionKey: task.revisionKey,
        url:         task.url
      });
      await postPortalTaskComment(task.id, `Solicitei ajustes nessa entrega.\n\n${notes}`);
      modal.classList.remove("show");
      state.activeReviewTaskId = null;
      state.reviewTask         = null;
      if (typeof window.showToast === "function") {
        window.showToast("✅ Ajustes solicitados para a equipe.");
      }
      await refreshPortalTaskList();
    } catch (error) {
      if (typeof window.showToast === "function") {
        window.showToast(error.message || "❌ Não foi possível solicitar ajustes.", true);
      }
    } finally {
      approveButton.disabled = false;
      requestButton.disabled = false;
    }
  });
}

export function openReviewModal(task, context) {
  ensureReviewModal();
  state.activeReviewTaskId = task.id;
  state.reviewTask         = task;
  state.context            = context;

  const modal = document.getElementById("gpTaskReviewModal");
  const notes = modal.querySelector("#gpTaskReviewNotes");
  if (notes) notes.value = "";

  const chips = [
    `<span class="gp-review-chip">${formatClientName(context.name)}</span>`,
    task.service  ? `<span class="gp-review-chip">${formatServiceName(task.service)}</span>` : "",
    task.employee ? `<span class="gp-review-chip">${formatEmployeeName(task.employee)}</span>` : "",
    task.name     ? `<span class="gp-review-chip">${escapeHtml(task.name)}</span>` : ""
  ].filter(Boolean).join("");

  modal.querySelector("#gpTaskReviewChips").innerHTML = chips;
  modal.classList.add("show");
}
