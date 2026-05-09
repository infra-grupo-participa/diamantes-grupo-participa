/**
 * insights-rating-modal.js — Rating modal UI.
 *
 * CSS is now in portal/assets/css/insights-modals.css (linked via <link>).
 */

import { SCORE_META, state } from "./insights-state.js";
import { escapeHtml } from "./insights-utils.js";
import { formatClientName, formatEmployeeName, formatServiceName } from "./insights-contracts.js";
import { getRatingMeta, saveRating } from "./insights-ratings.js";

export function ensureModal() {
  if (state.modalReady) return;
  state.modalReady = true;

  const modal = document.createElement("div");
  modal.className = "rating-modal";
  modal.id        = "serviceRatingModal";
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
              <span>${
                item.label === "Péssimo"   ? "Entrega muito abaixo do esperado." :
                item.label === "Ruim"      ? "Resultado abaixo do ideal."        :
                item.label === "Razoável"  ? "Cumpriu o básico."                 :
                item.label === "Bom"       ? "Entrega consistente e positiva."   :
                                             "Entrega de alto nível."
              }</span>
            </div>
          `).join("")}
        </div>
        <div class="rating-grid" id="serviceRatingGrid">
          ${Array.from({ length: 10 }, (_, i) =>
            `<button type="button" class="rating-score" data-score="${i + 1}">${i + 1}</button>`
          ).join("")}
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
        taskId:     task.id,
        taskName:   task.name,
        clientSlug: state.context.slug,
        clientName: state.context.name,
        service:    task.service,
        employee:   task.employee,
        score:      selectedScore,
        resolvedAt: task.resolvedAt,
        url:        task.url
      });

      if (typeof window.showToast === "function") {
        window.showToast(`✅ Avaliação enviada: nota ${selectedScore}.`);
      }

      state.pendingQueue = state.pendingQueue.filter((item) => item.id !== task.id);
      state.activeTaskId = null;
      selectedScore      = null;
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

export function openRatingModal(task, context) {
  ensureModal();
  state.activeTaskId = task.id;
  state.context      = context;
  const modal = document.getElementById("serviceRatingModal");
  const chips = [
    `<span class="rating-chip">${formatClientName(context.name)}</span>`,
    task.service  ? `<span class="rating-chip">${formatServiceName(task.service)}</span>` : "",
    task.employee ? `<span class="rating-chip">${formatEmployeeName(task.employee)}</span>` : "",
    task.name     ? `<span class="rating-chip">${escapeHtml(task.name)}</span>` : ""
  ].filter(Boolean).join("");
  modal.querySelector("#serviceRatingTask").innerHTML = chips;
  modal.classList.add("show");
}
