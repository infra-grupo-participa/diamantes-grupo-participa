-- 095_video_briefing_demands_down — reverte a 095.
--
-- Restaura: create_demand da 051 (assinatura de 6 parâmetros), CHECK de
-- demand_messages.origin sem 'system', triggers messages_clickup_sync e
-- demands_clickup_update na definição ORIGINAL (lida do COMMENT '095-original: ...'
-- gravado pela 095).
-- Remove: guardas, RPC de prazo, funções de briefing/dias úteis, CHECK de
-- service_type, chave notify_due_changes.
-- FICA (de propósito): as colunas due_* (dado já gravado) e as mensagens 'system' já
-- criadas — o CHECK de origin volta como NOT VALID para não apagar histórico
-- (vale para linhas novas; as antigas ficam como estão).
-- FICA também get_student_contracted_positions como a 095 deixou (filtro por JWT +
-- sem PUBLIC): é correção de segurança, não feature. Idem o REVOKE de
-- save_demand_briefing (fora de PUBLIC/anon/authenticated) — não é devolvido.
--
-- ⚠️ Front que já usa p_service_type/p_briefing/p_due_at quebra com este down
-- (a assinatura volta a ter 6 parâmetros). Reverter o front junto.

BEGIN;

-- ── create_demand da 051 ─────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS portal.create_demand(text, text, uuid[], uuid, timestamptz, timestamptz, text, jsonb, timestamptz, boolean);

CREATE OR REPLACE FUNCTION portal.create_demand(
  p_title text, p_description text, p_operators uuid[],
  p_project_id uuid DEFAULT NULL::uuid,
  p_starts_at timestamptz DEFAULT NULL::timestamptz,
  p_ends_at timestamptz DEFAULT NULL::timestamptz)
RETURNS portal.demands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal','public'
AS $function$
DECLARE
  v_caller  portal.users;
  v_demand  portal.demands;
  v_op      uuid;
  v_allowed boolean;
  v_project portal.projects;
BEGIN
  SELECT * INTO v_caller FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN RAISE EXCEPTION 'Sessão inválida.'; END IF;
  IF v_caller.role NOT IN ('user','client','admin') THEN RAISE EXCEPTION 'Permissão negada.'; END IF;
  IF v_caller.status != 'approved' AND v_caller.role != 'admin' THEN RAISE EXCEPTION 'Conta não aprovada.'; END IF;

  IF v_caller.role != 'admin' AND NOT portal.client_base_ready(v_caller.client_slug) THEN
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

  INSERT INTO portal.demands (client_slug, created_by, title, description, project_id, starts_at, ends_at, status)
  VALUES (COALESCE(v_caller.client_slug,''), v_caller.id, trim(p_title),
          trim(COALESCE(p_description,'')), p_project_id, p_starts_at, p_ends_at, 'open')
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

REVOKE ALL ON FUNCTION portal.create_demand(text, text, uuid[], uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION portal.create_demand(text, text, uuid[], uuid, timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION portal.create_demand(text, text, uuid[], uuid, timestamptz, timestamptz) TO authenticated, service_role;

-- ── get_student_contracted_positions: NÃO revertida (kirad #3) ─────────────────
-- A 095 fechou um IDOR (cliente lia contrato de outro cliente). Correção de segurança
-- não se reverte: corpo com filtro e ACL sem PUBLIC ficam como a 095 deixou.

-- ── Triggers reescritas: volta à definição original guardada no COMMENT ───────
DO $$
DECLARE
  r      record;
  v_cmt  text;
BEGIN
  FOR r IN
    SELECT t.oid, t.tgname, t.tgrelid::regclass::text AS rel
      FROM pg_trigger t
     WHERE NOT t.tgisinternal
       AND (   (t.tgrelid = 'portal.demand_messages'::regclass::oid AND t.tgname = 'messages_clickup_sync')
            OR (t.tgrelid = 'portal.demands'::regclass::oid         AND t.tgname = 'demands_clickup_update'))
  LOOP
    v_cmt := obj_description(r.oid, 'pg_trigger');
    IF v_cmt IS NULL OR v_cmt NOT LIKE '095-original: %' THEN
      RAISE NOTICE '095 down: % sem COMMENT 095-original — não foi alterada pela 095, mantida.', r.tgname;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER %I ON %s', r.tgname, r.rel);
    EXECUTE substring(v_cmt FROM length('095-original: ') + 1);
  END LOOP;
END $$;

-- ── Guardas e funções novas ──────────────────────────────────────────────────
DROP TRIGGER IF EXISTS demands_due_guard ON portal.demands;
DROP TRIGGER IF EXISTS demand_messages_system_guard ON portal.demand_messages;
DROP FUNCTION IF EXISTS portal._demands_due_guard();
DROP FUNCTION IF EXISTS portal._demand_direct_insert_check(text, text, jsonb, timestamptz);
DROP FUNCTION IF EXISTS portal._demand_direct_insert_check(text, text, jsonb, timestamptz, uuid);
DROP FUNCTION IF EXISTS portal._demand_messages_system_guard();
DROP FUNCTION IF EXISTS portal.apply_clickup_due_change(uuid, timestamptz, boolean, text);
DROP FUNCTION IF EXISTS portal.video_briefing_markdown(jsonb, timestamptz);
DROP FUNCTION IF EXISTS portal.video_briefing_missing(jsonb);
DROP FUNCTION IF EXISTS portal.assert_demand_due_lead(timestamptz);
DROP FUNCTION IF EXISTS portal.demand_min_due_date();
DROP FUNCTION IF EXISTS portal.add_business_days(date, integer);
DROP FUNCTION IF EXISTS portal._vb_present(jsonb, text);
DROP FUNCTION IF EXISTS portal._md_inline(text);
DROP FUNCTION IF EXISTS portal._md_block(text);
DROP FUNCTION IF EXISTS portal.video_briefing_normalize(jsonb);
DROP FUNCTION IF EXISTS portal._vb_url_ok(jsonb, text);
DROP FUNCTION IF EXISTS portal._vb_text_ok(jsonb, text, integer, integer);

ALTER TABLE portal.demands DROP CONSTRAINT IF EXISTS demands_service_type_format;

-- ── CHECK de origin sem 'system' (NOT VALID: mensagens system antigas ficam) ──
DO $$
DECLARE
  v_name text;
  v_def  text;
  v_new  text;
BEGIN
  SELECT conname, pg_get_constraintdef(oid) INTO v_name, v_def FROM pg_constraint
   WHERE conrelid = 'portal.demand_messages'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ~ '\morigin\M' AND pg_get_constraintdef(oid) LIKE '%''system''%';
  IF v_name IS NULL THEN
    RAISE NOTICE '095 down: CHECK de origin já não aceita system.';
    RETURN;
  END IF;
  v_new := replace(v_def, ', ''system''::text', '');
  IF v_new = v_def THEN RAISE EXCEPTION '095 down: formato inesperado do CHECK %: %', v_name, v_def; END IF;
  -- pg_get_constraintdef de CHECK NOT VALID já traz o sufixo; não duplicar.
  v_new := regexp_replace(v_new, '\s+NOT VALID\s*$', '');
  EXECUTE format('ALTER TABLE portal.demand_messages DROP CONSTRAINT %I', v_name);
  EXECUTE format('ALTER TABLE portal.demand_messages ADD CONSTRAINT %I %s NOT VALID', v_name, v_new);
END $$;

DELETE FROM portal.clickup_config WHERE key = 'notify_due_changes';

NOTIFY pgrst, 'reload schema';

COMMIT;
