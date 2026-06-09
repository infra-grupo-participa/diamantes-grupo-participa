# TL-Spec: Projetos & Briefing de Abertura
**Versão:** 1.0 — Maio/2026  
**Status:** Em definição  
**Autor:** Márcio / Claude  

---

## 1. Contexto e Problema

Hoje o cliente abre uma demanda com apenas título e descrição livre. O operador recebe a tarefa sem contexto operacional mínimo: sem acessos confirmados, sem orçamento, sem links de conta. Resultado: 80% do tempo inicial da demanda é gasto em troca de mensagens pedindo informação básica.

O **Termo de Abertura** (documento existente por serviço) resolve isso: é um formulário estruturado que o cliente preenche uma vez por projeto/ciclo. Todas as demandas daquele ciclo herdam o contexto.

---

## 2. Decisões de Produto

| Decisão | Escolha |
|---|---|
| Escopo do briefing | **Por projeto/ciclo** — 1 briefing por campanha, múltiplas demandas herdam |
| Gatilho | **Fluxo separado** — cliente cria o Projeto antes de criar demandas |
| Obrigatoriedade | **🔴 bloqueiam envio** — campos críticos obrigatórios para liberar à equipe |
| Serviços previstos | Anúncios Pagos, Design Gráfico, Edição de Vídeo, Social Media/Copy, Web Design/Automação |

---

## 3. Modelo de Dados

### 3.1 Nova tabela: `portal.projects`

```sql
CREATE TABLE portal.projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_slug     text NOT NULL REFERENCES portal.clients(slug),
  created_by      uuid NOT NULL REFERENCES portal.users(id),
  title           text NOT NULL,               -- ex: "Seminário Tributário Jun/26"
  service_type    text NOT NULL,               -- ver enum abaixo
  status          text NOT NULL DEFAULT 'briefing',
  -- briefing
  briefing        jsonb NOT NULL DEFAULT '{}', -- respostas do formulário
  briefing_status text NOT NULL DEFAULT 'draft',
  briefing_submitted_at timestamptz,
  -- meta
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT projects_service_type_check CHECK (service_type IN (
    'anuncios_pagos', 'design_grafico', 'edicao_video',
    'social_media', 'web_design_automacao'
  )),
  CONSTRAINT projects_status_check CHECK (status IN (
    'briefing', 'active', 'completed', 'cancelled'
  )),
  CONSTRAINT projects_briefing_status_check CHECK (briefing_status IN (
    'draft', 'submitted'
  ))
);

CREATE INDEX idx_projects_client_slug ON portal.projects(client_slug);
CREATE INDEX idx_projects_status      ON portal.projects(status);
```

### 3.2 Alteração: `portal.demands`

```sql
ALTER TABLE portal.demands
  ADD COLUMN project_id uuid REFERENCES portal.projects(id) ON DELETE SET NULL;

CREATE INDEX idx_demands_project_id ON portal.demands(project_id);
```

### 3.3 Estrutura do JSONB `briefing`

O JSON segue o esquema:
```json
{
  "schema_version": "anuncios_pagos@1.1",
  "sections": {
    "identificacao": {
      "expert_name":        "Naírio Silveira",
      "company_name":       "NS Consultoria",
      "niche":              "Reforma Tributária",
      "seminar_code":       "SEMJUN26",
      "seminar_date":       "2026-06-15",
      "account_manager":    "Renan",
      "coordinator":        ""
    },
    "meta_ads": {
      "bm_admin_email":     "nairo@ns.com",
      "ad_account_id":      "123456789",
      "facebook_page":      "NairiSilveira",
      "instagram_account":  "@nairi",
      "has_pixel":          true,
      "pixel_id":           "987654321",
      "campaign_history":   "existe"
    },
    "google_ads": {
      "account_id":         "123-456-7890",
      "verification_status": "approved",
      "admin_granted":      true,
      "youtube_channel":    "UC...",
      "has_ga4":            false
    },
    "financeiro": {
      "meta_card_last4":    "1234",
      "meta_card_backup":   false,
      "google_card_last4":  "5678",
      "google_card_backup": false,
      "payment_mode":       "pos_pago"
    },
    "stape": {
      "use_stape":          true,
      "account_created":    false,
      "plan":               ""
    },
    "looker": {
      "photo_url":          "",
      "brand_colors":       "#FF5733,#FFFFFF",
      "client_email":       "nairo@ns.com",
      "wants_meeting":      false
    },
    "orcamento": {
      "total_budget":       15000,
      "distribution":       "70/15/15",
      "max_cpl":            25,
      "lead_goal":          600,
      "war_budget":         1000,
      "previous_seminars":  "4+",
      "best_cpl":           18,
      "has_lead_list":      false
    },
    "camadas": {
      "organic_commitment": true,
      "has_pauta_bank":     true,
      "reels_stock":        12,
      "carrossel_stock":    5,
      "sends_organic_metrics": true,
      "custom_layer_split": false
    }
  }
}
```

---

## 4. Templates de Briefing por Serviço

Os templates vivem no frontend como objetos JS (sem tabela no banco — mais fácil de versionar e evoluir). Estrutura de um campo:

```javascript
{
  id: 'meta_card_last4',
  label: 'Cartão principal Meta Ads',
  hint: 'Bandeira + últimos 4 dígitos + validade',
  type: 'text',        // text | number | boolean | select | date | url
  priority: 'red',     // red | yellow | green
  section: 'financeiro',
  required: true,      // derivado de priority === 'red'
  options: null        // para type === 'select'
}
```

**Arquivo:** `portal/assets/briefing-templates.js` — exporta `BRIEFING_TEMPLATES[service_type]`.

---

## 5. RPCs necessárias

### `portal.create_project(p_title, p_service_type)`
- Verifica `role IN ('user','client')` e `status='approved'`
- Insere em `portal.projects` com `client_slug` do chamador
- Retorna o projeto criado

### `portal.save_briefing_draft(p_project_id, p_answers jsonb)`
- Só o dono do projeto pode chamar (RLS ou verificação explícita)
- Faz merge `briefing = briefing || p_answers` (sem sobrescrever tudo)
- Atualiza `updated_at`

### `portal.submit_briefing(p_project_id)`
- Valida que todos os campos `priority='red'` estão preenchidos no JSON
  - A lógica de validação fica no frontend; o RPC faz validação básica (JSON não vazio)
- Seta `briefing_status='submitted'`, `briefing_submitted_at=now()`, `status='active'`
- Cria notificação/audit_log entry

### Atualização: `portal.create_demand`
- Aceita novo parâmetro opcional `p_project_id uuid DEFAULT NULL`
- Se fornecido, valida que o projeto pertence ao cliente e está `status='active'`
- Salva `project_id` na demanda

---

## 6. RLS

```sql
-- projects: cliente vê só os seus
CREATE POLICY projects_client_select ON portal.projects
  FOR SELECT TO authenticated
  USING (
    client_slug = (SELECT client_slug FROM portal.users WHERE auth_user_id = auth.uid())
    OR portal.is_admin()
  );

-- projects: cliente cria só para si
CREATE POLICY projects_client_insert ON portal.projects
  FOR INSERT TO authenticated
  WITH CHECK (
    client_slug = (SELECT client_slug FROM portal.users WHERE auth_user_id = auth.uid())
  );

-- projects: cliente pode editar briefing enquanto draft
CREATE POLICY projects_client_update ON portal.projects
  FOR UPDATE TO authenticated
  USING (
    client_slug = (SELECT client_slug FROM portal.users WHERE auth_user_id = auth.uid())
    AND briefing_status = 'draft'
    OR portal.is_admin()
  );

-- Operadores podem ver projetos dos seus clientes (via team_assignments)
CREATE POLICY projects_operator_select ON portal.projects
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM portal.team_assignments ta
      JOIN portal.operators op ON op.id = ta.operator_id
      JOIN portal.users u ON u.email = op.email
      WHERE ta.client_slug = portal.projects.client_slug
        AND u.auth_user_id = auth.uid()
    )
    OR portal.is_admin()
  );
```

---

## 7. Frontend — Páginas e Fluxo

### 7.1 Fluxo do cliente

```
dashboard.html
  └── "Novo Projeto" (botão novo no header)
        └── novo-projeto.html
              1. Escolhe tipo de serviço (cards com ícone)
              2. Digita nome/título do projeto
              3. → briefing.html?projeto=UUID
                    - Wizard multi-seção (tabs laterais)
                    - Barra de progresso por seção
                    - Salva rascunho a cada blur (debounce 1s)
                    - Badge 🔴/🟡/🟢 em cada campo
                    - Botão "Salvar Rascunho" sempre visível
                    - Botão "Enviar para a Equipe" (ativo só se 🔴 todos preenchidos)

demandas.html
  └── "Nova Demanda" (modal atual)
        ├── Se não há projeto active → banner "Você precisa ter um Projeto ativo"
        └── Se há projetos → dropdown "Vincular a projeto (opcional)"
```

### 7.2 Fluxo do admin

```
admin/projetos.html (nova página)
  - Lista todos os projetos por cliente
  - Filtra por: serviço, status, briefing_status
  - Clique → visualiza briefing completo (read-only, formatado por seção)
  - Badge de completude: "6/8 seções completas"
```

### 7.3 Novos arquivos

| Arquivo | Descrição |
|---|---|
| `portal/novo-projeto.html` | Seleção de serviço + título |
| `portal/briefing.html` | Wizard multi-step do briefing |
| `portal/assets/briefing-templates.js` | Templates por serviço (Anúncios Pagos v1.1 + futuros) |
| `admin/projetos.html` | Painel de projetos (admin) |

---

## 8. Migração

```
db/migrations/029_projects_and_briefing.sql
```

Contém (em ordem):
1. `CREATE TABLE portal.projects`
2. `ALTER TABLE portal.demands ADD COLUMN project_id`
3. RLS policies
4. `CREATE FUNCTION portal.create_project`
5. `CREATE FUNCTION portal.save_briefing_draft`
6. `CREATE FUNCTION portal.submit_briefing`
7. Atualização de `portal.create_demand` para aceitar `p_project_id`

---

## 9. Fora de Escopo (v1)

- Templates de briefing editáveis pelo admin via UI
- Assinatura digital do Termo
- Versionamento de templates no banco
- Briefings de outros serviços (Design, Vídeo, Social, Web) — estrutura está pronta, templates JS serão adicionados depois
- Notificação por e-mail ao submeter briefing

---

## 10. Decisões fechadas

| Questão | Decisão |
|---|---|
| Nomenclatura no portal | **"Projeto"** — "Novo Projeto" / "Meus Projetos" |
| Aprovação do briefing | **Submit do cliente ativa direto** — sem step de aprovação admin |
| Vincular projeto à demanda | **Opcional em v1** — demandas avulsas continuam funcionando |
| Múltiplos projetos do mesmo serviço | Permitido — sem restrição de unicidade |
| Operadores vs projeto | Apenas visualizam passivamente (read-only) |
