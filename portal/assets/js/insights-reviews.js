/**
 * insights-reviews.js — Task review storage, retrieval, and persistence.
 */

import { TASK_REVIEWS_KEY } from "./insights-state.js";
import { readJson, writeJson } from "./insights-utils.js";
import { normalizeServiceName, resolveContractEmployee } from "./insights-contracts.js";
import { getTaskRevisionKey } from "./insights-ratings.js";
import { apiRequest } from "./insights-api.js";

// ── Reviews store ─────────────────────────────────────────────────────────────

export function getTaskReviews() {
  const stored = readJson(TASK_REVIEWS_KEY, []);
  if (!Array.isArray(stored)) return [];

  let changed = false;
  const reviews = stored
    .map((review) => {
      const clientSlug = String(review.clientSlug || "").trim();
      const service    = normalizeServiceName(review.service || "");
      const employee   = resolveContractEmployee(clientSlug, service, review.employee || "");
      const next = {
        ...review,
        clientSlug,
        service,
        employee,
        status:      review.status === "changes_requested" ? "changes_requested" : "approved",
        revisionKey: String(review.revisionKey || review.resolvedAt || "").trim()
      };

      if (
        next.clientSlug   !== review.clientSlug ||
        next.service      !== review.service    ||
        next.employee     !== review.employee   ||
        next.revisionKey  !== String(review.revisionKey || review.resolvedAt || "").trim()
      ) {
        changed = true;
      }
      return next;
    })
    .filter((review) => String(review.taskId || "").trim());

  if (reviews.length !== stored.length) changed = true;
  if (changed) writeJson(TASK_REVIEWS_KEY, reviews);

  return reviews;
}

export function getTaskReview(taskId, revisionKey) {
  const normalizedTaskId      = String(taskId || "").trim();
  const normalizedRevisionKey = getTaskRevisionKey(revisionKey);
  return getTaskReviews().find((review) => (
    review.taskId === normalizedTaskId &&
    (!normalizedRevisionKey || String(review.revisionKey || "").trim() === normalizedRevisionKey)
  )) || null;
}

export async function saveTaskReview(record) {
  const clientSlug  = String(record.clientSlug || "").trim();
  if (!clientSlug) throw new Error("Cliente obrigatório.");

  const service    = normalizeServiceName(record.service || "");
  const employee   = resolveContractEmployee(clientSlug, service, record.employee || "");
  const revisionKey = getTaskRevisionKey(record);
  const response   = await apiRequest("save_task_review", {
    method: "POST",
    body: {
      taskId:      String(record.taskId || ""),
      taskName:    String(record.taskName || ""),
      clientSlug,
      clientName:  String(record.clientName || ""),
      service,
      employee,
      status:      record.status === "changes_requested" ? "changes_requested" : "approved",
      notes:       String(record.notes || "").trim(),
      resolvedAt:  record.resolvedAt || null,
      revisionKey,
      url:         record.url || "",
    }
  });

  const next = response.review || {
    taskId:      String(record.taskId || ""),
    taskName:    String(record.taskName || ""),
    clientSlug,
    clientName:  String(record.clientName || ""),
    service,
    employee,
    status:      record.status === "changes_requested" ? "changes_requested" : "approved",
    notes:       String(record.notes || "").trim(),
    resolvedAt:  record.resolvedAt || null,
    revisionKey,
    url:         record.url || "",
    submittedAt: new Date().toISOString()
  };

  const reviews = getTaskReviews().filter((review) => (
    review.taskId !== next.taskId ||
    String(review.revisionKey || "").trim() !== String(next.revisionKey || "").trim()
  ));
  reviews.push(next);
  writeJson(TASK_REVIEWS_KEY, reviews);
  return next;
}
