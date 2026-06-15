-- 049_external_clickup_author
-- Permite mensagens de autores do ClickUp SEM vínculo de operador no portal
-- (pessoas de fora da equipe que respondem na task). O nome de exibição vindo do
-- ClickUp fica em clickup_author; user_id fica null nesses casos.
-- A RLS de INSERT continua exigindo user_id = próprio id (cliente não insere null);
-- só o webhook (service-role) insere autor externo.
-- Aplicada via MCP em npqyvjhvtfahuxfmuhie.

ALTER TABLE portal.demand_messages ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE portal.demand_messages ADD COLUMN IF NOT EXISTS clickup_author text;

-- RPCs do chat: nome = users.name OU clickup_author OU 'Equipe'; role externo = 'operator'.
CREATE OR REPLACE FUNCTION portal.get_demand_messages(p_demand_id uuid)
RETURNS TABLE (
  id uuid, user_id uuid, content text, attachments jsonb, origin text,
  created_at timestamptz, clickup_comment_id text,
  author_name text, author_role text, avatar_url text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'portal','public'
AS $$
BEGIN
  IF NOT portal.can_access_demand(p_demand_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta demanda.';
  END IF;
  RETURN QUERY
    SELECT m.id, m.user_id, m.content, m.attachments, m.origin, m.created_at,
           m.clickup_comment_id,
           COALESCE(u.name, m.clickup_author, 'Equipe'),
           COALESCE(u.role, 'operator'),
           (u.metadata->>'avatar_url')
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'portal','public'
AS $$
DECLARE v_demand uuid;
BEGIN
  SELECT demand_id INTO v_demand FROM portal.demand_messages WHERE id = p_message_id;
  IF v_demand IS NULL OR NOT portal.can_access_demand(v_demand) THEN
    RAISE EXCEPTION 'Sem acesso a esta mensagem.';
  END IF;
  RETURN QUERY
    SELECT m.id, m.user_id, m.content, m.attachments, m.origin, m.created_at,
           m.clickup_comment_id,
           COALESCE(u.name, m.clickup_author, 'Equipe'),
           COALESCE(u.role, 'operator'),
           (u.metadata->>'avatar_url')
    FROM portal.demand_messages m
    LEFT JOIN portal.users u ON u.id = m.user_id
    WHERE m.id = p_message_id;
END;
$$;
