-- 092_operators_clickup_user_id_unique
-- Achado do pentest (Kirad, MÉDIO) no lote da 091_apply_clickup_assignees: a 016
-- criou portal.operators.clickup_user_id SEM UNIQUE. A 091 (decisão 4 do Marcio,
-- "ClickUp manda" em troca member→member) resolve identidade casando pelo
-- clickup_user_id do assignee que chega no webhook contra portal.operators — com
-- duplicata, a validação (RAISE se sobrar operador sem casar) PASSA mesmo casando
-- o operador ERRADO para aquele ID, porque encontra "alguma" linha que bate. O
-- índice não impede a causa (duplicata pode nascer por cadastro manual divergente),
-- mas transforma o estado inconsistente em falha explícita na escrita, antes que
-- chegue a produzir um casamento silenciosamente errado.
--
-- Coordenador confirmou em 24/09/2026 que não há duplicata hoje em
-- portal.operators.clickup_user_id — não há dado a reconciliar antes de aplicar.
-- Se isso mudou entre a confirmação e a aplicação, o CREATE UNIQUE INDEX FALHA
-- (é o comportamento desejado: falhar alto é melhor que aplicar sobre duplicata
-- silenciosa). Antes de aplicar, reconferir:
--   select clickup_user_id, count(*), array_agg(id) as operator_ids
--     from portal.operators
--    where clickup_user_id is not null
--    group by clickup_user_id
--   having count(*) > 1;
-- (esperado: 0 linhas)
--
-- Índice PARCIAL (WHERE clickup_user_id IS NOT NULL) — múltiplos operadores sem
-- clickup_user_id (NULL) continuam permitidos, coerente com a coluna nullable
-- desde a 016 (operador ainda não vinculado ao ClickUp).
--
-- Aplicar via `supabase db push` ou MCP apply_migration
-- name=092_operators_clickup_user_id_unique. Esta cópia em arquivo é a fonte da
-- verdade versionada.

CREATE UNIQUE INDEX IF NOT EXISTS uq_operators_clickup_user_id
  ON portal.operators (clickup_user_id)
  WHERE clickup_user_id IS NOT NULL;

COMMENT ON INDEX portal.uq_operators_clickup_user_id IS
  'Unicidade de clickup_user_id (parcial, ignora NULL). Fecha achado do pentest de
   24/09/2026: sem este índice, duplicata em clickup_user_id faz a 091
   (apply_clickup_assignees, reconciliação automática member→member do webhook)
   casar 2 operadores para o mesmo ID e passar na validação (RAISE só dispara se
   NENHUM operador casar, não se casar o errado). Ver 092_down.sql para reversão.';

-- EXPLAIN não aplicável (DDL de índice, não query de leitura) — verificação é o
-- SELECT de duplicata acima, não plano de execução.
