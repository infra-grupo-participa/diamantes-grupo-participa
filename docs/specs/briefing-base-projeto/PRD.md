# PRD — Briefings e Chamados Diamante (linguagem humana)

**Para:** Márcio • **Objetivo:** validar o fluxo antes de construir
**Data:** 09/06/2026 • **Status:** aguardando sua validação

---

## 1. O problema, em uma frase

Hoje a equipe perde tempo cobrando informação básica antes de começar qualquer entrega.
A gente quer **reunir tudo que o operador precisa logo de cara** — acessos e contexto da campanha —
para ele trabalhar sem ficar indo e voltando com o cliente.

---

## 2. A ideia em 3 camadas

Pensa em três "andares" de informação, do mais fixo ao mais variável:

1. **Dados pessoais** — Nome, e-mail, telefone. Vêm da Hotmart. Já temos dos Diamantes atuais.
   *O cliente não digita isso de novo.*
2. **Briefing Básico (os acessos)** — preenchido **uma vez**. São as contas e ferramentas:
   BM/Meta/Google, WordPress, Senflow, etc. *Muda raramente, então pergunta-se só uma vez.*
3. **Briefing do Projeto (a campanha)** — preenchido **a cada evento novo**. É o "como vai ser
   essa campanha": tema, datas, orçamento, criativos, público. *Muda toda vez.*

> A regra de ouro: **Acessos (Básico) + Campanha (Projeto) = tudo que a equipe precisa.**

---

## 3. Como o cliente entra no sistema

### Diamante novo
1. O admin recebe os dados pessoais do aluno (via Hotmart).
2. O sistema **prepara o acesso** (e-mail + senha).
3. O **admin envia o acesso manualmente** ao aluno (não é e-mail automático).
4. (Recomendado) Reunião de configuração para recuperar os acessos junto com o aluno.

### Diamante que já existe
- Já tem login. Entra direto.

> Em ambos os casos, ao entrar, a primeira coisa é o **Briefing Básico**.

---

## 4. Briefing Básico — "destrava" o portal

É um **pré-requisito**. Enquanto o cliente não terminar, ele **não consegue** criar projeto,
abrir chamado nem conversar com a equipe. Aparece um aviso claro pedindo para completar.

- Os dados pessoais aparecem **só para conferir** (não dá para editar).
- O cliente preenche **apenas os acessos** dos serviços que ele tem.
- Cada campo tem uma cor de prioridade: 🔴 obrigatório · 🟡 importante · 🟢 opcional.
- Só os 🔴 travam o envio. O resto pode ficar para depois.
- Se faltar algo (ex: "não tenho GTM"), ele marca "não tenho" → vira uma **pendência sinalizada
  para o operador** (provavelmente vira pauta de reunião), mas **não trava** o envio.
- Depois de enviado, **continua editável** (acesso muda com o tempo) — e o portal segue destravado.

**O que o Básico pergunta (por serviço):**

| Serviço | Acessos coletados uma vez |
|---|---|
| **Tráfego** | BM, Meta, Google Ads, GTM (se não tiver → marcar reunião p/ criar), Planilha de Trackeamento (idem) |
| **Páginas** | WordPress / Builderall / GreatPages (o que tiver), Hospedagem (Hostinger/TurboCloud), Drive de Fotos, Identidade Visual (Drive) |
| **Automação** | Senflow/Devzap, Whatsapp (Unnichat/Manychat/Infobeep), ActiveCampaign, Go/HighLevel, Make/N8N, LigueLead |
| **Edição** | Drive de assets/criativos |

---

## 5. Briefing do Projeto — um por evento

Quando o cliente vai começar um **novo evento** (ex: "Seminário Tributário Jun/26"), ele cria um
**Projeto**. Um projeto = **o evento inteiro**, não um serviço solto.

O projeto tem duas partes:

**A) Bloco geral do evento** (sempre aparece):
- Nome do Projeto (tema do evento)
- Data do evento
- Início do tráfego
- Orçamento total
- Objetivo do tráfego e objetivo do projeto
- Público-alvo
- Domínio desejado

**B) Seções de campanha por serviço** — *só aparecem os serviços que o cliente contratou*:

| Serviço | O que o cliente informa para a campanha |
|---|---|
| **Tráfego** | Pretensão e investimento total, captação/remarketing, locais de veiculação (Meta/Google), % Meta vs Google, pesquisa desde o 1º dia (+ link), qtd de criativos, envio dos criativos pro Drive, qtd de leads Meta, início da captação, data do seminário, data das vendas de sessão, medição de MQL |
| **Edição** | Identificação (nome, responsável, datas, plataforma, formato), specs técnicas (duração, FPS, codec, resolução, legenda), pontos de corte (timecodes), identidade visual (intro/outro/logo/LUT…), trilha e áudio, legendas (estilo), referências, prazos (etapas + revisões), entrega (canal, nomenclatura, versões, thumb), observações + aprovação |
| **Páginas** | Domínio do evento (captação/central/sessão ou low ticket), subdomínio (se houver) |
| **Automação** | Configuração da campanha (conforme a demanda do evento) |

> Os **acessos não são repetidos aqui** — aparecem herdados do Básico, só para o operador consultar.

---

## 6. Abertura de chamado — dois jeitos

Depois do Básico pronto, o cliente abre chamados de dois jeitos:

1. **Chamado simples** — um pedido avulso, rápido, sem vínculo com evento.
2. **Chamado de projeto** — vinculado a um evento. O operador abre e já vê todo o briefing daquela
   campanha junto.

Os dois convivem. (E os dois só ficam disponíveis depois do Briefing Básico concluído.)

---

## 7. Tela inicial — equipe só para ver

Hoje a tela inicial tem um botão de "mandar mensagem" para cada membro da equipe.
**Isso sai.** A tela inicial passa a mostrar a equipe ativa **só para visualização** — a conversa
acontece dentro dos chamados.

---

## 8. Conferência com o que você pediu

| Você pediu | Como está coberto |
|---|---|
| Remover conversar com a equipe na tela inicial (só ver equipe) | ✅ Seção 7 |
| Briefing base e briefing avançado | ✅ Base = acessos (pré-requisito) / Avançado = por projeto |
| Briefing Tráfego (acessos + dados de campanha) | ✅ Acessos no Básico, campanha no Projeto (seção 4 e 5) |
| Briefing Edição (identificação, specs, cortes, etc.) | ✅ Seção de campanha "Edição" no Projeto |
| Briefing Páginas (WP/Builderall/hospedagem/domínio) | ✅ Acessos no Básico + domínio no Projeto |
| Briefing Automação (Senflow/Whatsapp/Make…) | ✅ Acessos no Básico |
| Briefing Básico feito uma vez (Hotmart + acessos) | ✅ Dados pessoais via Hotmart (read-only) + acessos 1x |
| Briefing por Projeto a cada evento novo | ✅ Seção 5 |
| Abertura de chamado por projeto (simples + por projeto) | ✅ Seção 6 |
| Diamante novo = reunião de config + acessos + convite | ✅ Seção 3 (admin envia acesso manualmente) |

---

## 9. O que ficou de fora desta primeira versão

- Briefings de **Design Gráfico** e **Social Media** (entram depois).
- Templates editáveis pelo admin pela tela.
- Disparo automático de e-mail (o admin envia o acesso manualmente).
- Agendar reunião automaticamente quando falta GTM/Planilha/ferramenta.

---

## 10. Validação

Se este fluxo está de acordo com o que você imaginou, o próximo passo é o **desenho técnico**
(como ficam as tabelas, a tela e a migração). Se tiver algo que não bate com sua cabeça,
me aponta o ponto e eu ajusto antes de construir.
