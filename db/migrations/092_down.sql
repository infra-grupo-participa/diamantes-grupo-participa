-- 092_down — reversão da 092_operators_clickup_user_id_unique.
-- Uso: incidente/rollback deliberado. Não destrutivo (remove só o índice; nenhuma
-- coluna/dado é apagado). NÃO faz parte do fluxo numerado de `supabase db push` —
-- script avulso, rodar manualmente (psql/MCP) fora de uma migration sequencial.
--
-- ⚠️ Reverter isto reabre a janela do achado de pentest (duplicata em
-- clickup_user_id volta a ser aceita) — só reverter se a 091 também for desligada
-- junto, ou se houver plano de correção equivalente.

DROP INDEX IF EXISTS portal.uq_operators_clickup_user_id;
