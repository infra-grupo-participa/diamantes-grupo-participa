-- 095_verificacao — prova em produção, SEM persistir nada.
--
-- COMO RODAR (orquestrador):
--   Opção A (depois de aplicar a 095): rodar este arquivo inteiro, de preferência
--     dentro de `begin; ... rollback;`.
--   Opção B (ANTES de aplicar): `begin;` + corpo da 095 SEM as linhas BEGIN;/COMMIT;
--     + este arquivo + `rollback;`.
-- O bloco termina SEMPRE em RAISE EXCEPTION com o relatório na mensagem — isso aborta
-- a transação inteira mesmo que alguém esqueça o rollback. Tudo que o teste cria
-- (demandas, mensagens, fila do pg_net) é descartado.
--
-- pg_net: net.http_post só INSERE em net.http_request_queue; o worker lê a fila em
-- outra sessão e só enxerga linhas COMMITADAS. Rollback = nenhum e-mail sai, nenhum
-- POST ao ClickUp sai. O teste (g) CONTA as linhas enfileiradas dentro da transação
-- para provar o que teria saído.
--
-- Nenhum dado pessoal fixo: o cliente de teste é descoberto aqui (prefere slug
-- 'cliente-demo'); o relatório mostra só ids.

DO $verif$
DECLARE
  rep        text := '095_VERIFICACAO (rollback forçado — nada foi persistido)';
  c_tz       constant text := 'America/Sao_Paulo';
  -- cliente com editor-video contratado
  v_uid      portal.users.id%TYPE;
  v_auth     uuid;
  v_slug     text;
  -- qualquer cliente (para g)
  v_uid2     portal.users.id%TYPE;
  v_slug2    text;
  v_other    text;
  v_brief    jsonb := jsonb_build_object(
                 'peca', 'corte', 'formatos', jsonb_build_array('9x16'), 'arquivo', jsonb_build_array('mp4'),
                 'material_url', 'https://drive.google.com/drive/folders/teste-095',
                 'decupagem', 'usar o material inteiro', 'direcao_visual', 'cortes rápidos, legenda');
  v_date     date;
  v_due      timestamptz;
  v_dem      portal.demands;
  v_dem_id   uuid;
  v_leg      uuid;
  v_proj     uuid;
  v_res      jsonb;
  v_n        bigint;
  v_n2       bigint;
  v_state    text;
  v_msg      text;
  v_det      text;
  v_hint     text;
  v_line     text;
  v_task     text;
  q_cc0 bigint;
  q_cc1 bigint; q_mail1 bigint; q_sync1 bigint;
  v_ts1      timestamptz;
BEGIN
  -- ── Estado estrutural ─────────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'portal' AND p.proname = 'create_demand';
  rep := rep || E'\n[estrutura] sobrecargas de create_demand = ' || v_n || ' (esperado 1)';

  SELECT string_agg(p.proname, ',') INTO v_line FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'portal'
     AND p.proname IN ('create_demand','apply_clickup_due_change','video_briefing_missing','video_briefing_markdown',
                       'add_business_days','demand_min_due_date','assert_demand_due_lead','_vb_text_ok','_vb_url_ok',
                       '_vb_present','_md_inline','_md_block','video_briefing_normalize','_demand_direct_insert_check',
                       '_demands_due_guard','_demand_messages_system_guard','get_student_contracted_positions')
     AND EXISTS (SELECT 1 FROM unnest(p.proacl) a WHERE a::text LIKE '=%');
  rep := rep || E'\n[estrutura] funções com EXECUTE para PUBLIC = ' || coalesce(v_line, '(nenhuma)') || ' (esperado nenhuma)';

  rep := rep || E'\n[estrutura] apply_clickup_due_change EXECUTE anon/authenticated/service_role = '
      || has_function_privilege('anon', 'portal.apply_clickup_due_change(uuid,timestamptz,boolean,text)', 'EXECUTE') || '/'
      || has_function_privilege('authenticated', 'portal.apply_clickup_due_change(uuid,timestamptz,boolean,text)', 'EXECUTE') || '/'
      || has_function_privilege('service_role', 'portal.apply_clickup_due_change(uuid,timestamptz,boolean,text)', 'EXECUTE')
      || ' (esperado false/false/true)';
  rep := rep || E'\n[estrutura] authenticated EXECUTE add_business_days/video_briefing_missing/video_briefing_markdown/_demand_direct_insert_check = '
      || has_function_privilege('authenticated', 'portal.add_business_days(date,integer)', 'EXECUTE') || '/'
      || has_function_privilege('authenticated', 'portal.video_briefing_missing(jsonb)', 'EXECUTE') || '/'
      || has_function_privilege('authenticated', 'portal.video_briefing_markdown(jsonb,timestamptz)', 'EXECUTE') || '/'
      || has_function_privilege('authenticated', 'portal._demand_direct_insert_check(text,text,jsonb,timestamptz,uuid)', 'EXECUTE')
      || ' (esperado false/false/false/true)';
  rep := rep || E'\n[estrutura] save_demand_briefing EXECUTE authenticated/anon/service_role = '
      || CASE WHEN to_regprocedure('portal.save_demand_briefing(uuid,jsonb,boolean)') IS NULL THEN '(função ausente)'
              ELSE has_function_privilege('authenticated', 'portal.save_demand_briefing(uuid,jsonb,boolean)', 'EXECUTE') || '/'
                || has_function_privilege('anon', 'portal.save_demand_briefing(uuid,jsonb,boolean)', 'EXECUTE') || '/'
                || has_function_privilege('service_role', 'portal.save_demand_briefing(uuid,jsonb,boolean)', 'EXECUTE') END
      || ' (esperado false/false/true)';

  -- (k) injeção de markdown no card (kirad #6) — como owner, sem role
  v_line := portal.video_briefing_markdown(jsonb_build_object(
      'peca', 'outro',
      'peca_outro', E'x\n**Material bruto:** [Drive oficial](https://evil.example/x) ![](https://evil.example/p.gif)',
      'formatos', jsonb_build_array('9x16'), 'arquivo', jsonb_build_array('mp4'),
      'material_url', 'https://drive.google.com/ok',
      'decupagem', E'```\n# titulo falso\n[link](https://evil.example)',
      'direcao_visual', 'ok'), now());
  rep := rep || E'\n(k) markdown: ' || CASE WHEN position(E'\n**Material bruto:** [' IN v_line) = 0
                                        AND position('\[Drive oficial\]\(https://evil.example/x\)' IN v_line) > 0
                                        AND position('\!\[\]' IN v_line) > 0
                                        AND position('<https://drive.google.com/ok>' IN v_line) > 0
                                        AND (length(v_line) - length(replace(v_line, '```', ''))) / 3 = 4
                                   THEN 'OK' ELSE 'FALHOU' END
      || ' (link/imagem/linha falsa escapados, URL como <autolink>, só as 4 cercas do sistema)';

  FOR v_line IN
    SELECT tgname || ': ' || pg_get_triggerdef(oid) FROM pg_trigger
     WHERE tgname IN ('messages_clickup_sync','demands_clickup_update','demands_due_guard','demand_messages_system_guard')
       AND NOT tgisinternal ORDER BY tgname
  LOOP rep := rep || E'\n[trigger] ' || v_line; END LOOP;

  FOR v_line IN
    SELECT conname || ': ' || pg_get_constraintdef(oid) FROM pg_constraint
     WHERE (conrelid = 'portal.demand_messages'::regclass AND pg_get_constraintdef(oid) ~ '\morigin\M')
        OR (conrelid = 'portal.demands'::regclass AND conname = 'demands_service_type_format')
  LOOP rep := rep || E'\n[check] ' || v_line; END LOOP;

  rep := rep || E'\n[config] notify_due_changes = '
      || coalesce((SELECT value FROM portal.clickup_config WHERE key = 'notify_due_changes'), '(ausente)');

  -- ── Descobre o cliente de teste ───────────────────────────────────────────
  SELECT u.id, u.auth_user_id, u.client_slug INTO v_uid, v_auth, v_slug
    FROM portal.users u
   WHERE u.role IN ('user','client') AND u.status = 'approved'
     AND u.client_slug IS NOT NULL AND u.auth_user_id IS NOT NULL
     AND portal.client_base_ready(u.client_slug)
     AND EXISTS (SELECT 1 FROM portal.get_student_contracted_positions(u.client_slug) g
                  WHERE g.position_slug = 'editor-video')
   ORDER BY (u.client_slug = 'cliente-demo') DESC, u.client_slug
   LIMIT 1;
  rep := rep || E'\n[setup] cliente editor-video: user_id=' || coalesce(v_uid::text, '(NENHUM — a..f pulados)')
      || ' demo=' || coalesce((v_slug = 'cliente-demo')::text, '-');

  SELECT u.id, u.client_slug INTO v_uid2, v_slug2
    FROM portal.users u JOIN portal.clients c ON c.slug = u.client_slug
   WHERE u.role IN ('user','client') AND u.client_slug IS NOT NULL
   ORDER BY (u.client_slug = 'cliente-demo') DESC, (u.client_slug = v_slug) DESC, u.client_slug
   LIMIT 1;

  v_date := portal.demand_min_due_date() + 3;
  v_due  := (v_date + time '23:30') AT TIME ZONE c_tz;   -- 23:30 SP = dia seguinte em UTC
  v_ts1  := ((portal.demand_min_due_date() + 5) + time '18:00') AT TIME ZONE c_tz;
  rep := rep || E'\n[setup] demand_min_due_date()=' || portal.demand_min_due_date() || ' due de teste=' || v_due || ' (SP ' || v_date || ' 23:30)';

  IF v_uid IS NOT NULL THEN
    -- ===== como o CLIENTE (authenticated) =====
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);

    -- (a) editor-video sem material e sem prazo → erro listando chaves
    BEGIN
      PERFORM portal.create_demand('095 teste a', 'x', '{}'::uuid[], NULL, NULL, NULL,
                                   'editor-video', v_brief - 'material_url', NULL);
      rep := rep || E'\n(a) FALHOU: create_demand aceitou briefing sem material_url';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_det = PG_EXCEPTION_DETAIL, v_hint = PG_EXCEPTION_HINT;
      rep := rep || E'\n(a) ' || CASE WHEN v_msg LIKE '%briefing_incompleto: %material_url%' AND v_msg LIKE '%prazo%' THEN 'OK' ELSE 'FALHOU' END
          || ' sqlstate=' || v_state || ' msg="' || v_msg || '" detail=' || coalesce(v_det, '-') || ' hint=' || coalesce(v_hint, '-');
    END;

    -- (b) prazo amanhã → erro de prazo
    BEGIN
      PERFORM portal.create_demand('095 teste b', 'x', '{}'::uuid[], NULL, NULL, NULL,
                                   'editor-video', v_brief,
                                   (((now() AT TIME ZONE c_tz)::date + 1) + time '12:00') AT TIME ZONE c_tz);
      rep := rep || E'\n(b) FALHOU: create_demand aceitou prazo para amanhã';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
      rep := rep || E'\n(b) ' || CASE WHEN v_msg ~* 'prazo|dias úteis' THEN 'OK' ELSE 'FALHOU' END
          || ' sqlstate=' || v_state || ' msg="' || v_msg || '" hint=' || coalesce(v_hint, '-');
    END;

    -- (b3) tipo não-vídeo pelo front antigo (p_ends_at +10 dias) → sucesso, briefing '{}',
    -- briefing_status 'draft' (briefing é NOT NULL DEFAULT '{}' em produção)
    BEGIN
      v_dem := portal.create_demand('095 teste b3', 'x', '{}'::uuid[], NULL, NULL,
                                    ((now() AT TIME ZONE c_tz)::date + 10)::timestamptz, 'outro');
      rep := rep || E'\n(b3) ' || CASE WHEN v_dem.briefing = '{}'::jsonb AND v_dem.briefing_status = 'draft'
                                          AND v_dem.ends_at = (now() AT TIME ZONE c_tz)::date + 10
                                          AND v_dem.due_has_time = false
                                     THEN 'OK' ELSE 'FALHOU' END
          || ' briefing=' || coalesce(v_dem.briefing::text, 'NULL') || ' briefing_status=' || coalesce(v_dem.briefing_status, 'NULL')
          || ' ends_at=' || coalesce(v_dem.ends_at::text, 'null') || ' due_has_time=' || coalesce(v_dem.due_has_time::text, 'null');
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      rep := rep || E'\n(b3) FALHOU sqlstate=' || v_state || ' msg="' || v_msg || '"';
    END;

    -- (c) completo → sucesso; due_at/ends_at coerentes no fuso SP
    BEGIN
      v_dem := portal.create_demand('095 teste c', 'texto livre do cliente', '{}'::uuid[], NULL, NULL, NULL,
                                    'editor-video', v_brief || '{"chave_intrusa": "lixo"}'::jsonb, v_due);
      v_dem_id := v_dem.id;
      rep := rep || E'\n(c) ' || CASE WHEN v_dem.due_at = v_due AND v_dem.ends_at = v_date
                                        AND v_dem.due_suggested_at = v_due AND v_dem.due_has_time
                                        AND v_dem.service_type = 'editor-video' AND v_dem.briefing_status = 'submitted'
                                        AND NOT (v_dem.briefing ? 'chave_intrusa')
                                      THEN 'OK' ELSE 'FALHOU' END
          || ' id=' || v_dem.id || ' due_at=' || v_dem.due_at || ' ends_at=' || coalesce(v_dem.ends_at::text, 'null')
          || ' (esperado ' || v_date || ') due_has_time=' || coalesce(v_dem.due_has_time::text, 'null')
          || ' briefing_status=' || coalesce(v_dem.briefing_status, 'null')
          || ' chave_intrusa_gravada=' || coalesce((v_dem.briefing ? 'chave_intrusa')::text, 'null') || ' (esperado false)';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      rep := rep || E'\n(c) FALHOU sqlstate=' || v_state || ' msg="' || v_msg || '"';
    END;

    -- (d) INSERT direto editor-video sem briefing → erro da trigger
    BEGIN
      INSERT INTO portal.demands (client_slug, created_by, title, description, status, service_type)
      VALUES (v_slug, v_uid, '095 teste d', 'x', 'open', 'editor-video');
      rep := rep || E'\n(d) FALHOU: INSERT direto sem briefing passou';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
      rep := rep || E'\n(d) ' || CASE WHEN v_hint = 'video_briefing_missing' THEN 'OK' ELSE 'VERIFICAR' END
          || ' sqlstate=' || v_state || ' msg="' || v_msg || '" hint=' || coalesce(v_hint, '-');
    END;

    -- (d2) INSERT direto COMPLETO mas prazo amanhã → erro de prazo (trigger)
    BEGIN
      INSERT INTO portal.demands (client_slug, created_by, title, description, status, service_type, briefing, due_at)
      VALUES (v_slug, v_uid, '095 teste d2', 'x', 'open', 'editor-video', v_brief,
              (((now() AT TIME ZONE c_tz)::date + 1) + time '12:00') AT TIME ZONE c_tz);
      rep := rep || E'\n(d2) FALHOU: INSERT direto com prazo amanhã passou';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
      rep := rep || E'\n(d2) ' || CASE WHEN v_hint IN ('due_too_soon','due_in_past') THEN 'OK' ELSE 'VERIFICAR' END
          || ' sqlstate=' || v_state || ' msg="' || v_msg || '"';
    END;

    -- (e) UPDATE direto de due_at → erro
    IF v_dem_id IS NOT NULL THEN
      BEGIN
        UPDATE portal.demands SET due_at = due_at + interval '7 days' WHERE id = v_dem_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        rep := rep || E'\n(e) ' || CASE WHEN v_n = 0 THEN 'INCONCLUSIVO (RLS escondeu a linha: 0 linhas)'
                                         ELSE 'FALHOU: UPDATE direto de due_at passou' END;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
        rep := rep || E'\n(e) ' || CASE WHEN v_hint = 'demand_protected_field' THEN 'OK' ELSE 'VERIFICAR' END
            || ' sqlstate=' || v_state || ' msg="' || v_msg || '"';
      END;
      -- (e2) mensagem origin='system' forjada pelo cliente → erro
      BEGIN
        INSERT INTO portal.demand_messages (demand_id, user_id, content, origin)
        VALUES (v_dem_id, v_uid, 'aviso forjado', 'system');
        rep := rep || E'\n(e2) FALHOU: cliente gravou mensagem system';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
        rep := rep || E'\n(e2) ' || CASE WHEN v_hint = 'system_message_guard' THEN 'OK' ELSE 'VERIFICAR' END
            || ' sqlstate=' || v_state || ' msg="' || v_msg || '"';
      END;
    ELSE
      rep := rep || E'\n(e) PULADO: (c) não criou demanda';
    END IF;

    -- (f) apply_clickup_due_change como authenticated → permission denied
    BEGIN
      PERFORM portal.apply_clickup_due_change(coalesce(v_dem_id, gen_random_uuid()), now() + interval '10 days', true, 'teste_095');
      rep := rep || E'\n(f) FALHOU: authenticated executou apply_clickup_due_change';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      rep := rep || E'\n(f) ' || CASE WHEN v_state = '42501' THEN 'OK' ELSE 'FALHOU' END
          || ' sqlstate=' || v_state || ' msg="' || v_msg || '"';
    END;

    -- (f2) IDOR get_student_contracted_positions: próprio slug vê, slug alheio não
    PERFORM set_config('role', 'none', true);
    SELECT s.client_slug INTO v_other FROM portal.services s
     WHERE s.client_slug <> v_slug AND s.status IN ('active','delinquent')
       AND portal.fn_service_type_to_position_slug(s.service_type) IS NOT NULL
     LIMIT 1;
    PERFORM set_config('role', 'authenticated', true);
    SELECT count(*) INTO v_n  FROM portal.get_student_contracted_positions(v_slug);
    SELECT count(*) INTO v_n2 FROM portal.get_student_contracted_positions(v_other);
    rep := rep || E'\n(f2) ' || CASE WHEN v_n >= 1 AND v_n2 = 0 AND v_other IS NOT NULL THEN 'OK'
                                     WHEN v_other IS NULL THEN 'INCONCLUSIVO (sem outro cliente com contrato)'
                                     ELSE 'FALHOU' END
        || ' próprio=' || v_n || ' linhas, alheio=' || v_n2 || ' linhas (esperado ≥1 / 0)';

    -- (i1) kirad #1: INSERT direto com tipo NÃO contratado → erro
    BEGIN
      INSERT INTO portal.demands (client_slug, created_by, title, description, status, service_type)
      VALUES (v_slug, v_uid, '095 teste i1', 'x', 'open', 'tipo-inexistente-095');
      rep := rep || E'\n(i1) FALHOU: INSERT direto com tipo não contratado passou';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
      rep := rep || E'\n(i1) ' || CASE WHEN v_hint = 'service_type_not_contracted' THEN 'OK' ELSE 'VERIFICAR' END
          || ' sqlstate=' || v_state || ' msg="' || v_msg || '"';
    END;

    -- (i2) kirad #2: auxiliar não é chamável por authenticated (DoS de add_business_days)
    BEGIN
      PERFORM portal.add_business_days(current_date, 2000000000);
      rep := rep || E'\n(i2) FALHOU: authenticated executou add_business_days';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      rep := rep || E'\n(i2) ' || CASE WHEN v_state = '42501' THEN 'OK' ELSE 'FALHOU' END
          || ' sqlstate=' || v_state || ' msg="' || v_msg || '"';
    END;

    -- (i3) kirad #5: briefing gigante → erro antes de processar
    BEGIN
      PERFORM portal.create_demand('095 teste i3', 'x', '{}'::uuid[], NULL, NULL, NULL,
                                   'editor-video', v_brief || jsonb_build_object('lixo', repeat('a', 50000)), v_due);
      rep := rep || E'\n(i3) FALHOU: create_demand aceitou briefing de 50 kB';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
      rep := rep || E'\n(i3) ' || CASE WHEN v_hint = 'briefing_too_large' THEN 'OK' ELSE 'FALHOU' END
          || ' sqlstate=' || v_state || ' msg="' || v_msg || '"';
    END;

    -- (j1) kirad baixo #1: INSERT direto com autor/status/sync forjados → corrigidos
    BEGIN
      INSERT INTO portal.demands (client_slug, created_by, title, description, status)
      VALUES (v_slug, v_uid2, '095 teste j1', 'x', 'done')
      RETURNING id INTO v_leg;
      PERFORM set_config('role', 'none', true);
      SELECT * INTO v_dem FROM portal.demands WHERE id = v_leg;
      rep := rep || E'\n(j1) ' || CASE WHEN v_dem.created_by = v_uid AND v_dem.status = 'open'
                                             AND v_dem.clickup_task_id IS NULL AND v_dem.finalized_at IS NULL
                                             AND v_dem.briefing = '{}'::jsonb AND v_dem.briefing_status = 'draft'
                                        THEN 'OK' ELSE 'FALHOU' END
          || ' created_by=chamador:' || (v_dem.created_by = v_uid) || ' status=' || v_dem.status
          || ' briefing=' || coalesce(v_dem.briefing::text, 'NULL') || ' briefing_status=' || coalesce(v_dem.briefing_status, 'NULL');
      v_leg := NULL;
      PERFORM set_config('role', 'authenticated', true);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      rep := rep || E'\n(j1) VERIFICAR sqlstate=' || v_state || ' msg="' || v_msg || '"';
    END;

    -- (j2) kirad baixo #1: project_id de OUTRO cliente → erro
    PERFORM set_config('role', 'none', true);
    SELECT pr.id INTO v_proj FROM portal.projects pr WHERE pr.client_slug <> v_slug LIMIT 1;
    PERFORM set_config('role', 'authenticated', true);
    IF v_proj IS NULL THEN
      rep := rep || E'\n(j2) INCONCLUSIVO (sem projeto de outro cliente)';
    ELSE
      BEGIN
        INSERT INTO portal.demands (client_slug, created_by, title, description, status, project_id)
        VALUES (v_slug, v_uid, '095 teste j2', 'x', 'open', v_proj);
        rep := rep || E'\n(j2) FALHOU: INSERT direto com projeto alheio passou';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_hint = PG_EXCEPTION_HINT;
        rep := rep || E'\n(j2) ' || CASE WHEN v_hint = 'project_not_allowed' THEN 'OK' ELSE 'VERIFICAR' END
            || ' sqlstate=' || v_state || ' hint=' || coalesce(v_hint, '-');
      END;
    END IF;

    IF v_dem_id IS NOT NULL THEN
      -- (j3) kirad baixo #2: origin NULL vira 'portal'
      BEGIN
        INSERT INTO portal.demand_messages (demand_id, user_id, content, origin)
        VALUES (v_dem_id, v_uid, 'origin nulo 095', NULL);
        -- lê como owner (sem RETURNING: não depende da policy de SELECT das mensagens)
        PERFORM set_config('role', 'none', true);
        SELECT origin INTO v_msg FROM portal.demand_messages WHERE demand_id = v_dem_id AND content = 'origin nulo 095';
        PERFORM set_config('role', 'authenticated', true);
        rep := rep || E'\n(j3) ' || CASE WHEN v_msg = 'portal' THEN 'OK' ELSE 'FALHOU' END || ' origin gravado=' || coalesce(v_msg, 'NULL');
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        rep := rep || E'\n(j3) VERIFICAR sqlstate=' || v_state || ' msg="' || v_msg || '"';
      END;

      -- (i4) kirad #7: cliente forja mensagem origin='clickup' → erro
      BEGIN
        INSERT INTO portal.demand_messages (demand_id, user_id, content, origin)
        VALUES (v_dem_id, v_uid, 'equipe forjada', 'clickup');
        rep := rep || E'\n(i4) FALHOU: cliente gravou mensagem origin=clickup';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
        rep := rep || E'\n(i4) ' || CASE WHEN v_hint = 'system_message_guard' THEN 'OK' ELSE 'VERIFICAR' END
            || ' sqlstate=' || v_state || ' msg="' || v_msg || '"';
      END;

      -- (i5) kirad #8: cliente troca clickup_task_id da própria demanda → erro
      BEGIN
        UPDATE portal.demands SET clickup_task_id = 'task-de-outro-cliente' WHERE id = v_dem_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        rep := rep || E'\n(i5) ' || CASE WHEN v_n = 0 THEN 'INCONCLUSIVO (RLS escondeu a linha)'
                                          ELSE 'FALHOU: cliente trocou clickup_task_id' END;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_det = PG_EXCEPTION_DETAIL, v_hint = PG_EXCEPTION_HINT;
        rep := rep || E'\n(i5) ' || CASE WHEN v_hint = 'demand_protected_field' AND v_det = 'clickup_task_id' THEN 'OK' ELSE 'VERIFICAR' END
            || ' sqlstate=' || v_state || ' detail=' || coalesce(v_det, '-');
      END;

      -- (i6) fluxo que NÃO pode quebrar: UPDATE direto de title continua passando
      BEGIN
        UPDATE portal.demands SET title = '095 teste c (renomeada)' WHERE id = v_dem_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        rep := rep || E'\n(i6) ' || CASE WHEN v_n = 1 THEN 'OK' ELSE 'INCONCLUSIVO' END
            || ' UPDATE de title pelo cliente: ' || v_n || ' linha(s) (esperado 1 — depende só da policy de UPDATE)';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        rep := rep || E'\n(i6) FALHOU: UPDATE de title barrado sqlstate=' || v_state || ' msg="' || v_msg || '"';
      END;
    END IF;

    PERFORM set_config('role', 'none', true);
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
  END IF;

  -- ===== (g) como service_role =====
  IF v_uid2 IS NULL THEN
    rep := rep || E'\n(g) PULADO: nenhum usuário cliente';
  ELSE
    PERFORM set_config('role', 'service_role', true);
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);

    INSERT INTO portal.demands (client_slug, created_by, title, description, status)
    VALUES (v_slug2, v_uid2, '095 teste g (legado, sem prazo)', '', 'open')
    RETURNING id INTO v_leg;

    -- Linha de base = maior id da fila AGORA. Conta-se por id > base (não por total):
    -- o worker do pg_net apaga linhas processadas de outras sessões no meio do teste;
    -- as nossas (não commitadas) ele não enxerga. Tráfego concorrente commitado nesses
    -- milissegundos poderia inflar a contagem — nunca reduzi-la.
    PERFORM set_config('role', 'none', true);
    SELECT coalesce(max(id), 0) INTO q_cc0 FROM net.http_request_queue;
    PERFORM set_config('role', 'service_role', true);


    v_res := portal.apply_clickup_due_change(v_leg, NULL, NULL, 'teste_095');
    rep := rep || E'\n(g0) data removida → ' || v_res::text || ' (esperado ignored_null)';

    v_res := portal.apply_clickup_due_change(v_leg, v_ts1, true, 'teste_095');
    SELECT count(*) INTO v_n FROM portal.demand_messages WHERE demand_id = v_leg;
    rep := rep || E'\n(g1) semeia → ' || v_res::text || ' mensagens=' || v_n
        || CASE WHEN v_res ->> 'result' = 'seeded' AND v_n = 0 THEN ' OK' ELSE ' FALHOU' END;

    v_res := portal.apply_clickup_due_change(v_leg, v_ts1 + interval '3 days 2 hours', true, 'teste_095');
    SELECT count(*), max(content) INTO v_n, v_msg FROM portal.demand_messages
     WHERE demand_id = v_leg AND origin = 'system' AND user_id IS NULL;
    SELECT * INTO v_dem FROM portal.demands WHERE id = v_leg;
    rep := rep || E'\n(g2) remarca → ' || v_res::text || ' mensagens_system=' || v_n || ' texto="' || coalesce(v_msg, '') || '"'
        || ' due_previous_at=' || coalesce(v_dem.due_previous_at::text, 'null')
        || ' ends_at=' || coalesce(v_dem.ends_at::text, 'null')
        || ' (esperado ' || ((v_ts1 + interval '3 days 2 hours') AT TIME ZONE c_tz)::date || ')'
        || CASE WHEN v_res ->> 'result' = 'notified' AND v_n = 1 AND v_dem.due_previous_at = v_ts1
                     AND v_dem.ends_at = ((v_ts1 + interval '3 days 2 hours') AT TIME ZONE c_tz)::date
                THEN ' OK' ELSE ' FALHOU' END;

    v_res := portal.apply_clickup_due_change(v_leg, v_ts1 + interval '3 days 2 hours', NULL, 'teste_095');
    rep := rep || E'\n(g3) mesma data → ' || v_res::text || CASE WHEN v_res ->> 'result' = 'no_change' THEN ' OK' ELSE ' FALHOU' END;

    PERFORM set_config('role', 'none', true);
    SELECT count(*) FILTER (WHERE url LIKE '%clickup-comment-sync%'),
           count(*) FILTER (WHERE url LIKE '%send-email%'),
           count(*) FILTER (WHERE url LIKE '%/clickup-sync%')
      INTO q_cc1, q_mail1, q_sync1 FROM net.http_request_queue WHERE id > q_cc0;
    rep := rep || E'\n(g4) fila pg_net enfileirada em g1..g3: clickup-comment-sync +' || q_cc1
        || ' (esperado 0 — mensagem system NÃO vira comentário), send-email +' || q_mail1
        || ' (esperado 1 — só a remarcação; 0 se clickup_sync_internal_key ausente), clickup-sync +' || q_sync1
        || ' (esperado 0 — remarcação não volta ao ClickUp)'
        || CASE WHEN q_cc1 = 0 AND q_sync1 = 0 AND q_mail1 = 1 THEN ' OK' ELSE ' VERIFICAR' END;
    PERFORM set_config('request.jwt.claims', '', true);
  END IF;

  -- ===== (h) EXPLAIN (ANALYZE) — lookups do caminho quente =====
  PERFORM set_config('role', 'none', true);
  SELECT clickup_task_id INTO v_task FROM portal.demands WHERE clickup_task_id IS NOT NULL LIMIT 1;
  rep := rep || E'\n(h1) EXPLAIN webhook: demands por clickup_task_id';
  FOR v_line IN EXECUTE format(
    'EXPLAIN (ANALYZE, BUFFERS) SELECT id, status, title, description, starts_at, ends_at, clickup_task_id, finalized_at, due_at, briefing
       FROM portal.demands WHERE clickup_task_id = %L', coalesce(v_task, 'inexistente'))
  LOOP rep := rep || E'\n    ' || v_line; END LOOP;

  rep := rep || E'\n(h2) EXPLAIN apply_clickup_due_change: SELECT ... FOR UPDATE por id';
  FOR v_line IN EXECUTE format(
    'EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM portal.demands WHERE id = %L FOR UPDATE',
    coalesce(v_leg, v_dem_id, gen_random_uuid()))
  LOOP rep := rep || E'\n    ' || v_line; END LOOP;

  SELECT count(*) INTO v_n FROM portal.demands;
  rep := rep || E'\n[escala] linhas em portal.demands = ' || v_n;

  RAISE EXCEPTION USING ERRCODE = 'P0095', MESSAGE = rep;
END
$verif$;
