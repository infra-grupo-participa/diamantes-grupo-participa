-- 048_get_demand_messages_with_author
-- Chat: o cliente não pode ler portal.users de OUTROS (RLS users_select_own),
-- então o nome do operador/admin aparecia como "Alguém". Estes RPCs SECURITY
-- DEFINER devolvem as mensagens JÁ com o nome/role/avatar do autor, validando
-- o acesso à demanda via portal.can_access_demand (mesma checagem da RLS).
-- Aplicada via MCP em npqyvjhvtfahuxfmuhie.

CREATE OR REPLACE FUNCTION portal.get_demand_messages(p_demand_id uuid)
RETURNS TABLE (
  id uuid, user_id uuid, content text, attachments jsonb, origin text,
  created_at timestamptz, clickup_comment_id text,
  author_name text, author_role text, avatar_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal','public'
AS $$
BEGIN
  IF NOT portal.can_access_demand(p_demand_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta demanda.';
  END IF;
  RETURN QUERY
    SELECT m.id, m.user_id, m.content, m.attachments, m.origin, m.created_at,
           m.clickup_comment_id, u.name, u.role, (u.metadata->>'avatar_url')
    FROM portal.demand_messages m
    LEFT JOIN portal.users u ON u.id = m.user_id
    WHERE m.demand_id = p_demand_id
    ORDER BY m.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION portal.get_demand_message(p_message_id uuid)
RETURNS TABLE (
  id uuid, user_id uuid, content text, attachments jsonb, origin text,
  created_at timestamptz, clickup_comment_id text,
  author_name text, author_role text, avatar_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal','public'
AS $$
DECLARE v_demand uuid;
BEGIN
  SELECT demand_id INTO v_demand FROM portal.demand_messages WHERE id = p_message_id;
  IF v_demand IS NULL OR NOT portal.can_access_demand(v_demand) THEN
    RAISE EXCEPTION 'Sem acesso a esta mensagem.';
  END IF;
  RETURN QUERY
    SELECT m.id, m.user_id, m.content, m.attachments, m.origin, m.created_at,
           m.clickup_comment_id, u.name, u.role, (u.metadata->>'avatar_url')
    FROM portal.demand_messages m
    LEFT JOIN portal.users u ON u.id = m.user_id
    WHERE m.id = p_message_id;
END;
$$;

GRANT EXECUTE ON FUNCTION portal.get_demand_messages(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION portal.get_demand_message(uuid)  TO authenticated;
