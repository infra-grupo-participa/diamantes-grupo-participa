-- 030_projects_clickup_task_id.sql
-- Adiciona coluna clickup_task_id à portal.projects
-- para que briefing-to-clickup.php salve o ID da task criada no ClickUp.

ALTER TABLE portal.projects
  ADD COLUMN IF NOT EXISTS clickup_task_id text;
