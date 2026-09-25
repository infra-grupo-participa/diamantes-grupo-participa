-- 2026-09-24-cadastrar-ramon.sql
-- Script avulso (NÃO é migration numerada — não entra no fluxo `supabase db push`).
-- Passo 4 do plano [[Diamantes - Plano definitivo de atribuicao de responsaveis
-- (24-09-2026)]] · decisão do Marcio 24/09 ([[2026-09-24 - Diamantes - 4 decisoes]]):
-- Ramon Waltz passa a ser cadastrado em portal.operators.
--
-- Motivo: aparece como assignee real em 9 demandas no ClickUp (clickup_user_id
-- 234063256) mas nunca teve cadastro no portal — essas 9 ficam 'external' para
-- sempre e "Aceitar estado do ClickUp" dá RAISE nelas (admin_resolve_assignee_
-- divergence exige casamento de ID ANTES do DELETE, ver migration 086).
--
-- Dados confirmados no ClickUp em 24/09/2026:
--   clickup_user_id = 234063256
--   nome            = Ramon Waltz
--   e-mail          = ramon@advmais.com
--   cargo           = Editor de Vídeo — aparece nas tasks "[EV] [CRIAÇÃO] Reels"
--                      (EV = Editor de Vídeo). position_id copiado tal como fornecido
--                      pelo plano (NÃO gerado aqui — UUID de cargo já existente em
--                      portal.positions; não inventar valor diferente, ver
--                      04 Sistemas/Erros comuns e antidotos de codigo.md).
--
-- Colunas conferidas em portal.operators (migration 016_operator_clickup_only.sql):
--   NOT NULL sem default: name
--   NOT NULL com default: contract_active (true), status ('active'),
--                          metadata ('{}'), points_score (0)
--   nullable: email, position_id (FK portal.positions ON DELETE SET NULL),
--             clickup_user_id
--   clickup_notifiable (migration 087): NOT NULL DEFAULT true — Ramon é member real
--   (não guest) no ClickUp, então o default já é o valor correto; setado explícito
--   abaixo por clareza/auditoria, não por necessidade.
-- Sem FK para portal.users — operators é tabela própria desde a 016 ("Operadores
-- deixam de ter acesso autenticado ao sistema"), não exige linha correspondente ali.
--
-- Idempotente: WHERE NOT EXISTS por clickup_user_id (chave natural da pessoa no
-- ClickUp). Até a migration 092_operators_clickup_user_id_unique não existia UNIQUE
-- nessa coluna (achado de pentest, 24/09) — por isso o idempotente é feito aqui via
-- NOT EXISTS, não confiado a ON CONFLICT (que exige a constraint). Rodar este script
-- DEPOIS da 092 aplicada: se a 092 aplicar limpo (sem duplicata hoje, conforme
-- confirmado pelo coordenador), este INSERT concorrente já fica coberto pela
-- constraint como segunda trava; se este script rodar antes da 092, o NOT EXISTS
-- ainda garante idempotência isolada, só não protege contra corrida concorrente.

INSERT INTO portal.operators (
  name,
  email,
  position_id,
  clickup_user_id,
  contract_active,
  status,
  clickup_notifiable
)
SELECT
  'Ramon Waltz',
  'ramon@advmais.com',
  'a8041677-f736-424d-a284-217ddafab355', -- Editor de Vídeo (id fornecido pelo plano)
  '234063256',
  true,
  'active',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM portal.operators WHERE clickup_user_id = '234063256'
);

-- Conferência pós-insert (rodar manualmente, não faz parte do script):
--   SELECT id, name, email, position_id, clickup_user_id, contract_active, status,
--          clickup_notifiable
--     FROM portal.operators WHERE clickup_user_id = '234063256';
--   SELECT id, name FROM portal.positions WHERE id = 'a8041677-f736-424d-a284-217ddafab355';
--     (confirmar que o id realmente aponta para o cargo "Editor de Vídeo" antes de
--      aplicar — este executor não teve acesso ao banco para validar o UUID.)
