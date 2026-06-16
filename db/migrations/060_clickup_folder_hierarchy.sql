-- 060_clickup_folder_hierarchy
-- Hierarquia de 3 camadas no ClickUp: Pasta(aluno) → Lista(projeto) → Tarefa(demanda).
-- Antes: cada cliente era uma lista folderless (clients.cu_list_id) e o projeto era só
-- um prefixo "[Projeto]" no nome da tarefa. Agora:
--   • clients.cu_folder_id      → a PASTA do aluno no espaço do ClickUp.
--   • clients.cu_inbox_list_id  → a lista "Avulsas" (demandas sem projeto) dentro da pasta.
--   • projects.cu_list_id       → a LISTA do projeto dentro da pasta do aluno.
-- A edge clickup-sync provisiona pasta/listas sob demanda e guarda os ids aqui.
-- clients.cu_list_id (lista antiga folderless) é mantida só como legado/fallback.
ALTER TABLE portal.clients  ADD COLUMN IF NOT EXISTS cu_folder_id     text;
ALTER TABLE portal.clients  ADD COLUMN IF NOT EXISTS cu_inbox_list_id text;
ALTER TABLE portal.projects ADD COLUMN IF NOT EXISTS cu_list_id       text;

COMMENT ON COLUMN portal.clients.cu_folder_id     IS 'ClickUp folder id da pasta do aluno (hierarquia 3 camadas).';
COMMENT ON COLUMN portal.clients.cu_inbox_list_id IS 'ClickUp list id da lista "Avulsas" do aluno (demandas sem projeto).';
COMMENT ON COLUMN portal.projects.cu_list_id      IS 'ClickUp list id da lista do projeto dentro da pasta do aluno.';
