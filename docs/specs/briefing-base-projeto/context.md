# Briefing em 2 Níveis — Context (decisões do cliente)

**Gathered:** 2026-06-09
**Spec:** `docs/specs/briefing-base-projeto/spec.md`
**Status:** Ready for design (após aprovação)

---

## Feature Boundary

Refatorar o sistema de briefing/chamados para dois níveis — **Briefing Base** (1x por cliente, gate)
e **Briefing por Projeto** (por evento) — com 4 templates de serviço (Tráfego, Edição, Páginas,
Automação) e chamados em dois modos (simples e por projeto). NÃO inclui novos serviços além desses 4,
nem edição de templates por UI, nem aprovação admin do briefing.

---

## Implementation Decisions

### Modelo de dados
- **Briefing Base = nova entidade por cliente** (tabela própria, ex. `portal.client_briefing`, chave
  por `client_slug`). Guarda dados pessoais (Hotmart) + acessos de todos os serviços contratados.
- Projetos (`portal.projects`) guardam **apenas dados de campanha**; acessos são **herdados por
  referência** do Base (não copiados).

### Conteúdo do Briefing Básico
- O cliente preenche **apenas os acessos** dos serviços. Os dados pessoais (Nome/e-mail/telefone)
  são **read-only**, vindos do cadastro/Hotmart — não são pedidos no briefing.

### Base como pré-requisito (gate)
- O Briefing Básico é **obrigatório antes de tudo**: criar projeto, abrir chamado e conversar com a
  equipe ficam bloqueados até `base_status='submitted'`.
- O gate vale para **todos os Diamantes** — novos e existentes (existentes preenchem na próxima vez
  que forem criar projeto/chamado).
- Conclusão exige só os campos `priority='red'`; demais podem ficar pendentes.
- Após envio, o Base permanece **editável** (acessos mudam) sem perder o gate liberado.

### Onboarding do Diamante novo
- Admin captura dados pessoais (Hotmart) → o sistema **prepara o acesso (e-mail + senha)** → o
  **admin envia manualmente** ao aluno (sem disparo automático de e-mail).
- Primeiro login do aluno → direcionado ao Briefing Básico (gate).

### Briefing por Projeto = "avançado"
- "Briefing base e briefing avançado" = Base é o pré-requisito; os briefings **por projeto** são os
  "avançados", preenchidos a cada novo evento para a equipe trabalhar.

### Escopo do Projeto = EVENTO (multi-serviço)
- Um projeto representa o **evento inteiro**, não um serviço isolado (muda o modelo da migration 029,
  que tinha `service_type` único por projeto).
- Estrutura: **bloco geral do evento** (tema, data, orçamento, objetivo, público, domínio, início do
  tráfego) + **seções de campanha por serviço contratado**.
- O briefing do projeto mostra **apenas as seções dos serviços que o cliente contratou** (origem:
  `portal.services`). Serviços não contratados não aparecem.
- **Meta:** Base (acessos) + Projeto (campanha) = 100% do que o operador precisa para executar, sem
  comunicação repetida.

### Chamados
- **Dois modos coexistindo**: chamado simples (avulso, sem projeto) e chamado vinculado a projeto
  (herda contexto). Ambos passam pelo gate do Base.

### Serviços
- **4 serviços detalhados**: Tráfego (`anuncios_pagos`), Edição (`edicao_video`), Páginas e Automação.
- **Páginas e Automação separados** (hoje estão juntos em `web_design_automacao`).
- **Design Gráfico e Social Media aposentados/ocultos por ora** (reaproveitar no futuro).

### Classificação de campos
- Cada campo do template ganha `scope: 'base' | 'project'` (acesso fixo vs campanha).
- Itens com pré-condição (GTM/Planilha ausentes) oferecem opção "não tenho" → flag/nota de "marcar
  reunião", sem travar o envio.

### Agent's Discretion
- Nome técnico exato da nova tabela e estrutura interna do JSONB (Design).
- Mecanismo de herança de acessos na UI do projeto (Design).
- Layout dos formulários (manter wizard atual com tabs/seções).

---

## Specific References

- Reaproveitar a estrutura de template existente (`portal/assets/briefing-templates.js`) e o wizard
  (`portal/briefing.html`) — apenas estendendo com `scope` e dividindo os serviços.
- Onboarding Diamante novo: reunião de configuração + recuperação de acessos + convite por e-mail
  (ou e-mail + senha) — registrado como P3.

---

## Deferred Ideas

- Automatizar agendamento de reunião quando GTM/Planilha/ferramenta ausente.
- Briefings de Design Gráfico e Social Media.
- Notificação por e-mail no submit do briefing.
- Migração automática dos briefings legados de `projects.briefing`.
