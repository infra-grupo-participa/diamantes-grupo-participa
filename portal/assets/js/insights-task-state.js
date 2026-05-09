/**
 * insights-task-state.js — Task review state machine (pure, no DOM).
 *
 * Resolves which "stage" a task is in based on its review and rating status.
 */

import { getTaskReview } from "./insights-reviews.js";
import { getTaskRating } from "./insights-ratings.js";

export function getTaskReviewState(task) {
  const review = getTaskReview(task.id, task.revisionKey);
  const rating = getTaskRating(task.id, task.revisionKey);

  if (task.status !== "resolvido") {
    return {
      review,
      rating,
      stage:        task.status === "em resolução" ? "in_progress" : "open",
      progressIndex: task.status === "em resolução" ? 1 : 0,
      footerTone:   "",
      footerTitle:  "",
      footerCopy:   "",
    };
  }

  if (rating) {
    return {
      review,
      rating,
      stage:         "rated",
      progressIndex: 3,
      footerTone:    "approved",
      footerTitle:   "Entrega aprovada e avaliada",
      footerCopy:    `Nota registrada: ${rating.score}/10.`,
    };
  }

  if (review && review.status === "approved") {
    return {
      review,
      rating,
      stage:         "approved",
      progressIndex: 3,
      footerTone:    "approved",
      footerTitle:   "Entrega aprovada",
      footerCopy:    "Falta apenas registrar a avaliação final dessa entrega.",
    };
  }

  if (review && review.status === "changes_requested") {
    return {
      review,
      rating,
      stage:         "changes_requested",
      progressIndex: 2,
      footerTone:    "warning",
      footerTitle:   "Ajustes solicitados",
      footerCopy:    review.notes || "A equipe foi avisada de que essa entrega precisa de ajustes.",
    };
  }

  return {
    review,
    rating,
    stage:         "awaiting_review",
    progressIndex: 2,
    footerTone:    "pending",
    footerTitle:   "Aguardando sua revisão",
    footerCopy:    "Confira a entrega antes de concluir com a avaliação.",
  };
}
