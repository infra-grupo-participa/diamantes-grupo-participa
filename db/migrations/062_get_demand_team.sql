-- 062_get_demand_team
-- "Pessoas envolvidas" não mostrava os operadores ATRIBUÍDOS à demanda: o cliente
-- lê demand_operators via RLS e recebe 0 linhas (tabela interna). Só o autor externo
-- aparecia (esse vem resolvido por get_demand_messages, SECURITY DEFINER). Espelha-se
-- esse padrão: RPC SECURITY DEFINER que devolve os operadores da demanda já resolvidos
-- (nome/setor), com checagem de acesso do chamador (dono da demanda ou admin).
CREATE OR REPLACE FUNCTION portal.get_demand_team(p_demand_id uuid)
 RETURNS TABLE(operator_id uuid, name text, email text, position_name text, position_color text, added_at timestamptz)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'portal', 'public'
AS $function$
  SELECT o.id, o.name, o.email, p.name, p.color, dop.added_at
  FROM portal.demand_operators dop
  JOIN portal.operators o ON o.id = dop.operator_id
  LEFT JOIN portal.positions p ON p.id = o.position_id
  WHERE dop.demand_id = p_demand_id
    AND (portal.can_access_demand(p_demand_id) OR portal.is_admin())
  ORDER BY o.name;
$function$;

GRANT EXECUTE ON FUNCTION portal.get_demand_team(uuid) TO authenticated;
