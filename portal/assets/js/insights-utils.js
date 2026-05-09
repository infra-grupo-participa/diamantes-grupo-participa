/**
 * insights-utils.js — Pure utility helpers.
 *
 * All functions are stateless/pure (no DOM, no fetch, no localStorage
 * except readJson/writeJson which delegate to the state store).
 */

import { state, CLIENT_CONTEXT_KEY } from "./insights-state.js";

// ── Deep clone ──────────────────────────────────────────────────────────────

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// ── Store read / write ──────────────────────────────────────────────────────

export function readJson(key, fallback) {
  if (key === CLIENT_CONTEXT_KEY) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return clone(fallback);
      return JSON.parse(raw);
    } catch (_) {
      return clone(fallback);
    }
  }

  try {
    const value = state.store[key];
    if (value == null) return clone(fallback);
    return clone(value);
  } catch (_) {
    return clone(fallback);
  }
}

export function writeJson(key, value) {
  if (key === CLIENT_CONTEXT_KEY) {
    window.localStorage.setItem(key, JSON.stringify(value));
    return;
  }
  state.store[key] = clone(value);
}

// ── String helpers ──────────────────────────────────────────────────────────

export function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function normalizeEntityName(value) {
  return String(value || "").trim().toLocaleUpperCase("pt-BR");
}

export function normalizeServiceName(value) {
  const normalized = normalizeEntityName(value);
  if (normalized === "DESENVOLVEDOR WEB") return "WEBDESIGNER";
  if (normalized === "COPY")              return "COPYWRITER";
  if (normalized === "EDIÇÃO")            return "EDIÇÃO DE VÍDEO";
  return normalized;
}

export function humanizeText(value) {
  return String(value || "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\b\p{L}/gu, (char) => char.toLocaleUpperCase("pt-BR"));
}

export function normalizeSearchKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

export function normalizeOptionLabel(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("pt-BR");
}

export function makeDomSafeId(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_");
}

export function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

// ── Format helpers ──────────────────────────────────────────────────────────

export function formatProfileDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day:   "2-digit",
    month: "2-digit",
    year:  "numeric"
  }).format(date);
}

export function formatProfileDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day:    "2-digit",
    month:  "2-digit",
    year:   "numeric",
    hour:   "2-digit",
    minute: "2-digit"
  }).format(date);
}

// ── Math ────────────────────────────────────────────────────────────────────

export function average(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

export function roundOne(value) {
  return value == null ? null : Math.round(value * 10) / 10;
}
