-- ============================================================================
-- 014_get_my_dashboard_services_fix.sql
-- get_my_dashboard: inclui delinquent nos serviços retornados e expõe
-- offer_code + access_until para a UI diferenciar active de delinquent.
-- ============================================================================

CREATE OR REPLACE FUNCTION portal.get_my_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal', 'public'
AS $$
DECLARE
  v_user    portal.users%ROWTYPE;
  v_client  portal.clients%ROWTYPE;
  v_profile jsonb;
  v_team    jsonb;
  v_services jsonb;
  v_activity jsonb;
BEGIN
  SELECT * INTO v_user FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF v_user.client_slug IS NULL THEN
    RAISE EXCEPTION 'Usuário sem cliente vinculado.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_client FROM portal.clients WHERE slug = v_user.client_slug;
  SELECT data INTO v_profile FROM portal.client_profiles WHERE client_slug = v_user.client_slug;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.position_sort), '[]'::jsonb) INTO v_team
  FROM (
    SELECT
      ta.id         AS assignment_id,
      u.id          AS user_id,
      u.name        AS user_name,
      u.email       AS user_email,
      p.id          AS position_id,
      p.name        AS position_name,
      p.color       AS position_color,
      p.sort_order  AS position_sort
    FROM portal.team_assignments ta
    JOIN portal.users u ON u.id = ta.user_id
    JOIN portal.positions p ON p.id = ta.position_id
    WHERE ta.client_slug = v_user.client_slug
  ) t;

  -- active primeiro (ORDER BY status DESC = 'delinquent' antes em alpha, invertemos com ASC)
  SELECT COALESCE(jsonb_agg(s ORDER BY s.status ASC, s.service_type), '[]'::jsonb) INTO v_services
  FROM (
    SELECT id, service_type, status, offer_code, access_until, metadata, created_at
    FROM portal.services
    WHERE client_slug = v_user.client_slug
      AND status IN ('active', 'delinquent')
  ) s;

  SELECT COALESCE(jsonb_agg(a ORDER BY a.created_at DESC), '[]'::jsonb) INTO v_activity
  FROM (
    SELECT event, metadata, created_at
    FROM portal.audit_log
    WHERE (metadata->>'client_slug') = v_user.client_slug
    ORDER BY created_at DESC
    LIMIT 10
  ) a;

  RETURN jsonb_build_object(
    'user', jsonb_build_object(
      'id', v_user.id,
      'name', v_user.name,
      'email', v_user.email,
      'client_slug', v_user.client_slug
    ),
    'client', jsonb_build_object(
      'slug', v_client.slug,
      'display_name', v_client.display_name,
      'primary_color', v_client.primary_color
    ),
    'profile', COALESCE(v_profile, '{}'::jsonb),
    'team', v_team,
    'services', v_services,
    'activity', v_activity
  );
END;
$$;

GRANT EXECUTE ON FUNCTION portal.get_my_dashboard() TO authenticated;
REVOKE EXECUTE ON FUNCTION portal.get_my_dashboard() FROM anon;

-- ============================================================================
-- Fim 014_get_my_dashboard_services_fix.sql
-- ============================================================================
