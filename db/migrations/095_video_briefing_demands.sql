-- 095_video_briefing_demands — briefing obrigatório de EDIÇÃO DE VÍDEO + prazo sugerido
-- (data+hora) remarcável pela equipe NO CLICKUP, refletido no portal com aviso ao cliente.
--
-- NÃO APLICADA. Aplicar só após o veredito (orquestrador). Verificação em produção:
-- db/migrations/095_verificacao.sql (roda tudo e DESFAZ — termina em RAISE, rollback
-- garantido). Reversão: 095_video_briefing_demands_down.sql.
--
-- ── O que muda ──────────────────────────────────────────────────────────────
-- 1. portal.demands ganha o prazo com hora como FONTE DA VERDADE:
--      due_at timestamptz, due_has_time boolean, due_suggested_at timestamptz,
--      due_previous_at timestamptz, due_previous_has_time boolean,
--      due_changed_at timestamptz, due_changed_source text.
--    ends_at (DATE, lido por todo o app) vira DERIVADO, mão única:
--      ends_at = (due_at at time zone 'America/Sao_Paulo')::date  (trigger BEFORE).
--    Nenhum leitor de ends_at muda.
-- 2. CHECK de FORMATO em service_type (slug) — sem subquery (CHECK não aceita, 0A000).
--    A validação contra os tipos CONTRATADOS mora na RPC (admin isento).
-- 3. Funções puras: video_briefing_missing(jsonb) → text[] de chaves faltando/inválidas;
--    video_briefing_markdown(jsonb, timestamptz) → texto do card do ClickUp;
--    add_business_days(date,int) e demand_min_due_date() (2 dias úteis, fuso SP).
-- 4. create_demand: DROP da assinatura da 051 + CREATE com 4 parâmetros novos no FIM,
--    todos com default (o front antigo continua funcionando):
--      p_service_type text, p_briefing jsonb, p_due_at timestamptz, p_due_has_time boolean.
-- 5. apply_clickup_due_change(uuid, timestamptz, boolean, text) — ÚNICA porta de
--    remarcação vinda do ClickUp. SECURITY DEFINER, EXECUTE só service_role.
-- 6. 🔴 Trigger demands_due_guard (achado de segurança do plano): authenticated tem
--    INSERT/UPDATE direto em portal.demands e as policies só olham client_slug — a
--    validação da RPC seria contornável por INSERT direto. A trigger aplica as MESMAS
--    regras a qualquer escrita direta de quem não é admin nem service_role (inclusive
--    tipo contratado), e no UPDATE direto impede alterar due_*, service_type, briefing
--    e as colunas de vínculo/sincronização (clickup_task_id, client_slug, created_by,
--    project_id, finalized_at, last_synced_from_clickup_at, clickup_assignee_*...).
--    status/title/description continuam livres (fora de escopo).
-- 7. demand_messages.origin aceita 'system' (aviso automático de remarcação). O CHECK é
--    reescrito a partir de pg_get_constraintdef (nunca de memória). Cliente só grava
--    origin='portal' (trigger demand_messages_system_guard).
-- 8. messages_clickup_sync ganha WHEN (origin IS DISTINCT FROM 'system') — o aviso
--    automático não vira comentário no ClickUp. Feito na TRIGGER e não no corpo de
--    _sync_message_to_clickup porque o corpo dessa função não está versionado no repo
--    (vive só no remoto) — reescrevê-la de memória apagaria o que não se vê. A trigger
--    é reescrita a partir de pg_get_triggerdef; a definição original fica no COMMENT
--    da trigger (o down lê de lá).
-- 9. demands_clickup_update deixa de reagir a starts_at/ends_at: após a criação o
--    ClickUp é a fonte do prazo; sem isso, a remarcação vinda do ClickUp voltaria para o
--    ClickUp à toa. (Mesma técnica: pg_get_triggerdef + original no COMMENT.)
-- 11. 🔴 get_student_contracted_positions deixa de responder o contrato de OUTRO
--    cliente (IDOR achado pelo front) e perde o EXECUTE herdado de PUBLIC.
-- 10. clickup_config.notify_due_changes = 'on' (default). 'off' → a remarcação só
--    atualiza o prazo, sem mensagem no chat e sem e-mail. Desliga sem deploy.
--
-- ── _process_pending_chat_emails (072) — NÃO alterada, de propósito ──────────
-- A mensagem 'system' nasce com user_id NULL e email_notified_at = now(). O worker faz
-- JOIN (inner) em portal.users por m.user_id e filtra email_notified_at IS NULL: a
-- mensagem system fica fora por DOIS motivos independentes. Reescrever a função
-- inteira para somar um terceiro filtro seria risco sem ganho.
--
-- ── As 5 perguntas ───────────────────────────────────────────────────────────
-- Escala: todo acesso novo é por PK (demands.id) ou pelo índice parcial existente
--   idx_demands_clickup_task_id (webhook). A trigger é O(1) por linha escrita. A
--   varredura diária reaproveita o GET /task que já fazia (0 chamada extra ao ClickUp).
-- Índice: nenhum índice novo; nenhuma expressão de filtro nova sobre coluna indexada.
--   EXPLAIN (ANALYZE) do lookup por clickup_task_id e por id: 095_verificacao.sql (h).
-- Frequência: RPC de prazo roda 1x por evento taskDueDateUpdated / field update com
--   prazo diferente, e ≤100x/dia pela varredura (só quando o prazo difere).
-- Repetição: nenhuma tela nova lendo o banco aqui (o front lê por id).
-- Reversão: notify_due_changes='off' (sem deploy) + 095_..._down.sql.

BEGIN;

-- ── 1. Colunas novas ─────────────────────────────────────────────────────────
ALTER TABLE portal.demands
  ADD COLUMN IF NOT EXISTS due_at                timestamptz,
  ADD COLUMN IF NOT EXISTS due_has_time          boolean,
  ADD COLUMN IF NOT EXISTS due_suggested_at      timestamptz,
  ADD COLUMN IF NOT EXISTS due_previous_at       timestamptz,
  ADD COLUMN IF NOT EXISTS due_previous_has_time boolean,
  ADD COLUMN IF NOT EXISTS due_changed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS due_changed_source    text;

COMMENT ON COLUMN portal.demands.due_at IS
  '095: prazo (fonte da verdade). ends_at = (due_at at time zone America/Sao_Paulo)::date, mantido pela trigger demands_due_guard. Após a criação só muda por portal.apply_clickup_due_change (ClickUp é a fonte).';
COMMENT ON COLUMN portal.demands.due_has_time IS '095: o prazo tem hora (true) ou é só data (false).';
COMMENT ON COLUMN portal.demands.due_suggested_at IS '095: prazo SUGERIDO pelo cliente na criação (imutável).';
COMMENT ON COLUMN portal.demands.due_previous_at IS '095: prazo anterior à última remarcação da equipe.';
COMMENT ON COLUMN portal.demands.due_previous_has_time IS '095: due_has_time do prazo anterior (para exibir "de 28/09 às 18:00").';
COMMENT ON COLUMN portal.demands.due_changed_at IS '095: quando o prazo foi remarcado pela última vez.';
COMMENT ON COLUMN portal.demands.due_changed_source IS '095: origem da última remarcação (webhook | webhook_generic | sweep).';

-- ── 2. CHECK de formato de service_type ──────────────────────────────────────
-- Medido em 25/09: 29 linhas, todas NULL → a validação do ADD CONSTRAINT passa.
-- Slug: minúsculas/dígitos separados por hífen, ≤40 ('editor-video', 'outro', ...).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'portal.demands'::regclass
                    AND conname = 'demands_service_type_format') THEN
    ALTER TABLE portal.demands ADD CONSTRAINT demands_service_type_format
      CHECK (service_type IS NULL
             OR (char_length(service_type) <= 40 AND service_type ~ '^[a-z0-9]+(-[a-z0-9]+)*$'));
  END IF;
END $$;

-- ── 3. Funções puras ─────────────────────────────────────────────────────────

-- Texto do jsonb em `k` é string com btrim entre p_min e p_max caracteres?
CREATE OR REPLACE FUNCTION portal._vb_text_ok(p jsonb, k text, p_min int, p_max int)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT coalesce(jsonb_typeof(p -> k) = 'string'
         AND char_length(btrim(p ->> k)) BETWEEN p_min AND p_max, false);
$$;

-- URL https:// sem espaço, ≤ 2000. Sem < > " ` (kirad #6): a URL é impressa no card
-- como autolink <url> — um '>' dentro dela fecharia o autolink e abriria markdown livre.
CREATE OR REPLACE FUNCTION portal._vb_url_ok(p jsonb, k text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT coalesce(jsonb_typeof(p -> k) = 'string'
         AND char_length(btrim(p ->> k)) <= 2000
         AND btrim(p ->> k) ~* '^https://[^[:space:]<>"`]+$', false);
$$;

-- Briefing só com as chaves conhecidas (kirad #5): chave desconhecida não é gravada.
-- Não-objeto passa como veio (video_briefing_missing reprova).
CREATE OR REPLACE FUNCTION portal.video_briefing_normalize(p jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT CASE WHEN p IS NULL OR jsonb_typeof(p) <> 'object' THEN p
         ELSE coalesce((SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(p) e
                         WHERE e.key IN ('peca','peca_outro','formatos','formato_outro','arquivo',
                                         'material_url','decupagem','direcao_visual','textos_tela',
                                         'entrega_url','assets_url','observacoes')), '{}'::jsonb) END;
$$;

-- Markdown, campo de UMA linha (kirad #6): quebras viram espaço e todo caractere com
-- significado em markdown é escapado com '\' — texto do cliente não vira link,
-- imagem (pixel), título, negrito nem "linha falsa" no card.
CREATE OR REPLACE FUNCTION portal._md_inline(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT regexp_replace(
           btrim(regexp_replace(coalesce(s, ''), '[[:space:]]+', ' ', 'g')),
           '([][\\`*_{}()#+!<>|~-])', '\\\1', 'g');
$$;

-- Markdown, bloco longo (kirad #6): dentro de cerca de código nada é interpretado.
-- Qualquer sequência de 3+ crases vira 2, para o texto não conseguir fechar a cerca.
CREATE OR REPLACE FUNCTION portal._md_block(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT '```' || E'\n' || regexp_replace(btrim(coalesce(s, '')), '`{3,}', '``', 'g') || E'\n' || '```';
$$;

-- Chave opcional presente (não ausente, não null, não string vazia)?
CREATE OR REPLACE FUNCTION portal._vb_present(p jsonb, k text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT coalesce(p ? k AND jsonb_typeof(p -> k) <> 'null'
         AND NOT (jsonb_typeof(p -> k) = 'string' AND btrim(p ->> k) = ''), false);
$$;

-- Lista das chaves do briefing de vídeo faltando/inválidas. Vazio = briefing completo.
-- Chaves iguais às de lib/video-briefing.ts. 'prazo' NÃO é verificada aqui (não fica no
-- jsonb) — quem chama acrescenta. Nunca levanta erro por tipo errado (jsonb_typeof antes
-- de qualquer função de array).
CREATE OR REPLACE FUNCTION portal.video_briefing_missing(p jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO pg_catalog, portal
AS $$
DECLARE
  m     text[] := '{}';
  v     text;
  a     jsonb;
  c_max constant int := 4000;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN ARRAY['peca','formatos','arquivo','material_url','decupagem','direcao_visual'];
  END IF;

  -- peca (+ peca_outro)
  v := CASE WHEN jsonb_typeof(p -> 'peca') = 'string' THEN btrim(p ->> 'peca') END;
  IF v IS NULL OR v NOT IN ('criativo_anuncio','conteudo_organico','corte','vsl_cpl','aula_completa','outro') THEN
    m := m || 'peca'::text;
  ELSIF v = 'outro' AND NOT _vb_text_ok(p, 'peca_outro', 1, c_max) THEN
    m := m || 'peca_outro'::text;
  END IF;

  -- formatos (+ formato_outro)
  a := p -> 'formatos';
  IF coalesce(jsonb_typeof(a), '') <> 'array' THEN
    m := m || 'formatos'::text;
  ELSIF jsonb_array_length(a) = 0 OR jsonb_array_length(a) > 10
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(a) e
                 WHERE jsonb_typeof(e) <> 'string'
                    OR (e #>> '{}') NOT IN ('9x16','4x5','16x9','1x1','outro')) THEN
    m := m || 'formatos'::text;
  ELSIF a ? 'outro' AND NOT _vb_text_ok(p, 'formato_outro', 1, c_max) THEN
    m := m || 'formato_outro'::text;
  END IF;

  -- arquivo
  a := p -> 'arquivo';
  IF coalesce(jsonb_typeof(a), '') <> 'array' THEN
    m := m || 'arquivo'::text;
  ELSIF jsonb_array_length(a) = 0 OR jsonb_array_length(a) > 10
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(a) e
                 WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') NOT IN ('mp4','mov')) THEN
    m := m || 'arquivo'::text;
  END IF;

  IF NOT _vb_url_ok(p, 'material_url') THEN m := m || 'material_url'::text; END IF;
  IF NOT _vb_text_ok(p, 'decupagem', 3, c_max) THEN m := m || 'decupagem'::text; END IF;
  IF NOT _vb_text_ok(p, 'direcao_visual', 3, c_max) THEN m := m || 'direcao_visual'::text; END IF;

  -- Opcionais: se vierem, têm que ser válidos (não inflar o card, não aceitar lixo).
  IF _vb_present(p, 'textos_tela') AND NOT _vb_text_ok(p, 'textos_tela', 1, c_max) THEN m := m || 'textos_tela'::text; END IF;
  IF _vb_present(p, 'entrega_url') AND NOT _vb_url_ok(p, 'entrega_url') THEN m := m || 'entrega_url'::text; END IF;
  IF _vb_present(p, 'assets_url') AND NOT _vb_text_ok(p, 'assets_url', 1, c_max) THEN m := m || 'assets_url'::text; END IF;
  IF _vb_present(p, 'observacoes') AND NOT _vb_text_ok(p, 'observacoes', 1, c_max) THEN m := m || 'observacoes'::text; END IF;

  RETURN m;
END;
$$;

-- Card do ClickUp (markdown). p_due = prazo sugerido (impresso em horário de Brasília).
-- Só renderiza chaves conhecidas; chave desconhecida no jsonb é ignorada.
CREATE OR REPLACE FUNCTION portal.video_briefing_markdown(p jsonb, p_due timestamptz)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO pg_catalog, portal
AS $$
DECLARE
  md    text;
  v     text;
  lst   text;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN ''; END IF;

  -- Texto do cliente NUNCA entra cru: campos de uma linha passam por _md_inline
  -- (escape + sem quebra), URLs viram autolink <url> (sem texto âncora — não dá para
  -- escrever "Drive oficial" apontando para terceiro), blocos longos vão em cerca de
  -- código (_md_block). Rótulos fixos e valores de enum são nossos.
  v := p ->> 'peca';
  v := CASE v
         WHEN 'criativo_anuncio'  THEN 'Criativo para anúncio'
         WHEN 'conteudo_organico' THEN 'Conteúdo orgânico'
         WHEN 'corte'             THEN 'Corte'
         WHEN 'vsl_cpl'           THEN 'VSL / CPL'
         WHEN 'aula_completa'     THEN 'Aula completa'
         WHEN 'outro'             THEN 'Outro: ' || _md_inline(p ->> 'peca_outro')
         ELSE '—' END;
  md := '## Briefing de edição de vídeo' || E'

' || '**Peça:** ' || v || E'
';

  IF jsonb_typeof(p -> 'formatos') = 'array' THEN
    SELECT string_agg(CASE e #>> '{}'
                        WHEN '9x16' THEN '9:16' WHEN '4x5' THEN '4:5'
                        WHEN '16x9' THEN '16:9' WHEN '1x1' THEN '1:1'
                        WHEN 'outro' THEN 'Outro: ' || _md_inline(p ->> 'formato_outro')
                        ELSE _md_inline(e #>> '{}') END, ', ' ORDER BY o)
      INTO lst FROM jsonb_array_elements(p -> 'formatos') WITH ORDINALITY AS t(e, o);
  END IF;
  md := md || '**Proporções:** ' || coalesce(lst, '—') || E'
';
  lst := NULL;

  IF jsonb_typeof(p -> 'arquivo') = 'array' THEN
    SELECT string_agg(_md_inline(upper(e #>> '{}')), ', ' ORDER BY o)
      INTO lst FROM jsonb_array_elements(p -> 'arquivo') WITH ORDINALITY AS t(e, o);
  END IF;
  md := md || '**Tipo de arquivo:** ' || coalesce(lst, '—') || E'
';

  md := md || '**Prazo sugerido pelo cliente:** '
     || coalesce(to_char(p_due AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI') || ' (horário de Brasília)', 'não informado')
     || E'
';
  md := md || '**Material bruto:** '
     || CASE WHEN _vb_url_ok(p, 'material_url') THEN '<' || btrim(p ->> 'material_url') || '>' ELSE '—' END || E'
';
  md := md || '**Pasta de entrega:** '
     || CASE WHEN _vb_url_ok(p, 'entrega_url') THEN '<' || btrim(p ->> 'entrega_url') || '>'
             ELSE 'entregar na pasta do material bruto' END || E'
';

  md := md || E'
### Decupagem / minutagem
' || _md_block(p ->> 'decupagem') || E'
';
  md := md || E'
### Direção visual e dinâmica
' || _md_block(p ->> 'direcao_visual') || E'
';
  IF _vb_present(p, 'textos_tela') THEN
    md := md || E'
### Textos na tela (headline e letterings)
' || _md_block(p ->> 'textos_tela') || E'
';
  END IF;
  IF _vb_present(p, 'assets_url') THEN
    md := md || E'
### Assets / links específicos
' || _md_block(p ->> 'assets_url') || E'
';
  END IF;
  IF _vb_present(p, 'observacoes') THEN
    md := md || E'
### Observações extras
' || _md_block(p ->> 'observacoes') || E'
';
  END IF;
  RETURN md;
END;
$$;

-- p_from + p_n dias úteis (seg–sex). Sem feriados (decisão: "seg–sex").
-- O(1) (kirad #2): cada 7 dias corridos têm exatamente 5 úteis, qualquer que seja o
-- dia de partida; o resto (< 5 úteis) anda no máximo 6 dias. Teto de 3660 úteis.
CREATE OR REPLACE FUNCTION portal.add_business_days(p_from date, p_n int)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  d date;
  r int;
BEGIN
  IF p_from IS NULL OR p_n IS NULL OR p_n < 0 THEN RETURN p_from; END IF;
  IF p_n > 3660 THEN
    RAISE EXCEPTION 'add_business_days: p_n acima do teto (3660).' USING ERRCODE = '22023';
  END IF;
  IF p_n = 0 THEN RETURN p_from; END IF;
  -- r em 1..5 (nunca 0): o último passo cai sempre num dia útil, igual ao laço
  -- dia-a-dia (partindo de sábado, 5 úteis = sexta, não sábado).
  d := p_from + 7 * ((p_n - 1) / 5);
  r := (p_n - 1) % 5 + 1;
  WHILE r > 0 LOOP
    d := d + 1;
    IF extract(isodow FROM d) < 6 THEN r := r - 1; END IF;
  END LOOP;
  RETURN d;
END;
$$;

-- Primeira DATA (fuso SP) aceita como prazo: hoje + 2 dias úteis.
CREATE OR REPLACE FUNCTION portal.demand_min_due_date()
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO pg_catalog, portal
AS $$
  SELECT portal.add_business_days((now() AT TIME ZONE 'America/Sao_Paulo')::date, 2);
$$;

-- Levanta erro se o prazo não respeita o mínimo. Mensagens contêm "prazo" (o front
-- usa isso — isDueError em lib/video-briefing.ts). HINT estável para quem preferir.
CREATE OR REPLACE FUNCTION portal.assert_demand_due_lead(p_due timestamptz)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO pg_catalog, portal
AS $$
DECLARE
  v_min date := portal.demand_min_due_date();
BEGIN
  IF p_due IS NULL THEN RETURN; END IF;
  IF p_due <= now() THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'due_in_past',
      MESSAGE = 'O prazo precisa ser uma data futura.';
  END IF;
  IF (p_due AT TIME ZONE 'America/Sao_Paulo')::date < v_min THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'due_too_soon', DETAIL = v_min::text,
      MESSAGE = 'O prazo mínimo é de 2 dias úteis: escolha a partir de ' || to_char(v_min, 'DD/MM/YYYY') || '.';
  END IF;
END;
$$;

-- ── 4. Guarda de escrita direta em portal.demands (🔴 achado do plano) ────────
-- Desenho (revisado após o kirad):
--   * A TRIGGER continua SECURITY INVOKER e decide privilégio por current_user:
--     "privilegiado" = papel ≠ authenticated/anon (service_role, cron/postgres e o OWNER
--     dentro de qualquer RPC SECURITY DEFINER) OU admin logado. Por que não DEFINER +
--     claim do JWT: dentro de RPCs DEFINER chamadas pelo cliente (create_demand,
--     client_complete_demand, ...) a claim continua 'authenticated' — a guarda passaria
--     a barrar escrita legítima dessas RPCs (ex.: finalized_at na conclusão). current_user
--     é exatamente o sinal "veio direto do PostgREST".
--   * A validação do INSERT direto mora num ÚNICO wrapper SECURITY DEFINER
--     (_demand_direct_insert_check) — o único EXECUTE que authenticated precisa. As
--     auxiliares (_vb_*, video_briefing_*, add_business_days, demand_min_due_date,
--     assert_demand_due_lead) ficam SEM EXECUTE para authenticated/anon (kirad #2).
--   * O wrapper é chamável via PostgREST, mas é barato (O(1), texto ≤ 40 kB) e não vaza
--     nada: contrato de outro slug volta vazio (get_student_contracted_positions filtra
--     pelo JWT) → sempre "não contratado".

-- Valida um INSERT direto (não privilegiado). Devolve {briefing (normalizado),
-- created_by (portal.users.id do chamador)}. Assinatura de 4 args (1ª versão desta
-- migration, nunca aplicada) é removida para não deixar sobrecarga.
DROP FUNCTION IF EXISTS portal._demand_direct_insert_check(text, text, jsonb, timestamptz);
CREATE OR REPLACE FUNCTION portal._demand_direct_insert_check(
  p_service_type text, p_client_slug text, p_briefing jsonb, p_due_at timestamptz, p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, portal
AS $$
DECLARE
  v_missing text[];
  v_brief   jsonb := p_briefing;
  v_uid     jsonb;
BEGIN
  IF v_brief IS NOT NULL AND jsonb_typeof(v_brief) = 'null' THEN v_brief := NULL; END IF;

  -- kirad (baixo #1): autor = quem chama, nunca o que veio no corpo.
  SELECT to_jsonb(u.id) INTO v_uid FROM portal.users u WHERE u.auth_user_id = auth.uid() LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', HINT = 'demand_guard', MESSAGE = 'Sessão inválida.';
  END IF;
  -- Projeto só do próprio cliente e ativo (mesma regra da create_demand).
  IF p_project_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM portal.projects pr
        WHERE pr.id = p_project_id AND pr.client_slug = p_client_slug
          AND pr.status IN ('active', 'briefing')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', HINT = 'project_not_allowed',
      MESSAGE = 'Projeto não pertence a este cliente ou não está ativo.';
  END IF;

  -- kirad #1: tipo tem que ser contratado (mesma regra/HINT da create_demand).
  IF p_service_type IS NOT NULL AND p_service_type <> 'outro'
     AND NOT EXISTS (SELECT 1 FROM portal.get_student_contracted_positions(p_client_slug) g
                      WHERE g.position_slug = p_service_type) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'service_type_not_contracted',
      MESSAGE = 'Tipo de serviço não contratado por este cliente.';
  END IF;

  -- kirad #5: teto de tamanho ANTES de processar, e só chaves conhecidas.
  IF v_brief IS NOT NULL AND octet_length(v_brief::text) > 40000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'briefing_too_large',
      MESSAGE = 'Briefing grande demais (máximo de 40 mil caracteres no total).';
  END IF;
  v_brief := portal.video_briefing_normalize(v_brief);
  -- Produção: demands.briefing é jsonb NOT NULL DEFAULT '{}' → '{}' = "sem briefing".
  IF v_brief = '{}'::jsonb THEN v_brief := NULL; END IF;
  IF v_brief IS NOT NULL AND p_service_type IS DISTINCT FROM 'editor-video' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'demand_guard',
      MESSAGE = 'Briefing estruturado só existe para edição de vídeo.';
  END IF;

  IF p_service_type = 'editor-video' THEN
    v_missing := portal.video_briefing_missing(v_brief);
    IF p_due_at IS NULL THEN v_missing := v_missing || 'prazo'::text; END IF;
    IF cardinality(v_missing) > 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'video_briefing_missing',
        DETAIL = to_jsonb(v_missing)::text,
        MESSAGE = 'Briefing de vídeo incompleto (briefing_incompleto: ' || array_to_string(v_missing, ',') || ').';
    END IF;
  END IF;
  PERFORM portal.assert_demand_due_lead(p_due_at);
  RETURN jsonb_build_object('briefing', coalesce(v_brief, '{}'::jsonb), 'created_by', v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION portal._demands_due_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, portal
AS $$
DECLARE
  v_priv boolean := current_user NOT IN ('authenticated', 'anon');
  v_new  jsonb;
  v_old  jsonb;
  v_col  text;
  v_chk  jsonb;
  -- kirad #8: além de prazo/tipo/briefing, colunas de VÍNCULO e de sincronização.
  -- Trocar clickup_task_id para a task de outro cliente quebrava o webhook da vítima
  -- e fazia a varredura copiar o prazo dela. status/title/description ficam livres
  -- (fora de escopo; o front do cliente não faz UPDATE direto em demands — só o admin).
  -- Comparação via to_jsonb: coluna que não existir neste banco vira NULL dos dois
  -- lados (nunca erro de "column does not exist").
  c_protected constant text[] := ARRAY[
    'due_at','due_has_time','due_suggested_at','due_previous_at','due_previous_has_time',
    'due_changed_at','due_changed_source','service_type','briefing','briefing_status',
    'clickup_task_id','client_slug','created_by','clickup_synced_at',
    'last_synced_from_clickup_at','clickup_assignee_sync','clickup_assignee_detail',
    'project_id','finalized_at'];
BEGIN
  IF NOT v_priv AND current_user = 'authenticated' THEN
    v_priv := coalesce(portal.is_admin(), false);
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.service_type := nullif(lower(btrim(NEW.service_type)), '');
    IF NOT v_priv THEN
      -- Histórico de remarcação só nasce pela RPC do ClickUp; vínculo com o ClickUp
      -- só nasce pela edge (kirad #8 — o mesmo sequestro de task pelo INSERT).
      NEW.due_previous_at := NULL; NEW.due_previous_has_time := NULL;
      NEW.due_changed_at  := NULL; NEW.due_changed_source    := NULL;
      NEW.clickup_task_id := NULL; NEW.last_synced_from_clickup_at := NULL;
      NEW.finalized_at    := NULL;
      -- Escrita direta só com ends_at (data): converte para o prazo (meio-dia SP, sem hora).
      IF NEW.due_at IS NULL AND NEW.ends_at IS NOT NULL THEN
        NEW.due_at := (NEW.ends_at + time '12:00') AT TIME ZONE 'America/Sao_Paulo';
        NEW.due_has_time := false;
      END IF;
      NEW.due_suggested_at := NEW.due_at;
      NEW.status := 'open';
      v_chk := portal._demand_direct_insert_check(NEW.service_type, NEW.client_slug, NEW.briefing, NEW.due_at, NEW.project_id);
      NEW.briefing := coalesce(v_chk -> 'briefing', '{}'::jsonb);
      -- created_by do chamador + colunas de sync zeradas. jsonb_populate_record: chave
      -- de coluna que não existir neste banco é ignorada (clickup_synced_at pode não
      -- existir). detail vira '{}' (o estado "sem divergência" que o sync grava).
      NEW := jsonb_populate_record(NEW, jsonb_build_object(
               'created_by', v_chk -> 'created_by',
               'clickup_synced_at', NULL,
               'clickup_assignee_sync', NULL,
               'clickup_assignee_detail', '{}'::jsonb));
    END IF;
    -- briefing NOT NULL DEFAULT '{}' em produção: nunca NULL; '{}' = sem briefing
    -- (status fica no default 'draft'); com chaves → 'submitted'.
    IF NEW.briefing IS NULL OR jsonb_typeof(NEW.briefing) = 'null' THEN NEW.briefing := '{}'::jsonb; END IF;
    IF NEW.briefing <> '{}'::jsonb THEN NEW.briefing_status := 'submitted'; END IF;

  ELSIF TG_OP = 'UPDATE' AND NOT v_priv THEN
    v_new := to_jsonb(NEW);
    v_old := to_jsonb(OLD);
    FOREACH v_col IN ARRAY c_protected LOOP
      IF (v_new -> v_col) IS DISTINCT FROM (v_old -> v_col) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', HINT = 'demand_protected_field', DETAIL = v_col,
          MESSAGE = 'Prazo, tipo, briefing e vínculos da demanda não podem ser alterados diretamente.';
      END IF;
    END LOOP;
  END IF;

  -- Mão única: ends_at deriva de due_at (vale para TODOS, inclusive privilegiados).
  IF NEW.due_at IS NOT NULL THEN
    NEW.ends_at := (NEW.due_at AT TIME ZONE 'America/Sao_Paulo')::date;
  ELSIF TG_OP = 'UPDATE' AND OLD.due_at IS NOT NULL THEN
    NEW.ends_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS demands_due_guard ON portal.demands;
CREATE TRIGGER demands_due_guard
  BEFORE INSERT OR UPDATE ON portal.demands
  FOR EACH ROW EXECUTE FUNCTION portal._demands_due_guard();

-- ── 5. demand_messages.origin aceita 'system' ────────────────────────────────
-- Reescrito A PARTIR de pg_get_constraintdef: acrescenta 'system' à lista literal e
-- preserva todo o resto da definição (nome, NULL-handling). Aborta se não achar
-- exatamente 1 CHECK que mencione origin, ou se o formato não for o esperado.
DO $$
DECLARE
  v_n    int;
  v_name text;
  v_def  text;
  v_new  text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'portal.demand_messages'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ~ '\morigin\M';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '095: esperado 1 CHECK sobre demand_messages.origin, achei %. Conferir pg_get_constraintdef antes de aplicar.', v_n;
  END IF;
  SELECT conname, pg_get_constraintdef(oid) INTO v_name, v_def FROM pg_constraint
   WHERE conrelid = 'portal.demand_messages'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ~ '\morigin\M';

  IF v_def LIKE '%''system''%' THEN
    RAISE NOTICE '095: CHECK % já aceita system — nada a fazer.', v_name;
    RETURN;
  END IF;
  v_new := replace(v_def, '''clickup''::text', '''clickup''::text, ''system''::text');
  -- Se um down anterior deixou o CHECK como NOT VALID, volta validado (linhas 'system'
  -- antigas passam na lista nova).
  v_new := regexp_replace(v_new, '\s+NOT VALID\s*$', '');
  IF v_new = v_def THEN
    RAISE EXCEPTION '095: formato inesperado do CHECK % (%). Reescrever à mão.', v_name, v_def;
  END IF;
  EXECUTE format('ALTER TABLE portal.demand_messages DROP CONSTRAINT %I', v_name);
  EXECUTE format('ALTER TABLE portal.demand_messages ADD CONSTRAINT %I %s', v_name, v_new);
END $$;

-- Cliente não grava nem converte mensagem com origin ≠ 'portal' ('system' seria aviso
-- "oficial" falsificado; 'clickup', mensagem falsa da equipe). Mesmo critério de
-- privilégio da guarda de demands.
CREATE OR REPLACE FUNCTION portal._demand_messages_system_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, portal
AS $$
BEGIN
  -- kirad #7: cliente só grava/edita mensagem de origem 'portal'. origin='clickup'
  -- forjado aparecia como mensagem da equipe; 'system', como aviso oficial.
  -- kirad (baixo #2): origin NULL vira 'portal' para quem não é privilegiado.
  IF current_user IN ('authenticated', 'anon') AND NOT coalesce(portal.is_admin(), false) THEN
    NEW.origin := coalesce(NEW.origin, 'portal');
  END IF;
  IF current_user IN ('authenticated', 'anon')
     AND (NEW.origin <> 'portal'
          OR (TG_OP = 'UPDATE' AND coalesce(OLD.origin, 'portal') <> 'portal'))
     AND NOT coalesce(portal.is_admin(), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', HINT = 'system_message_guard',
      MESSAGE = 'Só a equipe e o sistema gravam mensagens fora do portal.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS demand_messages_system_guard ON portal.demand_messages;
CREATE TRIGGER demand_messages_system_guard
  BEFORE INSERT OR UPDATE ON portal.demand_messages
  FOR EACH ROW EXECUTE FUNCTION portal._demand_messages_system_guard();

-- ── 6. messages_clickup_sync pula origin='system' ────────────────────────────
DO $$
DECLARE
  v_def  text;
  v_type int;
  v_new  text;
BEGIN
  SELECT pg_get_triggerdef(t.oid), t.tgtype INTO v_def, v_type
    FROM pg_trigger t
   WHERE t.tgrelid = 'portal.demand_messages'::regclass
     AND t.tgname = 'messages_clickup_sync' AND NOT t.tgisinternal;
  IF v_def IS NULL THEN
    RAISE EXCEPTION '095: trigger messages_clickup_sync não encontrada em portal.demand_messages.';
  END IF;
  IF v_def LIKE '%''system''%' THEN
    RAISE NOTICE '095: messages_clickup_sync já pula system — nada a fazer.';
    RETURN;
  END IF;
  IF (v_type & 1) = 0 THEN RAISE EXCEPTION '095: messages_clickup_sync não é FOR EACH ROW: %', v_def; END IF;
  IF (v_type & 8) <> 0 THEN RAISE EXCEPTION '095: messages_clickup_sync dispara em DELETE (WHEN com NEW inválido): %', v_def; END IF;

  IF v_def ~ ' WHEN \(' THEN
    v_new := regexp_replace(v_def, ' WHEN \((.*)\) EXECUTE ',
               ' WHEN ((new.origin IS DISTINCT FROM ''system''::text) AND (\1)) EXECUTE ');
  ELSE
    v_new := replace(v_def, ' FOR EACH ROW EXECUTE ',
               ' FOR EACH ROW WHEN (new.origin IS DISTINCT FROM ''system''::text) EXECUTE ');
  END IF;
  IF v_new = v_def THEN RAISE EXCEPTION '095: não consegui reescrever messages_clickup_sync: %', v_def; END IF;

  EXECUTE 'DROP TRIGGER messages_clickup_sync ON portal.demand_messages';
  EXECUTE v_new;
  EXECUTE format('COMMENT ON TRIGGER messages_clickup_sync ON portal.demand_messages IS %L',
                 '095-original: ' || v_def);
END $$;

-- ── 7. demands_clickup_update deixa de reagir a starts_at/ends_at ─────────────
-- Observação: UPDATE OF só olha as colunas ALVO do SET, não as alteradas por trigger
-- BEFORE. apply_clickup_due_change não põe ends_at no SET — então a remarcação já não
-- dispararia a saída. O ajuste aqui cobre o webhook (que grava starts_at) e qualquer
-- UPDATE futuro que nomeie ends_at.
DO $$
DECLARE
  v_def  text;
  v_cols text;
  v_keep text;
  v_new  text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_def
    FROM pg_trigger t
   WHERE t.tgrelid = 'portal.demands'::regclass
     AND t.tgname = 'demands_clickup_update' AND NOT t.tgisinternal;
  IF v_def IS NULL THEN
    RAISE EXCEPTION '095: trigger demands_clickup_update não encontrada em portal.demands.';
  END IF;
  v_cols := substring(v_def FROM 'UPDATE OF (.+?) ON portal\.demands');
  IF v_cols IS NULL THEN
    RAISE EXCEPTION '095: demands_clickup_update sem lista de colunas (UPDATE OF): %', v_def;
  END IF;
  SELECT string_agg(c, ', ' ORDER BY o) INTO v_keep
    FROM unnest(string_to_array(v_cols, ', ')) WITH ORDINALITY AS u(c, o)
   WHERE c NOT IN ('starts_at', 'ends_at');
  IF v_keep = v_cols THEN
    RAISE NOTICE '095: demands_clickup_update já não observa starts_at/ends_at — nada a fazer.';
    RETURN;
  END IF;
  IF v_keep IS NULL THEN
    RAISE EXCEPTION '095: demands_clickup_update ficaria sem coluna: %', v_def;
  END IF;
  v_new := replace(v_def, 'UPDATE OF ' || v_cols || ' ON ', 'UPDATE OF ' || v_keep || ' ON ');

  EXECUTE 'DROP TRIGGER demands_clickup_update ON portal.demands';
  EXECUTE v_new;
  EXECUTE format('COMMENT ON TRIGGER demands_clickup_update ON portal.demands IS %L',
                 '095-original: ' || v_def);
END $$;

-- ── 8. Chave de configuração ─────────────────────────────────────────────────
INSERT INTO portal.clickup_config (key, value)
VALUES ('notify_due_changes', 'on')
ON CONFLICT (key) DO NOTHING;

-- ── 8b. 🔴 get_student_contracted_positions: IDOR entre clientes ────────────────
-- 025 criou como SECURITY DEFINER sem checar quem chama: qualquer autenticado lia os
-- contratos de OUTRO cliente passando o slug. E o REVOKE da 025 foi só de anon — a
-- herança de PUBLIC continuava valendo. Mesma assinatura e mesmo retorno (CREATE OR
-- REPLACE preserva ACL e dependentes); corpo idêntico à 025 + o filtro de acesso.
-- Quem pode ler:
--   - requisição sem JWT de cliente (role da claim ≠ anon/authenticated): service_role,
--     cron, sessão direta do banco;
--   - admin (portal.is_admin());
--   - usuário logado cujo portal.users.client_slug = p_slug.
-- Os outros recebem lista VAZIA (não erro): o front já trata vazio como "só Outro".
-- create_demand chama com o slug do próprio chamador → passa.
CREATE OR REPLACE FUNCTION portal.get_student_contracted_positions(p_slug text)
RETURNS TABLE (
  position_id   uuid,
  position_slug text,
  position_name text,
  service_count int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO pg_catalog, portal
AS $$
  SELECT
    p.id,
    p.slug,
    p.name,
    count(*)::int AS service_count
  FROM portal.services s
  JOIN portal.positions p
    ON p.slug = portal.fn_service_type_to_position_slug(s.service_type)
  WHERE s.client_slug = p_slug
    AND s.status IN ('active','delinquent')
    AND (
      coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
        NOT IN ('anon', 'authenticated')
      OR portal.is_admin()
      OR EXISTS (SELECT 1 FROM portal.users u
                  WHERE u.auth_user_id = auth.uid() AND u.client_slug = p_slug)
    )
  GROUP BY p.id, p.slug, p.name, p.sort_order
  ORDER BY p.sort_order;
$$;

REVOKE ALL ON FUNCTION portal.get_student_contracted_positions(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION portal.get_student_contracted_positions(text) FROM anon;
GRANT EXECUTE ON FUNCTION portal.get_student_contracted_positions(text) TO authenticated, service_role;

-- ── 9. create_demand (parte da 051) ──────────────────────────────────────────
-- ⚠️ CREATE OR REPLACE com assinatura diferente CRIA SOBRECARGA. DROP explícito da
-- assinatura vigente (medida em 25/09: create_demand(text,text,uuid[],uuid,timestamptz,timestamptz)).
DROP FUNCTION IF EXISTS portal.create_demand(text, text, uuid[], uuid, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION portal.create_demand(
  p_title         text,
  p_description   text,
  p_operators     uuid[],
  p_project_id    uuid        DEFAULT NULL,
  p_starts_at     timestamptz DEFAULT NULL,
  p_ends_at       timestamptz DEFAULT NULL,
  p_service_type  text        DEFAULT NULL,
  p_briefing      jsonb       DEFAULT NULL,
  p_due_at        timestamptz DEFAULT NULL,
  p_due_has_time  boolean     DEFAULT true)
RETURNS portal.demands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, portal
AS $function$
DECLARE
  v_caller   portal.users;
  v_demand   portal.demands;
  v_op       uuid;
  v_allowed  boolean;
  v_project  portal.projects;
  v_is_admin boolean;
  v_service  text;
  v_briefing jsonb := p_briefing;
  v_due      timestamptz := p_due_at;
  v_has_time boolean := coalesce(p_due_has_time, true);
  v_missing  text[];
BEGIN
  SELECT * INTO v_caller FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN RAISE EXCEPTION 'Sessão inválida.'; END IF;
  IF v_caller.role NOT IN ('user','client','admin') THEN RAISE EXCEPTION 'Permissão negada.'; END IF;
  IF v_caller.status != 'approved' AND v_caller.role != 'admin' THEN RAISE EXCEPTION 'Conta não aprovada.'; END IF;
  v_is_admin := (v_caller.role = 'admin');

  IF NOT v_is_admin AND NOT portal.client_base_ready(v_caller.client_slug) THEN
    RAISE EXCEPTION 'Complete o Briefing Básico antes de abrir um chamado.';
  END IF;

  IF p_project_id IS NOT NULL THEN
    SELECT * INTO v_project FROM portal.projects WHERE id = p_project_id LIMIT 1;
    IF v_project.id IS NULL THEN RAISE EXCEPTION 'Projeto não encontrado.'; END IF;
    IF v_project.client_slug != v_caller.client_slug AND NOT portal.is_admin() THEN
      RAISE EXCEPTION 'Projeto não pertence a este cliente.';
    END IF;
    IF v_project.status NOT IN ('active','briefing') THEN RAISE EXCEPTION 'Projeto não está ativo.'; END IF;
  END IF;

  -- ── Tipo de serviço (095) ──
  v_service := nullif(lower(btrim(p_service_type)), '');
  IF v_service IS NOT NULL AND NOT v_is_admin AND v_service <> 'outro'
     AND NOT EXISTS (SELECT 1 FROM portal.get_student_contracted_positions(v_caller.client_slug) g
                      WHERE g.position_slug = v_service) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'service_type_not_contracted',
      MESSAGE = 'Tipo de serviço não contratado por este cliente.';
  END IF;
  IF v_briefing IS NOT NULL AND jsonb_typeof(v_briefing) = 'null' THEN v_briefing := NULL; END IF;
  -- kirad #5: teto ANTES de processar; grava só as chaves conhecidas (vale para admin).
  IF v_briefing IS NOT NULL AND octet_length(v_briefing::text) > 40000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'briefing_too_large',
      MESSAGE = 'Briefing grande demais (máximo de 40 mil caracteres no total).';
  END IF;
  v_briefing := portal.video_briefing_normalize(v_briefing);
  -- '{}' = sem briefing (coluna é NOT NULL DEFAULT '{}' em produção; grava-se '{}').
  IF v_briefing = '{}'::jsonb THEN v_briefing := NULL; END IF;
  IF v_briefing IS NOT NULL AND v_service IS DISTINCT FROM 'editor-video' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'demand_guard',
      MESSAGE = 'Briefing estruturado só existe para edição de vídeo.';
  END IF;

  -- ── Prazo (095) ── p_due_at vence; sem ele, p_ends_at (data do front antigo) vira
  -- prazo sem hora ao meio-dia de SP. A data é lida em UTC = o mesmo cast implícito
  -- timestamptz→date que a 051 fazia (sessão PostgREST em UTC).
  IF v_due IS NULL AND p_ends_at IS NOT NULL THEN
    v_due := ((p_ends_at AT TIME ZONE 'UTC')::date + time '12:00') AT TIME ZONE 'America/Sao_Paulo';
    v_has_time := false;
  END IF;
  IF v_due IS NULL THEN v_has_time := NULL; END IF;

  IF NOT v_is_admin THEN
    IF v_service = 'editor-video' THEN
      v_missing := portal.video_briefing_missing(v_briefing);
      IF v_due IS NULL THEN v_missing := v_missing || 'prazo'::text; END IF;
      IF cardinality(v_missing) > 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'video_briefing_missing',
          DETAIL = to_jsonb(v_missing)::text,
          MESSAGE = 'Briefing de vídeo incompleto (briefing_incompleto: ' || array_to_string(v_missing, ',') || ').';
      END IF;
    END IF;
    PERFORM portal.assert_demand_due_lead(v_due);   -- 2 dias úteis, qualquer peça
  END IF;

  -- Rede de segurança: sem operadores enviados → usa a equipe pré-definida do cliente.
  IF (p_operators IS NULL OR array_length(p_operators,1) IS NULL)
     AND v_caller.role <> 'admin' AND v_caller.client_slug IS NOT NULL THEN
    SELECT array_agg(ta.operator_id)
      INTO p_operators
      FROM portal.team_assignments ta
      JOIN portal.operators o ON o.id = ta.operator_id
     WHERE ta.client_slug = v_caller.client_slug
       AND o.status = 'active' AND o.contract_active = true;
  END IF;
  p_operators := COALESCE(p_operators, '{}'::uuid[]);

  FOREACH v_op IN ARRAY p_operators LOOP
    IF v_caller.role = 'admin' THEN
      SELECT EXISTS (
        SELECT 1 FROM portal.operators o
        WHERE o.id = v_op AND o.status = 'active' AND o.contract_active = true
      ) INTO v_allowed;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM portal.team_assignments ta
        JOIN portal.operators o ON o.id = ta.operator_id
        WHERE ta.client_slug = v_caller.client_slug
          AND ta.operator_id = v_op
          AND o.status = 'active' AND o.contract_active = true
      ) INTO v_allowed;
    END IF;
    IF NOT v_allowed THEN RAISE EXCEPTION 'Operador % não autorizado para este cliente.', v_op; END IF;
  END LOOP;

  -- ends_at não é passado: a trigger demands_due_guard deriva de due_at (fuso SP).
  -- briefing_status='submitted' também é posto pela trigger quando briefing <> '{}'.
  INSERT INTO portal.demands (client_slug, created_by, title, description, project_id,
                              starts_at, status, service_type, briefing,
                              due_at, due_has_time, due_suggested_at)
  VALUES (COALESCE(v_caller.client_slug,''), v_caller.id, trim(p_title),
          trim(COALESCE(p_description,'')), p_project_id,
          p_starts_at, 'open', v_service, coalesce(v_briefing, '{}'::jsonb),
          v_due, v_has_time, v_due)
  RETURNING * INTO v_demand;

  INSERT INTO portal.demand_members (demand_id, user_id, role)
  VALUES (v_demand.id, v_caller.id, 'client')
  ON CONFLICT (demand_id, user_id) DO NOTHING;

  FOREACH v_op IN ARRAY p_operators LOOP
    INSERT INTO portal.demand_operators (demand_id, operator_id)
    SELECT v_demand.id, o.id FROM portal.operators o
    WHERE o.id = v_op AND o.status = 'active'
    ON CONFLICT (demand_id, operator_id) DO NOTHING;
  END LOOP;

  RETURN v_demand;
END;
$function$;

-- ── 10. apply_clickup_due_change ─────────────────────────────────────────────
-- Única porta de remarcação vinda do ClickUp (webhook taskDueDateUpdated, bloco
-- genérico do webhook, varredura diária). Resultado em jsonb {result: ...}:
--   not_found | ignored_null (data removida no ClickUp — ignora) | seeded (prazo
--   anterior nulo: grava sem aviso) | no_change | updated_silent (demanda
--   done/canceled) | updated_quiet (notify_due_changes='off') | notified.
-- p_has_time NULL = "não sei" (GET /task não informa) → mantém o due_has_time atual.
-- Comparação no fuso SP: data sempre; hora só quando o prazo novo tem hora.
CREATE OR REPLACE FUNCTION portal.apply_clickup_due_change(
  p_demand_id uuid,
  p_due_at    timestamptz,
  p_has_time  boolean,
  p_source    text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, portal
AS $$
DECLARE
  c_tz      constant text := 'America/Sao_Paulo';
  v_d       portal.demands;
  v_has     boolean;
  v_same    boolean;
  v_source  text := left(coalesce(nullif(btrim(p_source), ''), 'unknown'), 40);
  v_notify  boolean;
  v_now     timestamptz := clock_timestamp();
  v_old_txt text;
  v_new_txt text;
  v_msg_id  uuid;
  v_key     text;
BEGIN
  IF p_demand_id IS NULL THEN
    RAISE EXCEPTION 'p_demand_id obrigatório.' USING ERRCODE = '22023';
  END IF;

  -- Serializa por demanda (webhook e varredura podem chegar juntos). demands primeiro,
  -- demand_messages depois — mesma ordem de lock das demais RPCs (093/094).
  SELECT * INTO v_d FROM portal.demands WHERE id = p_demand_id FOR UPDATE;
  IF v_d.id IS NULL THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
  IF p_due_at IS NULL THEN RETURN jsonb_build_object('result', 'ignored_null'); END IF;

  v_has := coalesce(p_has_time, v_d.due_has_time, false);

  IF v_d.due_at IS NULL THEN
    UPDATE portal.demands SET due_at = p_due_at, due_has_time = v_has
     WHERE id = p_demand_id;
    RETURN jsonb_build_object('result', 'seeded');
  END IF;

  v_same := (p_due_at AT TIME ZONE c_tz)::date = (v_d.due_at AT TIME ZONE c_tz)::date
            AND (NOT v_has
                 OR date_trunc('minute', p_due_at AT TIME ZONE c_tz)
                    = date_trunc('minute', v_d.due_at AT TIME ZONE c_tz));
  IF v_same THEN RETURN jsonb_build_object('result', 'no_change'); END IF;

  UPDATE portal.demands
     SET due_previous_at       = v_d.due_at,
         due_previous_has_time = v_d.due_has_time,
         due_at                = p_due_at,
         due_has_time          = v_has,
         due_changed_at        = v_now,
         due_changed_source    = v_source
   WHERE id = p_demand_id;

  IF v_d.status IN ('done', 'canceled') THEN
    RETURN jsonb_build_object('result', 'updated_silent');
  END IF;

  SELECT coalesce(nullif(btrim(value), ''), 'on') <> 'off' INTO v_notify
    FROM portal.clickup_config WHERE key = 'notify_due_changes';
  IF NOT coalesce(v_notify, true) THEN
    RETURN jsonb_build_object('result', 'updated_quiet');
  END IF;

  v_old_txt := to_char(v_d.due_at AT TIME ZONE c_tz, 'DD/MM')
            || CASE WHEN coalesce(v_d.due_has_time, false)
                    THEN ' às ' || to_char(v_d.due_at AT TIME ZONE c_tz, 'HH24:MI') ELSE '' END;
  v_new_txt := to_char(p_due_at AT TIME ZONE c_tz, 'DD/MM')
            || CASE WHEN v_has THEN ' às ' || to_char(p_due_at AT TIME ZONE c_tz, 'HH24:MI') ELSE '' END;

  -- user_id NULL + email_notified_at preenchido: fora do worker de e-mail de chat (072).
  -- origin='system': fora do messages_clickup_sync (WHEN da seção 6).
  INSERT INTO portal.demand_messages (demand_id, user_id, content, origin, email_notified_at)
  VALUES (p_demand_id, NULL,
          'A equipe remarcou a entrega de ' || v_old_txt || ' para ' || v_new_txt || '.',
          'system', v_now)
  RETURNING id INTO v_msg_id;

  -- E-mail ao cliente (send-email tipo demanda_prazo_remarcado, dedup por stamp).
  -- pg_net ENFILEIRA em net.http_request_queue; o worker só vê após o COMMIT —
  -- rollback descarta o envio.
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'clickup_sync_internal_key';
  IF v_key IS NULL THEN
    RAISE WARNING '095: clickup_sync_internal_key ausente — e-mail de remarcação ignorado (demanda %)', p_demand_id;
  ELSE
    PERFORM net.http_post(
      url     := 'https://npqyvjhvtfahuxfmuhie.supabase.co/functions/v1/send-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', v_key),
      body    := jsonb_build_object('type', 'demanda_prazo_remarcado',
                                    'demand_id', p_demand_id,
                                    'stamp', (extract(epoch FROM v_now) * 1000)::bigint::text),
      timeout_milliseconds := 5000
    );
  END IF;

  RETURN jsonb_build_object('result', 'notified', 'message_id', v_msg_id);
END;
$$;

COMMENT ON FUNCTION portal.apply_clickup_due_change(uuid, timestamptz, boolean, text) IS
  '095: aplica prazo vindo do ClickUp (fonte do prazo após a criação). Só service_role (edges clickup-webhook e clickup-sync).';

-- ── 11. GRANT / REVOKE ───────────────────────────────────────────────────────
-- Função nova nasce com EXECUTE para PUBLIC. REVOKE de PUBLIC é o que fecha
-- (revoke de anon sozinho não pega herança de PUBLIC); anon/authenticated revogados
-- também para cobrir grant nominal/default privileges do schema.
REVOKE ALL ON FUNCTION portal.apply_clickup_due_change(uuid, timestamptz, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION portal.apply_clickup_due_change(uuid, timestamptz, boolean, text) FROM anon;
REVOKE ALL ON FUNCTION portal.apply_clickup_due_change(uuid, timestamptz, boolean, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION portal.apply_clickup_due_change(uuid, timestamptz, boolean, text) TO service_role;

REVOKE ALL ON FUNCTION portal.create_demand(text, text, uuid[], uuid, timestamptz, timestamptz, text, jsonb, timestamptz, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION portal.create_demand(text, text, uuid[], uuid, timestamptz, timestamptz, text, jsonb, timestamptz, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION portal.create_demand(text, text, uuid[], uuid, timestamptz, timestamptz, text, jsonb, timestamptz, boolean) TO authenticated, service_role;

-- Funções de trigger: ninguém chama por PostgREST.
REVOKE ALL ON FUNCTION portal._demands_due_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION portal._demand_messages_system_guard() FROM PUBLIC, anon, authenticated;

-- Wrapper da validação de INSERT direto: a trigger (INVOKER) o chama com o papel da
-- requisição → authenticated precisa de EXECUTE. É o ÚNICO ponto exposto.
REVOKE ALL ON FUNCTION portal._demand_direct_insert_check(text, text, jsonb, timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION portal._demand_direct_insert_check(text, text, jsonb, timestamptz, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION portal._demand_direct_insert_check(text, text, jsonb, timestamptz, uuid) TO authenticated, service_role;

-- Auxiliares (kirad #2): NINGUÉM de fora chama. Rodam como owner dentro do wrapper, da
-- create_demand e da apply_clickup_due_change. video_briefing_markdown: service_role
-- (edge clickup-sync). REVOKE explícito de authenticated também, para cobrir default
-- privileges do schema.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'portal._vb_text_ok(jsonb, text, integer, integer)',
    'portal._vb_url_ok(jsonb, text)',
    'portal._vb_present(jsonb, text)',
    'portal._md_inline(text)',
    'portal._md_block(text)',
    'portal.video_briefing_normalize(jsonb)',
    'portal.video_briefing_missing(jsonb)',
    'portal.video_briefing_markdown(jsonb, timestamptz)',
    'portal.add_business_days(date, integer)',
    'portal.demand_min_due_date()',
    'portal.assert_demand_due_lead(timestamptz)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION portal.video_briefing_markdown(jsonb, timestamptz) TO service_role;

-- 🔴 save_demand_briefing (medido em produção 25/09, NÃO versionada no repo): SECURITY
-- DEFINER com EXECUTE para PUBLIC/authenticated, faz `briefing = briefing || p_answers`
-- checando só client_slug. Por ser DEFINER passa na demands_due_guard — o cliente
-- enfiaria chaves/megabytes no briefing de vídeo depois de criado. Nenhum front chama.
-- Fecha para todos menos service_role. Correção de segurança: o down NÃO devolve.
DO $$
BEGIN
  IF to_regprocedure('portal.save_demand_briefing(uuid,jsonb,boolean)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION portal.save_demand_briefing(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION portal.save_demand_briefing(uuid, jsonb, boolean) TO service_role;
  ELSE
    RAISE NOTICE '095: portal.save_demand_briefing(uuid,jsonb,boolean) não existe — nada a revogar.';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Conferência pós-aplicação (rodar e colar) ────────────────────────────────
-- 1 só create_demand (sem sobrecarga):
--   SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='portal' AND p.proname='create_demand';
-- PUBLIC residual nas funções novas — tem que voltar VAZIO:
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='portal'
--      AND p.proname IN ('create_demand','apply_clickup_due_change','video_briefing_missing',
--          'video_briefing_markdown','add_business_days','demand_min_due_date',
--          'assert_demand_due_lead','_vb_text_ok','_vb_url_ok','_vb_present','_md_inline',
--          '_md_block','video_briefing_normalize','_demand_direct_insert_check',
--          '_demands_due_guard','_demand_messages_system_guard','get_student_contracted_positions')
--      AND EXISTS (SELECT 1 FROM unnest(p.proacl) a WHERE a::text LIKE '=%');
-- Triggers reescritas:
--   SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--    WHERE tgname IN ('messages_clickup_sync','demands_clickup_update','demands_due_guard','demand_messages_system_guard');
-- CHECK de origin:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='portal.demand_messages'::regclass AND contype='c';
