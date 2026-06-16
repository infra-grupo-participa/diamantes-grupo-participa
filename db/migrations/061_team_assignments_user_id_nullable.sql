-- 061_team_assignments_user_id_nullable
-- Atribuir operador a um aluno falhava com "null value in column user_id ... violates
-- not-null constraint". O vínculo real é por operator_id (operadores não têm login);
-- user_id é coluna legada. A camada agora preenche user_id por e-mail quando existe,
-- mas tornamos a coluna NULLABLE para operadores sem user não quebrarem.
ALTER TABLE portal.team_assignments ALTER COLUMN user_id DROP NOT NULL;
