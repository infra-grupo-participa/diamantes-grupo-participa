/**
 * insights-ratings.js — Rating storage, retrieval, metadata, and persistence.
 */

import { RATINGS_KEY, TASK_REVIEWS_KEY, SCORE_META } from "./insights-state.js";
import { clone, readJson, writeJson } from "./insights-utils.js";
import { normalizeServiceName, resolveContractEmployee } from "./insights-contracts.js";
import { apiRequest } from "./insights-api.js";

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function getRatingMeta(score) {
  const numeric = Number(score || 0);
  return SCORE_META.find((item) => numeric >= item.min && numeric <= item.max) || null;
}

export function getTaskRevisionKey(taskOrRevisionKey) {
  if (taskOrRevisionKey && typeof taskOrRevisionKey === "object") {
    return String(
      taskOrRevisionKey.revisionKey ||
      taskOrRevisionKey.resolvedAt  ||
      taskOrRevisionKey.createdAt   ||
      ""
    ).trim();
  }
  return String(taskOrRevisionKey || "").trim();
}

// ── Ratings store ─────────────────────────────────────────────────────────────

export function getRatings() {
  const stored = readJson(RATINGS_KEY, []);
  if (!Array.isArray(stored)) return [];

  let changed = false;
  const ratings = stored
    .map((rating) => {
      const clientSlug = String(rating.clientSlug || "").trim();
      const service    = normalizeServiceName(rating.service || "");
      const employee   = resolveContractEmployee(clientSlug, service, rating.employee || "");
      const next = { ...rating, clientSlug, service, employee };

      if (
        next.clientSlug !== rating.clientSlug ||
        next.service    !== rating.service    ||
        next.employee   !== rating.employee
      ) {
        changed = true;
      }
      return next;
    })
    .filter((rating) => String(rating.taskId || "").trim());

  if (ratings.length !== stored.length) changed = true;
  if (changed) writeJson(RATINGS_KEY, ratings);

  return ratings;
}

export function getTaskRating(taskId, revisionKey) {
  const normalizedTaskId     = String(taskId || "").trim();
  const normalizedRevisionKey = getTaskRevisionKey(revisionKey);
  return getRatings().find((rating) => (
    rating.taskId === normalizedTaskId &&
    (!normalizedRevisionKey || String(rating.resolvedAt || "").trim() === normalizedRevisionKey)
  )) || null;
}

export async function saveRating(record) {
  const score = Number(record.score);
  if (!Number.isFinite(score) || score < 1 || score > 10) {
    throw new Error("Nota inválida.");
  }

  const clientSlug = String(record.clientSlug || "").trim();
  const service    = normalizeServiceName(record.service || "");
  const employee   = resolveContractEmployee(clientSlug, service, record.employee || "");
  const payload    = await apiRequest("save_rating", {
    method: "POST",
    body: {
      taskId:      String(record.taskId),
      taskName:    String(record.taskName  || ""),
      clientSlug,
      clientName:  String(record.clientName || ""),
      service,
      employee,
      score,
      resolvedAt:  record.resolvedAt || null,
      revisionKey: getTaskRevisionKey(record),
      url:         record.url || "",
    }
  });

  const next = payload.rating || {
    taskId:      String(record.taskId),
    taskName:    String(record.taskName  || ""),
    clientSlug,
    clientName:  String(record.clientName || ""),
    service,
    employee,
    score,
    label:       getRatingMeta(score)?.label || "",
    resolvedAt:  record.resolvedAt || null,
    revisionKey: getTaskRevisionKey(record),
    url:         record.url || "",
    submittedAt: new Date().toISOString()
  };

  const ratings = getRatings().filter((r) => r.taskId !== next.taskId);
  ratings.push(next);
  writeJson(RATINGS_KEY, ratings);

  // Auto-approve review on rating submit
  const nextReview = {
    taskId:      next.taskId,
    taskName:    next.taskName,
    clientSlug,
    clientName:  next.clientName,
    service,
    employee,
    status:      "approved",
    notes:       "",
    resolvedAt:  next.resolvedAt || null,
    revisionKey: getTaskRevisionKey(next),
    url:         next.url || "",
    submittedAt: next.submittedAt,
  };
  const reviews = getTaskReviewsRaw().filter((review) => (
    review.taskId !== nextReview.taskId ||
    String(review.revisionKey || "").trim() !== String(nextReview.revisionKey || "").trim()
  ));
  reviews.push(nextReview);
  writeJson(TASK_REVIEWS_KEY, reviews);

  return next;
}

// Re-export raw task reviews read (reviews module imports saveRating so we
// keep a local reader here to avoid circular import with insights-reviews.js)
function getTaskReviewsRaw() {
  const stored = readJson(TASK_REVIEWS_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((review) => String(review.taskId || "").trim());
}
