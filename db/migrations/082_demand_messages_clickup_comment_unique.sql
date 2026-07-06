-- 082 — Blinda a dedupe de comentários do ClickUp contra corrida.
-- clickup-comment-sync posta no ClickUp e só depois grava o clickup_comment_id;
-- se o webhook taskCommentPosted chegar antes, o check-then-insert aplicacional
-- não acha o cid e insere uma linha duplicada (mensagem aparece 2x pro cliente).
-- Índice único parcial garante idempotência no banco (o insert reverso passa a
-- falhar por conflito em vez de duplicar).
create unique index if not exists demand_messages_clickup_comment_id_key
  on portal.demand_messages (clickup_comment_id)
  where clickup_comment_id is not null;
