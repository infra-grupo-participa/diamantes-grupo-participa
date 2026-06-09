# Briefing em 2 Níveis + Chamados por Projeto — Specification

**Versão:** 2.0 — Junho/2026
**Status:** Em definição (aguardando aprovação para Design)
**Autor:** Márcio / Claude
**Substitui:** `docs/specs/feature-project-briefing.md` (v1.0, briefing único por projeto)

---

## Problem Statement

O modelo atual (migration 029) tem **um único briefing por projeto**, misturando dados que
nunca mudam (acessos de contas, credenciais) com dados que mudam a cada evento (orçamento,
datas, criativos). Resultado: o cliente reinforma os mesmos acessos toda vez que abre um
projeto novo, e a equipe ainda perde tempo cobrando informação básica antes de começar.

A proposta separa o briefing em **dois níveis**:
- **Briefing Básico** — preenchido **uma vez por cliente**, contém **apenas os acessos** de todos os
  serviços. Os dados pessoais (Nome/e-mail/telefone) **não** são pedidos aqui: vêm do cadastro/Hotmart
  e aparecem read-only. É **pré-requisito (gate)**: sem ele o cliente não cria projetos nem abre chamados.
- **Briefing por Projeto** — preenchido **a cada evento**. Um projeto representa o **evento inteiro**
  (não um serviço isolado): tem um **bloco geral** (tema, data, orçamento, objetivo, público, domínio,
  início do tráfego) + **seções de campanha por serviço contratado** (Tráfego, Edição, Páginas,
  Automação). Mostra só as seções dos serviços que o cliente tem. Herda os acessos do Base.

> ⚠️ **Mudança de modelo:** a migration 029 tem `projects.service_type` único (1 projeto = 1 serviço).
> Este novo modelo torna o projeto **multi-serviço**; a migration 031 reestrutura `portal.projects`
> (ver fase Design).

**Onboarding do Diamante novo:** o admin captura os dados pessoais (Hotmart), o sistema prepara o
acesso (e-mail + senha) e o **admin envia o acesso manualmente** ao aluno. Diamantes existentes já
têm login — entram direto no Briefing Básico. **O gate de acessos vale para todos** (novos e existentes).

---

## Goals

- [ ] Cliente informa acessos **uma única vez** (Briefing Base) — zero reinformação por projeto.
- [ ] Briefing Base funciona como **gate**: cria projeto/chamado/conversa só após concluí-lo.
- [ ] Briefing por Projeto leve e focado em campanha, herdando contexto do Base.
- [ ] 4 briefings de serviço completos e didáticos: **Tráfego, Edição, Páginas, Automação**.
- [ ] Chamado abre em **dois modos**: simples (avulso) ou vinculado a projeto.
- [ ] Tela inicial mostra a equipe **só para visualização** (sem botão de mensagem).

---

## Out of Scope

| Feature | Motivo |
|---|---|
| Briefings de Design Gráfico e Social Media | Foco nos 4 serviços citados; reaproveitar depois |
| Templates de briefing editáveis pelo admin via UI | Templates seguem em JS versionado |
| Assinatura digital / aprovação admin do briefing | Submit do cliente ativa direto |
| Notificação por e-mail ao submeter briefing | Fase posterior |
| Automação de "marcar reunião" para GTM/Planilha ausentes | v2: por enquanto vira flag + nota manual |
| Migração de dados de briefings antigos (projects.briefing legado) | Volume baixo; tratar caso a caso |

---

## User Stories

### P1: Briefing Básico do cliente — acessos (gate de pré-requisito) ⭐ MVP

**User Story**: Como cliente Diamante, quero informar os acessos dos meus serviços uma única vez
para não reinformá-los a cada projeto e liberar o uso do portal.

**Why P1**: É a fundação do novo modelo. Sem o Base, projetos e chamados não têm contexto.

**Acceptance Criteria**:
1. WHEN qualquer cliente (novo ou existente) acessa o portal sem Briefing Básico concluído THEN o
   sistema SHALL exibir o Base como etapa obrigatória e bloquear "Novo Projeto" e "Novo Chamado".
2. WHEN o Briefing Básico é exibido THEN os dados pessoais (Nome/e-mail/telefone) SHALL aparecer
   **read-only** (origem cadastro/Hotmart) e o cliente SHALL preencher **apenas os acessos**.
3. WHEN o cliente preenche todos os campos `priority='red'` de acesso e envia THEN o sistema SHALL
   marcar `base_status='submitted'` e desbloquear projetos, chamados e conversa com a equipe.
4. WHEN o cliente reabre o Base após enviado THEN o sistema SHALL permitir editar (acessos mudam),
   mantendo o gate liberado.
5. WHEN o cliente salva parcialmente THEN o sistema SHALL persistir rascunho sem exigir todos os campos.

**Independent Test**: Logar como cliente sem Base → ver bloqueio + dados pessoais read-only →
preencher acessos vermelhos → enviar → confirmar que "Novo Projeto" libera.

---

### P2: Briefing por Projeto (evento multi-serviço) ⭐ MVP

**User Story**: Como cliente, quero criar um projeto por evento informando os dados gerais e a
campanha de cada serviço contratado, herdando os acessos já cadastrados no Base.

**Why P1/P2**: É o uso recorrente. Depende do Base (P1) existir.

**Acceptance Criteria**:
1. WHEN o cliente cria um projeto THEN o sistema SHALL pedir o **bloco geral do evento** (tema, data,
   orçamento, objetivo, público, domínio, início do tráfego).
2. WHEN o briefing do projeto é aberto THEN o sistema SHALL exibir **seções de campanha apenas para os
   serviços contratados** do cliente (campos de escopo `project`), ocultando as demais.
3. WHEN o briefing do projeto referencia acessos THEN o sistema SHALL exibi-los em modo leitura
   herdados do Base (sem pedir de novo).
4. WHEN todos os campos `red` (bloco geral + seções dos serviços contratados) estão preenchidos THEN o
   sistema SHALL habilitar "Enviar para a equipe", setar `status='active'` e registrar audit_log.
5. WHEN o cliente cria vários projetos/eventos THEN o sistema SHALL permitir (sem unicidade).

**Independent Test**: Com Base enviado, criar um evento → confirmar bloco geral + só as seções dos
serviços contratados, com acessos herdados read-only.

---

### P3: Templates dos 4 serviços com classificação base/projeto ⭐ MVP

**User Story**: Como cliente, quero formulários completos e didáticos para Tráfego, Edição, Páginas
e Automação, com cada campo no nível certo (Base = acesso fixo, Projeto = campanha).

**Why P1**: Sem os templates corretos, P1 e P2 não têm conteúdo.

**Acceptance Criteria**:
1. WHEN um campo é de **acesso/credencial** THEN o sistema SHALL classificá-lo como `scope='base'`.
2. WHEN um campo é de **campanha/evento** THEN o sistema SHALL classificá-lo como `scope='project'`.
3. WHEN um item depende de pré-condição ("GTM: se não tiver, marcar reunião") THEN o template SHALL
   oferecer opção "não tenho" que levanta uma flag/nota, sem travar o envio.
4. WHEN o serviço é Automação THEN o template SHALL conter os acessos das ferramentas
   (Senflow/Devzap, Whatsapp, ActiveCampaign, GoHighLevel, Make/N8N, LigueLead) majoritariamente
   no escopo `base`.

**Independent Test**: Abrir cada um dos 4 templates e conferir que os campos de acesso caem no Base
e os de campanha no Projeto (ver Apêndice A).

---

### P2: Chamado em dois modos (simples + por projeto)

**User Story**: Como cliente, quero abrir um chamado rápido avulso OU um chamado vinculado a um
projeto que herde o contexto da campanha.

**Why P2**: Melhora o fluxo de demandas, mas depende do Base/Projeto existirem.

**Acceptance Criteria**:
1. WHEN o cliente abre "Novo Chamado" THEN o sistema SHALL oferecer escolher entre **chamado simples**
   (sem projeto) e **chamado de projeto** (dropdown de projetos ativos).
2. WHEN é chamado de projeto THEN o sistema SHALL vincular `demand.project_id` e exibir o contexto
   da campanha ao operador.
3. WHEN é chamado simples THEN o sistema SHALL criar a demanda sem `project_id`, como hoje.
4. WHEN o Base não está concluído THEN o sistema SHALL bloquear ambos os modos (gate).

**Independent Test**: Abrir um chamado simples e um vinculado a projeto; confirmar `project_id`
nulo vs preenchido e o contexto visível ao operador.

---

### P2: Dashboard — equipe somente leitura

**User Story**: Como cliente, quero ver minha equipe ativa na tela inicial sem ação de mensagem
(a conversa acontece dentro dos chamados).

**Why P2**: Ajuste isolado e de baixo risco; pode ir junto ou antes.

**Acceptance Criteria**:
1. WHEN a tela inicial renderiza a equipe THEN o sistema SHALL exibir nome + cargo, **sem** botão
   "Mandar mensagem".
2. WHEN não há texto de "Fale com sua equipe" THEN o CTA SHALL focar em abrir chamado/projeto.

**Independent Test**: Carregar a dashboard e confirmar ausência do botão de mensagem na lista de equipe.

---

### P3: Painel admin de Briefings & Projetos

**User Story**: Como admin/operador, quero visualizar o Briefing Base e os Projetos de cada cliente
em modo leitura, com indicador de completude.

**Acceptance Criteria**:
1. WHEN o admin abre um cliente THEN o sistema SHALL mostrar o Base (acessos) e a lista de projetos.
2. WHEN um projeto é selecionado THEN o sistema SHALL exibir o briefing de campanha formatado por seção.

---

### P2: Onboarding "Diamante novo" (acesso preparado pelo sistema, envio manual)

**User Story**: Como admin, ao cadastrar um Diamante novo, quero que o sistema prepare o acesso
(e-mail + senha) a partir dos dados pessoais, para eu enviar manualmente ao aluno.

**Acceptance Criteria**:
1. WHEN um Diamante novo é cadastrado (dados pessoais/Hotmart) THEN o sistema SHALL preparar
   credenciais de acesso (e-mail + senha) e disponibilizá-las ao admin.
2. WHEN o admin abre o cadastro THEN o sistema SHALL exibir as credenciais para envio manual
   (sem disparo automático de e-mail).
3. WHEN o aluno faz o primeiro login THEN o sistema SHALL direcioná-lo ao Briefing Básico (gate).
4. WHEN um Diamante é criado THEN o sistema SHALL registrar pendência de "reunião de configuração".

---

## Edge Cases

- WHEN o cliente tem Base enviado mas um acesso ficou pendente ("não tenho GTM") THEN o sistema SHALL
  liberar o gate mas sinalizar pendência ao operador.
- WHEN um projeto é criado e o Base é editado depois THEN o projeto SHALL refletir os acessos atualizados
  (herança por referência, não cópia).
- WHEN o cliente não contratou um serviço THEN o Base SHALL ocultar/omitir os acessos daquele serviço.
- WHEN um chamado de projeto é aberto e o projeto é cancelado THEN o `project_id` SHALL ir a NULL
  (ON DELETE SET NULL já existe).

---

## Requirement Traceability

| ID | Story | Fase | Status |
|---|---|---|---|
| BASE-01 | P1 Briefing Base | Tasks | Implementing (T1,T3,T8) |
| BASE-02 | P1 Gate de pré-requisito | Tasks | Implementing (T3,T5,T8,T12) |
| BASE-03 | P1 Edição pós-envio | Tasks | Implementing (T3,T8) |
| PROJ-01 | P2 Briefing projeto (campanha) | Tasks | Implementing (T2,T4,T9,T10,T11) |
| PROJ-02 | P2 Herança de acessos do Base | Tasks | Implementing (T9) |
| SVC-01 | P3 Classificação scope base/project | Tasks | Implementing (T6) |
| SVC-02 | P3 Campo "não tenho" + flag de reunião | Tasks | Implementing (T6,T8) |
| SVC-03..06 | P3 Templates Tráfego/Edição/Páginas/Automação | Tasks | Implementing (T6) |
| CHAM-01 | P2 Dois modos de chamado | Tasks | Implementing (T5,T13) |
| CHAM-02 | P2 Gate no chamado | Tasks | Implementing (T5,T13) |
| DASH-01 | P2 Equipe somente leitura | Tasks | Implementing (T0) |
| ONB-01 | P2 Onboarding Diamante novo (acesso preparado, envio manual) | - | Pending (não iniciado) |
| ADM-01 | P3 Painel admin briefings | - | Pending (não iniciado) |

**Coverage:** 13 requisitos · 11 implementados (aguardando aplicação da migration + teste manual) · 2 pendentes (ONB-01, ADM-01).
**Verificação:** sintaxe JS validada (`node --check` + parse dos scripts inline). Funcional pendente de aplicar a migration 031 no banco e testar no portal.

---

## Success Criteria

- [ ] Cliente preenche acessos 1x; criar 2º projeto não pede acessos de novo.
- [ ] Gate funcional: portal bloqueado sem Base, liberado após envio.
- [ ] 4 templates de serviço com split base/projeto coerente (Apêndice A).
- [ ] Chamado abre nos dois modos com `project_id` correto.
- [ ] Dashboard sem botão de mensagem na equipe.

---

## Apêndice A — Inventário de campos por serviço (classificação base/projeto)

Classificação preliminar; o tagging fino é tarefa da fase Design.

### Tráfego (`anuncios_pagos`)
**Base (acessos):** Acesso BM · Meta · Google Ads · GTM (se não tiver → flag "marcar reunião p/ criar
GTM") · Planilha de Trackeamento (se não tiver → flag "marcar reunião p/ criar planilha").
**Projeto (campanha):** pretensão de investimento · investimento total · captação de lead e
remarketing · locais de veiculação (Meta & Google) · % Meta vs Google · pesquisa desde o 1º dia ·
link da pesquisa · qtd criativos disponíveis · envio de criativos pro Drive (+ biblioteca de anúncios
no Meta) · Qtd Leads Meta · início da captação · data do seminário · data das vendas de sessão ·
medição de MQL.

### Edição (`edicao_video`)  — majoritariamente Projeto (por vídeo)
**Base (acessos):** Drive de assets/criativos (link).
**Projeto:** Identificação (nome do projeto, responsável, datas, plataforma, formato) · Especificações
técnicas (duração, FPS, codec, resolução, legenda) · Pontos de corte (tabela timecodes + instruções,
~6 linhas) · Identidade visual (checklist: intro, outro, lower thirds, logo, LUT…) · Trilha sonora e
áudio (estilo, volumes, SFX, tratamento de voz) · Legendas (idioma, posição, estilo palavra-a-palavra
ou frase, destaque) · Referências (links, estilo, transições) · Prazos (tabela 5 etapas + rodadas de
revisão) · Entrega (canal, nomenclatura, versões, thumbnail) · Observações + bloco de aprovação
cliente/editor.

### Páginas (`paginas` — separar de web_design_automacao)
**Base (acessos):** WordPress (se tiver) · Builderall (se tiver) · GreatPages (se tiver) · Hospedagem
(Hostinger ou TurboCloud) · Drive de Fotos (link atualizado) · Identidade Visual (link do Drive).
**Projeto:** Domínio esperado p/ captação, central e sessão (ou Low Ticket) · Subdomínio (se sim, qual).

### Automação (`automacao` — separar de web_design_automacao) — majoritariamente Base
**Base (acessos):** Ferramenta de gestão de grupo (Senflow/Devzap) · Whatsapp
(Unnichat/Manychat/Infobeep) · ActiveCampaign · Google/HighLevel · Integração (Make/N8N) ·
Ligação (LigueLead).
**Projeto:** (a definir conforme demanda da campanha).

### Briefing por Projeto — bloco geral do evento (sempre presente)
Nome do Projeto (tema do evento) · Data do Projeto (data do evento) · Início do Tráfego · Orçamento
Total · Objetivo do Tráfego · Objetivo do Projeto · Público-alvo · Domínio desejado.

> Além do bloco geral, o projeto inclui as **seções de campanha** (escopo `project`) de cada serviço
> **contratado** pelo cliente — ver as seções "Projeto" de Tráfego/Edição/Páginas/Automação acima.
> Serviços não contratados não aparecem.

### Briefing Básico — o que o cliente preenche
**Read-only (origem cadastro/Hotmart, não editável):** Nome · E-mail · Telefone.
**Preenchido pelo cliente:** apenas os blocos de **acesso** de cada serviço contratado (seções "Base"
de Tráfego, Edição, Páginas e Automação acima). Os campos de campanha NÃO aparecem aqui — só no Projeto.
