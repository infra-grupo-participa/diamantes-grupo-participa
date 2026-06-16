# Portal Diamantes — Proposta Definitiva das 11 Pendências

> Documento de arquitetura consolidado · Programa Diamantes (Grupo Participa)
> Cada pendência passou por investigação técnica **e** por um endurecimento adversarial (alguém tentou derrubar a proposta de propósito). O que sobrou aqui é o que resiste a esse teste.

---

## 1. Resumo executivo

O portal Diamantes já funciona, mas tem **11 pontos** que ficaram pela metade na migração para a nova plataforma (Next.js). Nenhum deles é um incêndio — o sistema está praticamente em pré-lançamento, com pouquíssimo tráfego real. A boa notícia: a maioria das correções **reaproveita o que já existe** (mesmos padrões de banco, mesmo provedor de e-mail, mesmos componentes de tela), em vez de inventar tecnologia nova. Isso baixa risco e custo.

**O que muda para o CLIENTE (o aluno do programa):**
- Quem compra pela Hotmart passa a **receber acesso automaticamente** (hoje alguém precisa criar a conta na mão e mandar a senha por e-mail digitada na tela).
- As **fotos que ele manda no chat** finalmente chegam à equipe (hoje somem — bug real).
- Ao clicar em "Ver detalhes" de uma demanda, ele vê **um resumo do que respondeu no briefing** (hoje precisa abrir outra tela).
- Recebe **e-mails de aviso** em mais momentos (demanda concluída, etc.), sem depender de ele ter conta em ferramenta externa.

**O que muda para a EQUIPE (admin):**
- **Números financeiros confiáveis**: a "inadimplência" hoje está inflada em ~75% (mostra R$ 35.800 quando o atraso real é R$ 20.400). Isso conserta a leitura de quem está em dia x atrasado.
- **CRUD completo** de operadores e de clientes (criar, editar, desativar, excluir com segurança), incluindo uma **visão geral** de cada operador e de cada projeto.
- Fecha um **furo de segurança crítico**: hoje, em tese, qualquer pessoa com a chave pública do site poderia se auto-cadastrar como administrador.
- O **PDF enviado ao ClickUp** fica completo e legível (hoje sai com "[object Object]" e campos sumindo).

**Princípio que guiou tudo:** preferir a correção *definitiva* (atacar a causa) à *paliativa* (mascarar o sintoma) — **exceto** quando o endurecimento provou que a versão "definitiva" era na verdade sobre-engenharia para um problema que o portal ainda não tem. Nesses casos (e-mail de alto volume, fila de notificações), a recomendação é entregar o núcleo barato agora e deixar o resto documentado para quando o volume justificar.

---

## 2. Detalhamento por domínio

### A. Identidade & Onboarding

#### A1 — Acesso unificado: Hotmart cria conta + e-mail de definição de senha `[AUTH-ONBOARDING]`

**O problema em linguagem simples.** Hoje existem três caminhos de acesso e nenhum se conversa direito:
1. O cliente pode **redefinir a senha sozinho** (funciona, mas depende do servidor de e-mail nativo do Supabase — uma pendência conhecida).
2. O admin pode **criar acesso na mão**, mas o sistema gera a senha, **mostra na tela em texto** e o admin manda manualmente. Pior: esse código roda no navegador e precisa "salvar e restaurar" a sessão do admin — uma gambiarra frágil.
3. Quando o cliente **paga na Hotmart**, o sistema **não cria conta nenhuma**. Se o e-mail da compra não bater com um cadastro já existente, a compra fica **órfã** (já houve correção manual via migration `034`).

**A solução proposta.** Um único fluxo de provisionamento no servidor (não no navegador), idempotente, reaproveitando o que já existe:
- Nova função de banco `provision_client_account(email, nome, slug?)` que cria a conta com segurança (`auth.admin.createUser`, server-side), garante o registro do cliente e é idempotente (se já existe, não recria).
- O **link de definição de senha** passa a sair pelo **mesmo provedor premium** (Resend, via a Edge Function `send-email`) que já manda todos os outros e-mails — resolvendo de quebra a pendência do SMTP nativo.
- No **webhook da Hotmart** (`app/api/hotmart-webhook/route.ts`): se a compra é de e-mail desconhecido **e** a oferta é um contrato Diamantes real, cria a conta e dispara o e-mail de boas-vindas — em **best-effort** (sem travar a resposta para a Hotmart, evitando timeout/retry).
- O caminho manual do admin passa a chamar a mesma lógica, parando de exibir senha na tela.

**Ajustes obrigatórios que o endurecimento exigiu (são o que torna isso seguro):**
- **NÃO** alterar o gatilho `handle_new_auth_user` (migration `011`) para "usuário nasce aprovado". Isso reabriria a brecha de auto-aprovação. Em vez disso, fazer o registro explícito dentro da função de provisionamento e deixar o gatilho `011` intacto como rede de segurança.
- **Filtrar por contrato real**: só criar conta quando a oferta casa em `hotmart_offers`. A migration `034` prova que existem compras de **não-Diamantes** — provisionar qualquer e-mail criaria clientes-fantasma.
- Tratar o modelo de **alias de e-mail**: se já existe um registro de alias, **atualizar** para vínculo principal, não inserir duplicata (senão o login pega a linha errada).
- Botão **"reenviar link"** no admin, porque o link expira em ~1h.

**Por que é permanente.** Fecha o buraco das compras órfãs *na origem* (cria a conta no ato da compra) em vez de depender de migrations manuais; elimina a criação no navegador com hack de sessão; e unifica os três caminhos numa única rota idempotente alinhada aos padrões já existentes.

**Performance/escala.** Custo desprezível: o provisionamento só roda no **primeiro evento** de um cliente novo (caminho frio); renovações não pagam nada. As chamadas de criação de usuário são pontuais, sem efeito N+1.

> **Solidez: 7/10** · Esforço: Grande · Risco: Médio · *Aprovado com ajustes obrigatórios.*

---

### B. CRUD & Visões Admin

#### B1 — CRUD de operadores + visão geral do operador `[OPERADORES-CRUD]`

**O problema.** A aba de operadores já tem listar/editar/inativar/excluir, mas a **exclusão é insegura**: deleta direto na tabela confiando na cascata do banco. Ao apagar um operador, os vínculos com demandas somem **silenciosamente** (e com eles o histórico de avaliações), e o aluno fica sem o integrante do setor sem aviso. A visão de performance também é pobre (só duas médias).

**A solução proposta + o que o endurecimento corrigiu.** A versão original propunha um RPC que conta vínculos antes de deletar. O endurecimento mostrou que a proteção real precisa estar **no banco**, não num "flag" da aplicação (que é burlável):
- **Tornar `INATIVAR` o caminho primário** na tela — não-destrutivo, preserva histórico e pontos, resolve ~95% dos casos.
- **Mudar a chave estrangeira** `demand_operators.operator_id` de `CASCADE` para `RESTRICT`: o **banco passa a recusar** a exclusão quando há vínculo com demanda. É mais simples e mais sólido do que recriar a contagem em código.
- Manter o RPC `delete_operator` pelo motivo **honesto**: atomicidade + trava anti-auto-exclusão + `audit_log` + tradução de erro (espelhando `delete_employee`) — **não** "segurança de auth" (o RLS já garante admin-only) nem um "pré-check espelhado" (o `delete_employee` real não faz pré-check).
- **Remover o conceito de "demandas ativas"** do gate: hoje todas as demandas têm status único `open`; não existe esse ciclo de vida. O gate é simplesmente "tem vínculo → recomende inativar".
- **Visão geral** (Parte B): aprovada, baixo risco, reaproveitando `v_operators`/`v_operator_performance`, com `LIMIT 20` e os índices que já existem.

**Por que é permanente.** A integridade fica garantida estruturalmente pelo `RESTRICT` (impossível perder histórico por engano), não por uma checagem que pode ser contornada.

**Performance/escala.** Volume minúsculo (12 operadores, 47 vínculos). Índices `idx_demand_operators_operator` e `idx_team_assignments_operator` já existem. Sem N+1.

> **Atenção de deploy:** `delete_employee` e os novos objetos vivem **só no banco remoto**. É preciso **aplicar a migration via `apply_migration`** (não basta commitar o `.sql`), pois o deploy do app é manual e desacoplado.

> **Solidez: 6/10** · Esforço: Médio · Risco: Médio · *Aprovado com ajustes (priorizar inativar + RESTRICT no banco).*

---

#### B2 — CRUD completo de admins e clientes `[ADMIN-CLIENTES-CRUD]`

**O problema — e aqui há um furo de segurança crítico.** O CRUD de admins existe e funciona, mas a criação de usuários (admin e cliente) roda **no navegador** com a chave pública (`signUp`). O gatilho de banco `handle_new_auth_user` **confia no campo `role` enviado pelo navegador**: se vier `role='admin'`, a pessoa nasce **admin aprovado**. Ou seja, **qualquer pessoa com a chave pública do site poderia se cadastrar como administrador**. Além disso, ao excluir um aluno, o login dele fica **órfão** (um acesso ativo sem aluno).

**A solução proposta.** Centralizar **toda** criação/edição de identidade em rotas de servidor com a chave de serviço, e fechar o gatilho:
- **Endurecer o gatilho** (`handle_new_auth_user`): nunca derivar privilégio do navegador. Sempre nasce `user/pending`; a promoção a admin/aprovado é feita explicitamente pelo backend com chave de serviço.
- Rotas server-side (`app/api/admin/users`) usando `auth.admin.createUser` — sem trocar a sessão do admin, sem depender do flag "confirm email".
- **Completar o CRUD de cliente**: editar/desativar/resetar senha/remover o login, com um RPC transacional `delete_client` (espelhando `delete_employee`) que remove o login órfão junto com o aluno.

**Ajuste crítico que o endurecimento exigiu — SEQUENCIAMENTO ATÔMICO.** A migration que endurece o gatilho e o refactor das rotas **têm que subir no mesmo deploy, na ordem certa**: primeiro o app (já gravando role/status corretos e parando de mandar role pelo navegador), **depois** a migration do gatilho. Como o deploy Hostinger é manual e desacoplado do Supabase, inverter a ordem **quebra a criação de admin silenciosamente**. Também: escrever a migration a partir do **código real do banco** (há drift vs. o arquivo `011` do repo) e marcar o helper de chave de serviço como `server-only`.

**Por que é permanente.** Ataca a causa-raiz (confiança em dado do navegador + criação de identidade no cliente), que é o padrão oficial Supabase para "admin cria usuário". Não é band-aid.

**Performance/escala.** Sem custo escondido — criar usuário é operação rara; a rota server-side até **remove** uma ida-e-volta extra (o `signUp`+restauração de sessão atual).

> **Solidez: 8/10** · Esforço: Grande · Risco: Alto · *Aprovado com condições obrigatórias (deploy atômico A+B).*

---

#### B3 — Card do aluno: dados + briefing básico `[ADMIN-CARD-ALUNO]`

**O problema.** Clicar no card do aluno já abre um painel — mas ele mostra coisas demais (equipe, serviços, demandas, métricas) e **não mostra o Briefing Básico** (os dados de acesso que o cliente preencheu), que é justamente o que foi pedido.

**A solução proposta + simplificação do endurecimento.** Adicionar uma seção "Briefing Básico" ao painel, lendo a fonte de verdade real (`client_briefing.access`) e reaproveitando o motor de templates já existente. O endurecimento encontrou uma versão **mais simples e mais sólida** do que a própria proposta sugeria:
- **NÃO** criar RPC nem migration. Reusar `getClientBriefingAccess(slug)` que já existe.
- **NÃO** mapear "serviço → chave de briefing" no front (`canonicalServiceName` devolve rótulos de setor, não chaves — é uma armadilha que causaria divergência silenciosa). Em vez disso, **iterar diretamente as chaves do JSON `access`**, que já são as chaves de briefing.
- Extrair `FieldRow`/`Section` do `BriefingModal` para um componente compartilhado `BriefingReadView`, **tratando objetos/arrays** para evitar o "[object Object]" (esse bug já machucou no commit `4baba6f`).

**Por que é permanente.** Lê a fonte canônica protegida por RLS, reaproveita o motor único de templates (campos novos aparecem automaticamente) e elimina duplicação.

**Performance/escala.** 1 leitura `O(1)` por abertura, em paralelo com as outras chamadas já existentes. Zero backend novo. Listagem intocada.

> **Decisão de produto pendente:** manter ou remover as seções Demandas/Métricas do painel? Recomendação: **só adicionar** a seção nova, não remover nada sem confirmação.

> **Solidez: 8/10** · Esforço: Pequeno–Médio · Risco: Baixo · *Aprovado, 1 ajuste obrigatório (tratar valores compostos).*

---

#### B4 — Painel do projeto: panorama completo `[ADMIN-PROJETO-PANORAMA]`

**O problema.** Abrir um projeto no admin só revela o briefing. Falta uma visão consolidada: briefing básico + briefing do projeto + **operadores escalados** + **chat em tempo real**.

**A solução proposta + corte do endurecimento.** Criar um painel de detalhe reaproveitando os padrões já consolidados — em especial o `DemandDetailModal`, que já faz equipe + chat realtime por demanda. Como o **chat é por demanda** (não existe chat de projeto no modelo de dados), o painel **não inventa** chat de projeto: agrega as demandas e delega o chat ao modal de demanda já testado. O endurecimento recomendou **cortar o backend novo**:
- **NÃO** criar `view` + `RPC` (`v_project_operators` / `get_project_panorama`). Para um painel **admin-only**, o admin já lê todas as tabelas via RLS. Basta um `Promise.all` de ~4 queries diretas indexadas (espelhando `getDemandFullDetails`). Isso remove a migration, elimina o risco de schema e evita ter **dois caminhos** para o mesmo dado.
- Só criar RPC `SECURITY DEFINER` **se** o painel for um dia exposto a operador/cliente (aí o RLS bloquearia e justificaria).
- Extrair `BriefingView` do `BriefingModal` (DRY legítimo).

**Por que é permanente.** Respeita o modelo real (chat por demanda), reaproveita componentes/CSS/realtime já testados, sem caminho paralelo.

**Performance/escala.** O "N+1" alegado não existe num `Promise.all` de queries indexadas. Canal de realtime único e coalescido (debounce 400ms); chat ao vivo só assina a demanda aberta; signed URLs hidratadas sob demanda.

> **Atenção:** o arquivo `063` proposto **colide** com o `063_notify_demanda_em_revisao.sql` já existente — se houver migration, deve ser `064+`.

> **Solidez: 8/10** · Esforço: Médio (cai de Grande ao remover o banco) · Risco: Médio · *Aprovado, cortar o backend novo.*

---

### C. Financeiro & Métricas

#### C1 — Métricas confiáveis de venda e inadimplência `[FINANCEIRO-METRICAS]` *(bug)*

**O problema em números.** A inadimplência exibida hoje está **superestimada em ~75%**. A tabela `subscriptions` é agregada **por cliente** com um único valor e um único status "pior caso". O cliente marcado `partial` tem o valor **inteiro** jogado no balde "atrasado". No nível real (por serviço): dos R$ 35.800 dos clientes `partial`, só **R$ 20.400 estão de fato atrasados** — R$ 15.400 são saudáveis. Além disso, os KPIs "A receber" e "Pendentes" são **metricas fantasma**: o recálculo (migration `026`) **nunca** gera o status `pending`, então esses cartões mostram R$ 0 estruturalmente.

**A solução proposta.** Mover a agregação financeira para o banco, calculada na granularidade de **serviço** (a fonte da verdade), e consumir um único objeto no front. A inadimplência passa a somar o atraso onde ele realmente existe, usando o **mesmo critério** que o recálculo `026` já aplica. Remover os KPIs fantasma.

**Ajuste BLOQUEANTE do endurecimento (segurança).** A proposta original usava `SECURITY DEFINER` + acesso liberado a qualquer autenticado — isso **vazaria o financeiro da base inteira para qualquer aluno/operador logado**, furando o isolamento multi-tenant. **Tem que ser `SECURITY INVOKER`** (o admin já enxerga tudo via RLS) **ou** ter guarda `IF NOT is_admin() THEN RAISE`. Além disso: reaproveitar `v_service_renewals` (que já faz o mesmo JOIN) em vez de criar uma view paralela quase idêntica; **não** criar índice supérfluo (são 56 linhas; `offer_code` já é PK); e **rotular o gráfico de evolução do MRR como estimativa** (não há histórico real — o recálculo sobrescreve o valor no lugar).

**Por que é permanente.** Ataca a causa (granularidade) e não o sintoma. A lógica vive no banco — qualquer consumidor futuro vê os mesmos números.

**Performance/escala.** De ~9 idas ao Supabase para **1**. O ganho é real, mas secundário na escala atual (19 clientes); a justificativa principal é **corretude**, não velocidade.

> **Decisão de produto pendente:** "inadimplência" = valor realmente atrasado por serviço (R$ 20.400) ou MRR de qualquer cliente com algum atraso (R$ 35.800)? A correção assume o primeiro (mais útil para cobrança) — **confirmar com o gestor antes de codar**.

> **Solidez: 7/10** · Esforço: Pequeno–Médio · Risco: Médio · *Diagnóstico aprovado; trocar DEFINER por INVOKER é bloqueante.*

---

### D. E-mail & Notificações

> **Decisão de arquitetura (tomada pelo dono do produto).** Para orquestração assíncrona (e-mail e notificações) a direção é **Supabase nativo rodando na Hostinger** — fila no Postgres + `pg_cron`/worker + provedor de e-mail (Resend agora; SES/Brevo só se o volume justificar). O **Vercel Workflow DevKit** (`"use workflow"`/`"use step"`, durável com retry/pause/resume) foi avaliado como encaixe conceitual forte, mas **descartado**: exige runtime Vercel / self-host de backend de fila e o deploy atual é Hostinger Node App. Princípio "boring technology": reusar o stack que já existe. As soluções D1/D2 abaixo seguem essa direção.

#### D1 — Infraestrutura de e-mail de "alto volume" `[EMAIL-INFRA]`

**O problema.** O envio de e-mail é transacional, mas **síncrono e sem fila**: gatilho → chamada HTTP → Resend. Se o Resend falhar (timeout de 5s ou limite atingido), o e-mail é marcado como `failed` e **perdido para sempre** — não há retry. A proposta original queria também: trocar para Amazon SES, criar abstração multi-provedor, lista de supressão, DMARC, subdomínio dedicado, warm-up de IP.

**O veredito do endurecimento — entregar SÓ o núcleo.** O diagnóstico do código está 100% correto, mas a proposta **confunde dois problemas de tamanhos diferentes**:
- **(A) Bug real e presente:** falha de envio = e-mail perdido sem retry. **Resolver agora.**
- **(B) Problema de escala "próximo do infinito":** este é um portal **transacional B2B** (e-mails disparados por eventos humanos, 1 destinatário cada). O teto do Resend (50k/mês no plano pago) **provavelmente nunca é atingido**. SES/SigV4, supressão, DMARC, warm-up são dimensionados para campanha/bulk que o portal não tem.

**A solução recomendada (Fase 1 apenas):** uma camada mínima de **outbox + worker + backoff**, mantendo o Resend atual. Resolve o único risco concreto com baixo risco e dentro dos padrões do projeto (1 migration + ~40 linhas na EF em modo "drain" + 1 job `pg_cron` reaproveitando o bloco do `037`).

**Dois alertas obrigatórios na Fase 1:**
1. `pg_cron` tem granularidade mínima de **1 minuto** → toda notificação ganharia até ~60s de atraso (regressão de UX num portal que parece em tempo real). **Solução híbrida:** o gatilho continua disparando o envio **imediato** no caminho feliz; a outbox serve apenas como **dead-letter de retry** em caso de falha.
2. **NÃO fundir** `email_log` na outbox — manter as duas tabelas (fundir tocaria RLS e a view de auditoria do admin sem ganho).

**Adiar para Fase 2 (com gatilho de volume objetivo):** SES, multi-provedor, webhook de bounce, supressão, DMARC, subdomínio, e qualquer toque no reset de senha (que é ortogonal — nem passa por essa EF).

**Por que essa decisão é a sólida.** Resolve o defeito real sem pagar o custo operacional (saída do sandbox SES, conta AWS, mudanças de DNS, UI de dead-letter) de uma escala que não existe.

> **Solidez: 6/10** *(núcleo é tecnicamente sólido; nota penalizada por sobre-engenharia significativa na proposta original)* · Esforço: Pequeno (Fase 1) · Risco: Médio · *Aprovado parcialmente.*

---

#### D2 — Notificações por evento `[NOTIFICACOES-EVENTOS]` *(depende de D1)*

**O problema.** Já existem notificações para criação de demanda, criação de projeto e mudança para "em revisão". Mas: (1) falhas somem em silêncio (mesmo problema de D1); (2) faltam transições importantes (demanda concluída, cancelada, "pedir ajustes" avisa o operador); (3) **resposta no chat** só notifica via ClickUp — e o **cliente não tem conta no ClickUp**, então não é avisado.

**O veredito do endurecimento — diagnóstico certo, escopo reduzido.** A premissa de "e-mails perdidos para sempre" **nunca ocorreu** (histórico: 11 enviados, **zero falhas** — sistema em pré-lançamento). O outbox + worker dedicado é **prematuro** e adiciona polling 1440x/dia para drenar uma fila quase sempre vazia, além de risco de **e-mail duplicado** no feedback EF→outbox.

**A solução recomendada (Fase 1, esforço S/M):**
1. Adicionar colunas `attempts`/`max_attempts`/`next_attempt_at` ao **`email_log` existente** (não criar tabela nova) + permitir re-enfileirar `failed`, com um job `pg_cron` de retry a cada 5 min. Fecha o buraco com 1 migration e zero reescrita da EF.
2. Gatilho genérico de mudança de status (mapa transição → tipo de evento), aposentando o caso pontual "em revisão". **Destinatário operador**: `demand_operators` + `operators.email` — confirmado que **os 12 operadores têm e-mail** (a "dúvida aberta" #5 já está respondida pelos dados).
3. Notificação de **chat para o cliente** (autor ≠ cliente), com anti-spam **atômico**: chave de dedup derivada de janela arredondada (ex.: `chat:<demanda>:<floor(epoch/600)>`), garantindo 1 e-mail / 10min via índice único — sem corrida entre inserts rápidos.

**Adiar para Fase 2:** a tabela `notification_outbox` dedicada e o worker drain. **Não fazer aqui:** migrar reset de senha para Resend (acopla a D1).

**Por que é permanente.** Fecha os três defeitos reais reaproveitando `email_log` + dedup + `pg_cron`, sem criar superfície que o volume não justifica. Antes de codar: **confirmar o estado real dos gatilhos no banco** (o `046` versionado está defasado — ainda contém código já removido).

> **Solidez: 7/10** · Esforço: Pequeno–Médio · Risco: Médio · *Aprovado com escopo reduzido.*

---

### E. Integração ClickUp

#### E1 — Fotos do chat chegam ao ClickUp `[CLICKUP-CHAT-IMAGENS]` *(bug — QUICK WIN)*

**O problema.** Foto enviada no chat **não chega ao ClickUp** — chega vazio. A sincronização foi feita só para texto: a coluna `attachments` **nunca é lida**, nem no gatilho nem na Edge Function. Quando a mensagem é **só imagem** (sem texto), o ClickUp recebe um comentário vazio e **nenhuma imagem**. (Verificado: a função em produção é idêntica à versionada — o bug está no ar.)

**A solução proposta.** Espelhar anexos como **anexos binários de verdade** no ClickUp (não link, que expiraria em 1h e o bucket é privado):
- Edge `clickup-comment-sync` passa a ler `attachments`, **baixar o binário** via chave de serviço (`storage.download`, ignora RLS e não depende de URL assinada) e enviar via `POST /task/{id}/attachment` (multipart).
- Idempotência por arquivo para não duplicar em reprocessamento.

**Correções obrigatórias do endurecimento (o que separa o fix sólido do band-aid):**
- **O retry "via pg_net" é FALSO.** O gatilho usa `PERFORM net.http_post` (fire-and-forget); o pg_net **nunca re-dispara** em erro. Retornar 502 = anexo perdido. **O retry tem que ser DENTRO da Edge** (try/catch por arquivo, 2-3 tentativas) + marca **por arquivo** + um **cron de varredura** como rede de segurança.
- **Remover** a mudança de timeout 5000→15000ms no gatilho (justificativa incorreta: esse timeout só controla a espera da resposta, não a execução da Edge).
- Se incluir o caminho reverso (anexo do ClickUp → chat), adicionar dedupe por `clickup_attachment_id` para não reimportar o anexo recém-enviado.
- Postar um comentário de crédito do autor também em mensagens só-imagem (garante o `clickup_comment_id` para a dedupe).
- **Lembrar de fazer deploy da Edge** — senão o fix fica só no repo.

**Por que é permanente.** Upload binário direto remove as duas causas estruturais (expiração de link + bucket privado): o ClickUp passa a hospedar a cópia no próprio CDN.

**Performance/escala.** Anexos ≤10MB, raros, N pequeno. (Nota fatual: `storage.download()` carrega o Blob inteiro em memória — não é "streaming"; pico ~30MB com concorrência 3, aceitável.)

> **Solidez: 6/10** · Esforço: Médio · Risco: Médio · *Núcleo aprovado; o modelo de confiabilidade (retry na Edge + cron) é obrigatório.*

---

#### E2 — PDF do ClickUp enriquecido `[CLICKUP-PDF]`

**O problema.** O PDF anexado ao ClickUp é "achatado": campos do tipo cartão saem como **"[object Object]"**, datas saem cruas, campos não respondidos somem (perde-se o contexto), e nenhum metadado do template (prioridade, dica, alerta) aparece. Pior: o campo `briefing_summary` — que o backend **já sabe consumir** como descrição/comentário da tarefa — **nunca é enviado** pelo front. Resultado: a tarefa fica sem corpo textual pesquisável; tudo só existe dentro do PDF.

**A solução proposta + simplificação do endurecimento.** Centralizar a formatação num módulo puro e reusar o canal `briefing_summary` que o backend já consome (zero mudança de servidor). O endurecimento recomendou **não** criar um `buildBriefingDoc` autônomo (ele duplicaria a lógica de leitura de valor `getValue`) — extrair **só as funções puras** (`formatFieldValue`, `buildBriefingSummary`) e manter a travessia onde já está.

**Gate de segurança BLOQUEANTE (LGPD).** Hoje o cartão vaza como "[object Object]" (ilegível). Colocar bandeira/últimos 4/validade no `briefing_summary` criaria **texto pesquisável e indexável** na descrição da tarefa, visível a todo membro do workspace ClickUp — uma exposição de dado sensível que **não existia em forma legível**. **Redigir/omitir campos de cartão no summary** (no máximo bandeira + últimos 4, sem validade). Outros ajustes: o backend envia o summary como **texto cru** (não markdown — abandonar `#` e `*`); limitar "(não informado)" aos campos obrigatórios para não poluir; truncar pelo limite do ClickUp.

**Por que é permanente.** Um módulo único de formatação vira fonte da verdade para PDF **e** para o corpo da tarefa — qualquer campo novo aparece automaticamente nos dois.

**Performance/escala.** Tudo client-side, `O(campos)`. `jspdf` continua sendo import dinâmico (só carrega no envio).

> **Solidez: 7/10** · Esforço: Médio · Risco: Baixo · *Aprovado; redação de cartão é bloqueante.*

---

### F. Detalhe de Demanda (cliente)

#### F1 — "Ver detalhes" mostra o briefing respondido `[DEMANDA-VER-DETALHES]`

**O problema.** O "Ver detalhes" abre um painel com status, prazo, etapas, pessoas envolvidas — mas **nada** das respostas que o cliente deu no Briefing Básico (acessos) ou no briefing do projeto. Para reler o que respondeu, ele precisa sair para a tela de Projetos.

**A solução proposta.** Adicionar uma seção "Briefing desta demanda" ao painel, exibida quando a demanda tem projeto vinculado, reaproveitando o mesmo motor de templates do admin. O endurecimento **confirmou a abordagem como a correta** (não há caminho mais sólido) e validou as decisões anti-N+1:
- O Briefing Básico (`access`) é do cliente logado → **1 chamada cacheada por sessão** serve todas as demandas.
- Os projetos vêm em **lote** via `listMyProjects()` (1 query) indexados por id — não `getProject` por demanda.
- **Não** inflar a view `v_demands` com JSON de briefing por linha (degradaria a lista inteira).

**Ajustes obrigatórios:**
- **Tipagem**: normalizar `briefing` para o formato `{general, services}` (o tipo atual não garante o shape; projetos legados podem divergir).
- **Labels**: usar a constante canônica `BRIEFING_SERVICE_LABELS` e, de quebra, remover a duplicata em `ProjetosClient.tsx`.
- **Refactor com paridade visual**: ao extrair `BriefingPanorama` do `BriefingModal` (em produção no admin), levar junto os tokens de CSS para não quebrar o estilo do admin.
- **Demanda sem projeto**: ocultar a seção inteira (mostrar todos os acessos sem serviço vinculado polui).

**Por que é permanente.** Lê as fontes canônicas protegidas por RLS, reaproveita o motor único, **não tira snapshot** (mostra sempre o estado atual).

**Performance/escala.** No máximo **2 fetches por sessão**, ambos cacheados. Carga lazy ao abrir. Sem realtime extra.

> **Solidez: 8/10** · Esforço: Médio–Alto (por causa do refactor com paridade visual) · Risco: Baixo · *Aprovado com 3 ajustes.*

---

## 3. Tabela de priorização

| # | Item | Domínio | Impacto | Esforço | Risco | Solidez | Tipo |
|---|------|---------|---------|---------|-------|---------|------|
| E1 | Fotos do chat no ClickUp | E | **Alto** (bug visível) | Médio | Médio | 6 | Bug |
| C1 | Métricas financeiras confiáveis | C | **Alto** (decisão de negócio) | P–M | Médio | 7 | Bug |
| B2 | CRUD admins/clientes + furo de segurança | B | **Alto** (segurança) | Grande | **Alto** | 8 | Feature/Hardening |
| E2 | PDF do ClickUp enriquecido | E | Médio | Médio | Baixo | 7 | Feature |
| F1 | "Ver detalhes" com briefing | F | Médio | M–Alto | Baixo | 8 | Feature |
| B3 | Card do aluno + briefing básico | B | Médio | P–M | Baixo | 8 | Feature |
| D1 | Outbox/retry de e-mail (Fase 1) | D | Médio | Pequeno | Médio | 6 | Hardening |
| D2 | Notificações por evento (Fase 1) | D | Médio | P–M | Médio | 7 | Feature |
| B1 | CRUD operadores + visão geral | B | Médio | Médio | Médio | 6 | Feature/Hardening |
| A1 | Onboarding Hotmart unificado | A | **Alto** (operacional) | Grande | Médio | 7 | Feature |
| B4 | Painel panorama do projeto | B | Médio | Médio | Médio | 8 | Feature |

### Dependências entre itens

```
D1 (infra e-mail / outbox+retry)  ──►  D2 (notificações por evento)
                                  ──►  A1 (e-mail de onboarding reaproveita a EF send-email)

C1, E1  ── independentes (bugs isolados, sem dependência)
B2      ── independente, mas exige DEPLOY ATÔMICO (app antes, migration do gatilho depois)
B3, F1, B4 ── compartilham a extração de um componente de leitura de briefing
              (BriefingReadView / BriefingPanorama / BriefingView) → fazer 1 vez, reusar nos 3
```

### Ordem de execução recomendada

1. **E1 + C1** (quick wins de bug): impacto alto, independentes, destravam confiança imediata — fotos voltam a chegar e os números financeiros param de mentir.
2. **B2** (segurança): fechar o furo de auto-promoção a admin é prioridade de segurança, mesmo com risco alto de execução — exige o deploy atômico bem coordenado.
3. **Componente compartilhado de briefing** → entregar **B3, F1 e B4** em sequência (reaproveitam a mesma extração).
4. **E2** (PDF): independente, baixo risco, alto valor de legibilidade no ClickUp.
5. **D1 → D2**: infra de e-mail primeiro (Fase 1 enxuta), depois as notificações por evento.
6. **A1** (onboarding): depende de D1 (e-mail) e da renovação Hotmart; o maior, deixar por último.
7. **B1** (operadores): pode entrar a qualquer momento; priorizar a parte barata (inativar como padrão + `RESTRICT`).

---

## 4. Quick wins (resolver já)

São correções de **bug** com causa clara, baixo custo relativo e impacto visível:

- **🐛 E1 — Fotos do chat no ClickUp.** Bug confirmado em produção: imagens somem. O cliente manda foto, a equipe recebe vazio. Correção de escopo contido (1 Edge + 1 migration de controle), com upload binário definitivo. *Cuidado obrigatório: retry dentro da Edge + cron de varredura (o pg_net não reprocessa) e fazer o deploy da Edge.*
- **🐛 C1 — Inadimplência inflada em ~75%.** Não é cosmético: o gestor está olhando R$ 35.800 de "atraso" quando o real é R$ 20.400, e dois KPIs mostram R$ 0 fantasma. Conserta a leitura de quem está em dia x atrasado. *Cuidado obrigatório: usar `SECURITY INVOKER` (não vazar financeiro para alunos/operadores).*
- **⚡ B3 — Briefing básico no card do aluno.** Sem backend novo, sem migration — só ler o que já existe e renderizar. Esforço P–M, risco baixo.

---

## 5. Riscos e perguntas em aberto para o dono do produto

Decisões de **negócio/produto** que precisam de resposta **antes** de codar (definem corretude, não detalhe):

| Item | Pergunta que precisa de decisão |
|------|--------------------------------|
| **A1** | Toda compra Hotmart de e-mail desconhecido vira conta, ou **só ofertas que são contrato Diamantes** (`hotmart_offers`)? A migration `034` prova que há compras de não-Diamantes — provisionar tudo criaria clientes-fantasma. **Recomendação: filtrar por oferta Diamantes.** |
| **A1** | O reset de senha self-service ainda depende do SMTP nativo do Auth (pendência conhecida) — migrar para Resend nesta mesma entrega? |
| **C1** | "Inadimplência" = valor realmente atrasado por serviço (**R$ 20.400**) ou MRR de qualquer cliente com algum atraso (**R$ 35.800**)? **Recomendação: o primeiro** (útil para cobrança). |
| **C1** | Remover de vez os KPIs fantasma "A receber"/"Pendentes", ou há roadmap de status `pending` (cobrança emitida não paga)? |
| **B1** | Excluir operador com vínculos: bloquear forçando inativação (recomendado) ou permitir exclusão forçada com confirmação? |
| **B2** | Ao remover admin/cliente, o que fazer com dados vinculados (avaliações, `audit_log`, `client_profiles`)? Definir CASCADE vs SET NULL por chave estrangeira. |
| **B3** | Manter ou remover as seções Demandas/Métricas do card do aluno? **Recomendação: só adicionar, não remover sem confirmação.** |
| **B4** | Chat no painel do projeto: editável (postar mensagem) ou somente leitura? E projetos legados sem demandas vinculadas — fallback ou aceitar painel "vazio"? |
| **D2** | Quais transições de status devem notificar e quem (cliente vs operador)? Ex.: concluída (recibo ao cliente), cancelada, "pedir ajustes" (avisa operador). |
| **E2** | Por LGPD, o cartão no PDF/summary deve mostrar só bandeira + últimos 4 (sem validade)? **Bloqueante de segurança.** |

### Riscos transversais de execução (técnicos, mas que o dono precisa saber)

- **Deploy desacoplado (sem CI).** O app sobe manualmente no Hostinger e as migrations no Supabase são aplicadas à parte. Itens com banco + app (especialmente **B2**) exigem **ordem de deploy coordenada** — inverter quebra o sistema silenciosamente.
- **Drift entre repo e banco.** Vários objetos (gatilhos, RPCs) vivem **só no banco remoto** e divergem dos arquivos `.sql` versionados. Toda migration nova deve ser escrita a partir do **estado real do banco**, e registrada no `PARITY.md`.
- **Sobre-engenharia evitada.** Para **D1/D2**, a recomendação consciente é **não** construir a infra de "alto volume" (SES, supressão, DMARC, worker drain) agora — o portal é transacional B2B em pré-lançamento. Entregar o núcleo barato (retry) e reavaliar a Fase 2 só com um **gatilho de volume objetivo**.

---

*Fim do documento. Cada item está pronto para virar tarefa; os "ajustes obrigatórios" e "bloqueantes" listados não são opcionais — foram o que separou, no endurecimento, a correção definitiva de um band-aid.*
