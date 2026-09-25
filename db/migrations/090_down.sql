-- 090_down — reverte 090_cron_reconcile_assignees
--
-- Desagenda o job e remove o wrapper. Reversão LIMPA: o cron só LÊ o ClickUp e grava
-- clickup_assignee_sync/detail (nenhuma escrita em demand_operators vem daqui — isso é
-- da 091). Desligar só faz o estado de sync parar de ser atualizado pela rede de
-- segurança; o webhook continua funcionando em tempo real.
--
-- Reversão SEM DEPLOY (preferir esta em incidente): `select cron.unschedule
-- ('reconcile-assignees');` sozinho já para o job, sem mexer em função nem em código.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-assignees') THEN
    PERFORM cron.unschedule('reconcile-assignees');
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS portal._cron_reconcile_assignees();

-- ── Reverte o drift-check: remove `assignee_alert_to` das chaves esperadas ──
-- Restaura o corpo EXATO da 087 (cópia literal, sem a chave nova). Necessário só se a
-- 088 também for revertida — com a 088 aplicada, manter a chave na lista é o correto e
-- este bloco pode ser pulado.
CREATE OR REPLACE FUNCTION portal.get_schema_drift_status(p_force_refresh boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'portal', 'public'
AS $function$
DECLARE
  v_cached portal.schema_drift_cache;
  v_missing jsonb;
  v_config_missing jsonb;
  v_result jsonb;
BEGIN
  IF NOT portal.is_admin() THEN
    RAISE EXCEPTION 'Apenas admin pode consultar o status de drift do schema.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cached FROM portal.schema_drift_cache WHERE id = 1;
  -- TTL de 5 min: a tela pode dar refresh sem custo, mas não recomputa a cada render.
  IF NOT p_force_refresh AND v_cached.id IS NOT NULL AND v_cached.computed_at > now() - interval '5 minutes' THEN
    RETURN v_cached.result;
  END IF;

  -- Colunas esperadas (código) que NÃO existem em information_schema.columns (schema real).
  SELECT coalesce(jsonb_agg(jsonb_build_object('table', e.table_name, 'column', e.column_name)), '[]'::jsonb)
    INTO v_missing
    FROM portal._expected_columns() e
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'portal' AND c.table_name = e.table_name AND c.column_name = e.column_name
   );

  -- Chaves esperadas em clickup_config que ainda não foram inseridas (migration
  -- rodou o DDL mas o INSERT ... ON CONFLICT DO NOTHING pode ter sido pulado se a
  -- tabela não existir ainda, ou a migration não rodou de todo).
  SELECT coalesce(jsonb_agg(k), '[]'::jsonb) INTO v_config_missing
    FROM unnest(ARRAY['assignee_strategy','assignee_alert_email','space_multi_assignee_cache','guest_clickup_ids_cache']) AS k
   WHERE NOT EXISTS (SELECT 1 FROM portal.clickup_config cc WHERE cc.key = k);

  v_result := jsonb_build_object(
    'ok', (v_missing = '[]'::jsonb AND v_config_missing = '[]'::jsonb),
    'missing_columns', v_missing,
    'missing_config_keys', v_config_missing,
    'checked_at', now()
  );

  INSERT INTO portal.schema_drift_cache (id, computed_at, result)
  VALUES (1, now(), v_result)
  ON CONFLICT (id) DO UPDATE SET computed_at = excluded.computed_at, result = excluded.result;

  RETURN v_result;
END;
$function$;

-- Função nova em schema exposto nasce pública — GRANT explícito só para authenticated.
GRANT EXECUTE ON FUNCTION portal.get_schema_drift_status(boolean) TO authenticated;
