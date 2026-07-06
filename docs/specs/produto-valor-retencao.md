# Spec de produto — de "service desk" para "motor de valor e retenção"

> Portal cliente do programa Diamantes (Grupo Participa). Este documento traduz a
> virada de produto em um blueprint implementável, aterrissado no schema atual.
> Estado: proposta aprovada nas 3 decisões estratégicas (abaixo). Falta detalhar
> tarefas e executar por fase.

## 1. Contexto e tese

O Diamantes é um **negócio de assinatura** (`MRR = contrato`, `access_until` renova
todo mês). O portal atual é um **service desk de agência**: hierarquia
`Cliente → Serviços contratados (Hotmart) → Projetos/Eventos → Demandas (chamados de chat)`,
com pedidos **ilimitados e paralelos** para uma **equipe fixa pré-atribuída**.

**Furo central (de finalidade, não técnico):** o portal foi feito para *começar
trabalho*, não para *provar valor* nem *reter*. Não há prova de valor (resultados
vivem no Looker externo; entregas ficam enterradas no chat), não há momento de
renovação (`access_until` é invisível ao cliente), o loop de avaliação foi
desligado, e não há gestão de expectativa (prazo é chutado pelo cliente).

**Tese:** toda visita ao portal deve responder, sem esforço: *o que eu já recebi*,
*o que está rolando e quando fica pronto*, *qual meu próximo passo*, *por que vale
continuar*.

## 2. Decisões estratégicas (aprovadas)

1. **Modelo de serviço:** manter **ilimitado**, mas com **promessa de prazo por
   tipo de serviço** + **status honesto de fila**. (Não vira cota.)
2. **Prova de valor:** **trazer pra dentro do portal** — área de Entregas
   (galeria persistente) + Resultados (Looker) embutidos por serviço.
3. **Acesso expirado:** **soft-degrade + nudge** — avisa antes de vencer; ao
   expirar, portal em leitura (vê histórico/entregas, não abre novas demandas)
   com CTA de renovar.

---

## 3. Camada 1 — Expectativa & capacidade

### 3.1 `service_type` explícito na demanda
Hoje a demanda **não** tem tipo; a "categoria" é inferida do cargo do operador
(`categoryOf()` em `app/portal/demandas/page.tsx`). Isso é frágil e bloqueia
roteamento, prazo coerente e "valor por serviço".

- **Schema:** `alter table portal.demands add column service_type text;`
  Backfill dos existentes pela regra atual (cargo do operador designado).
- **Categorias** (derivadas do mapa canônico): `trafego`, `video`, `design`,
  `paginas`, `automacao`, `geral`. No modal, oferecer **apenas** as categorias
  cujos serviços o cliente contratou (interseção com `services` ativos) + `geral`.
- **Passo 1 do modal** passa a ser "que tipo de trabalho?" — hoje o passo 1 é só
  "chamado simples vs. de projeto" (`NewDemandModal.tsx:210-231`). O tipo dirige
  roteamento e prazo.

### 3.2 Promessa de prazo por categoria
Substitui o cliente adivinhar uma data (hoje `ends_at` é escolha livre, mín. 2
d.ú., sugestão 5 d.ú. — `NewDemandModal.tsx:23-40`).

- **Config (admin-tunável):** `portal.service_turnaround(service_type text pk,
  business_days int)`. Seed sugerido: design 3, video 5, paginas 7, trafego 5,
  automacao 5, geral 3.
- **`ends_at` vira "entrega prometida"** = hoje + `business_days` (dias úteis),
  pré-preenchido e explicado ("Entrega prevista: 12/07 — Design leva ~3 dias
  úteis"). Cliente pode marcar **`is_urgent`** (`add column is_urgent boolean
  default false`) → sinaliza a equipe, não só muda a data.

### 3.3 Roteamento automático (e fim do beco A2)
- Ao escolher a categoria, **auto-selecionar** os operadores da equipe cujo
  `position_name` casa com aquela categoria (hoje o cliente escolhe manualmente
  entre toda a equipe — `NewDemandModal.tsx:126-128`). Cliente ainda pode ajustar.
- **A2 (cliente sem equipe trava):** nunca dead-end. Sem `team_assignments`, a
  demanda é criada mesmo assim como **intake pendente de atribuição**
  (`add column pending_assignment boolean default false`), e o admin é
  notificado. O safety-net do backend já autopreenche equipe quando ela existe
  (`051:41-50`); estende-se para o caso "sem equipe" criando pendência em vez de
  barrar.

### 3.4 Status honesto de fila
- Renomear/estender a timeline visível: `recebido → na fila → em produção → em
  revisão → concluída` (hoje `open → in_progress → review → done`), com **data
  prometida** e selo *no prazo/atrasada* por demanda.
- Opcional (leve): no card da demanda, "sua equipe tem N pedidos ativos" para
  contextualizar espera sem expor operação interna.

---

## 4. Camada 2 — Prova de valor dentro do portal

### 4.1 Área "Entregas" (galeria persistente)
Hoje o entregável é um anexo enterrado no chat (`demandas/page.tsx:669-699`).

- **View `portal.v_client_deliverables`** (⚠️ criar com `security_invoker=on` —
  ver §7): anexos de mensagens de demandas que chegaram a `review`/`done`,
  com `client_slug`, `service_type`, `project_id`, `demand_id`, url assinada,
  thumbnail (se imagem), `delivered_at`.
- **Rota `/portal/entregas`** + card no dashboard: grade de entregáveis, filtro
  por serviço/projeto, link para a demanda de origem. É a resposta a "o que eu
  recebi".

### 4.2 Resultados (Looker) por serviço
Hoje o Looker é compartilhado por e-mail Google, fora do produto
(`briefing-templates.ts:414-451`).

- **Schema:** `portal.client_reports(client_slug, service_type, url, label)`
  (ou `services.report_url`). Admin cola o link do Looker por serviço.
- **UI:** aba/seção "Resultados" no serviço (tráfego/anúncios em especial) —
  embed do Looker ou botão de destaque. O portal passa a ser o dono do momento
  de ROI.

### 4.3 "Ciclo Diamante" (cabeçalho de valor)
- Deriva de `services.access_until` — sem schema novo. Cabeçalho do dashboard:
  *"Seu ciclo · renova em 12 dias · 4 entregas neste ciclo"* (contar entregas de
  `v_client_deliverables` desde o início do ciclo). Torna a renovação um marco
  positivo, não um susto.

---

## 5. Camada 3 — Acesso expirado (soft-degrade + nudge)

- **Estado de acesso** derivado do maior `access_until` dos serviços ativos:
  `active` (>7d), `expiring` (≤7d), `expired` (<0). Helper `portal.client_access_state(client_slug)`
  (ou coluna computada em `v_students`).
- **`expiring`:** banner "seu ciclo renova em X dias" + CTA renovar.
- **`expired`:** portal em **leitura** — vê dashboard, entregas, histórico e chat
  existente, mas **não abre** nova demanda/projeto nem envia nova mensagem de
  trabalho. Banner + CTA claro de renovar.
- **Enforcement em 2 camadas:** UI (banner + botões desabilitados) **e** servidor
  (`create_demand`/`create_project` recusam quando expirado — hoje só checam
  `client_base_ready`, `031:257,400`). Sem isso o bloqueio é cosmético.

---

## 6. Ativação & onboarding (primeira vitória)
- Onboarding hoje celebra "abrir 1ª demanda" (`page.tsx:202-206`). Estender para
  um **4º passo: "receber 1ª entrega"** — o momento em que o valor aparece
  (liga-se à Área de Entregas). O funil passa a mirar o *aha* de valor, não só o
  primeiro pedido.

---

## 7. Deltas de schema consolidados
```sql
-- Camada 1
alter table portal.demands add column service_type text;      -- backfill via cargo
alter table portal.demands add column is_urgent boolean default false;
alter table portal.demands add column pending_assignment boolean default false;
create table portal.service_turnaround (service_type text primary key, business_days int not null);
-- Camada 2
create view portal.v_client_deliverables ... with (security_invoker = on);  -- OBRIGATÓRIO
create table portal.client_reports (client_slug text, service_type text, url text, label text);
-- Camada 3
-- client_access_state: RPC ou coluna computada (sem tabela nova)
```
> ⚠️ **Toda view nova nasce com `security_invoker = on`.** As migrations 081/082
> corrigiram exatamente o oposto (views que ignoravam RLS). Não repetir o furo.

## 8. Roadmap sequenciado

**P0 — retenção imediata (baixo risco de schema, alto impacto):**
- Ciclo Diamante (só deriva de `access_until`).
- Área de Entregas + `v_client_deliverables`.
- Destravar A2 (intake pendente + notifica admin).
- Aceite: cliente novo nunca trava; cliente vê ≥1 entrega numa galeria; cabeçalho
  mostra dias restantes do ciclo.

**P1 — expectativa & qualidade:**
- `service_type` na demanda + roteamento automático + `service_turnaround`.
- Promessa de prazo + `is_urgent` + timeline honesta.
- Religar feedback (nota por entrega — backend já tem resquícios).
- Aceite: toda demanda nasce com tipo e data prometida; equipe é auto-roteada;
  entrega concluída pede avaliação.

**P2 — valor pleno & renovação:**
- Resultados/Looker embutidos por serviço (`client_reports`).
- Soft-degrade completo (`expiring`/`expired` + guards no servidor).
- Renovação self-service.
- Aceite: cliente vê ROI no portal; expirado entra em leitura com CTA; renova sem
  sair do produto.
