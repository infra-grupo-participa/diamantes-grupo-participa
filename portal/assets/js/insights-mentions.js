/**
 * insights-mentions.js — Chat @mention UI and autocomplete.
 */

import { state } from "./insights-state.js";
import { escapeHtml, normalizeSearchKey, uniqueValues } from "./insights-utils.js";
import { getClientContract, getKnownEmployees, formatEmployeeName } from "./insights-contracts.js";

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function getMentionCandidates(context) {
  const client          = context && context.slug ? getClientContract(context.slug) : null;
  const activeEmployees = client
    ? client.services.filter((service) => service.status !== "canceled").map((service) => service.employee)
    : [];
  const pool = activeEmployees.length ? activeEmployees : Array.from(getKnownEmployees());
  return uniqueValues(pool)
    .map((employee) => ({
      value:  employee,
      label:  formatEmployeeName(employee),
      search: normalizeSearchKey(employee)
    }))
    .sort((l, r) => l.label.localeCompare(r.label, "pt-BR"));
}

// ── DOM installation ──────────────────────────────────────────────────────────

export function installChatMentionUI(context) {
  const form  = document.getElementById("chatForm");
  const input = document.getElementById("chatInput");
  if (!form || !input) return;

  if (!state.chatMention) {
    state.chatMention = { candidates: [], activeIndex: 0, matchStart: -1 };
  }
  state.chatMention.candidates = getMentionCandidates(context);

  let box = document.getElementById("gpChatMentionBox");
  if (!box) {
    box           = document.createElement("div");
    box.id        = "gpChatMentionBox";
    box.className = "gp-chat-mentions";
    box.hidden    = true;
    form.appendChild(box);
  }

  if (state.chatMentionReady) return;
  state.chatMentionReady = true;
  form.classList.add("gp-chat-form");

  const closeMentionBox = () => {
    box.hidden                    = true;
    box.innerHTML                 = "";
    state.chatMention.activeIndex = 0;
    state.chatMention.matchStart  = -1;
  };

  const findMentionMatch = () => {
    const caret  = input.selectionStart || 0;
    const before = input.value.slice(0, caret);
    const match  = before.match(/(?:^|\s)@([^\n]*)$/);
    if (!match) return null;
    const rawQuery = match[1] || "";
    const start    = caret - rawQuery.length - 1;
    return { start, query: normalizeSearchKey(rawQuery) };
  };

  const applyMentionSelection = (candidate) => {
    const match = findMentionMatch();
    if (!match) return;
    const caret     = input.selectionStart || 0;
    input.value     = `${input.value.slice(0, match.start)}@${candidate.label} ${input.value.slice(caret)}`;
    const nextCaret = match.start + candidate.label.length + 2;
    input.selectionStart = nextCaret;
    input.selectionEnd   = nextCaret;
    input.focus();
    closeMentionBox();
  };

  const renderMentionSuggestions = () => {
    const match = findMentionMatch();
    if (!match) { closeMentionBox(); return; }

    const candidates = state.chatMention.candidates
      .filter((candidate) => !match.query || candidate.search.includes(match.query))
      .slice(0, 6);

    if (!candidates.length) { closeMentionBox(); return; }

    state.chatMention.matchStart  = match.start;
    state.chatMention.activeIndex = Math.min(state.chatMention.activeIndex, candidates.length - 1);
    box.hidden    = false;
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
    if (event.key === "Escape") closeMentionBox();
  });

  document.addEventListener("click", (event) => {
    if (!form.contains(event.target)) closeMentionBox();
  });
}
