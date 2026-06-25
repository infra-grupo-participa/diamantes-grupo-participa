# HANDOFF — Financeiro "Mês a mês" no card do aluno

> Documento de passagem para o Claude Code (VSCode) continuar o trabalho.
> Contexto: enriquecer a aba Financeiro do admin com a visão de pagamentos
> por serviço e por mês de cada aluno Diamante.
> Data: 2026-06-25.

---

## 1. OBJETIVO

No card financeiro de cada aluno (`FinanceClientModal`), mostrar **quais meses
ele pagou, quais ficaram pendentes, e o total da pendência — por serviço**.
Fonte da verdade dos dados de cobrança: `portal.hotmart_purchases`.

---

## 2. O QUE JÁ FOI FEITO (já está na `main`, commit `908e17d`)

Mudanças **aditivas** (não alteram lógica existente). `tsc --noEmit` e
`npm run build` passaram com exit 0 antes do push.

### `lib/api/admin-assinaturas.ts`
- Novo tipo `HotmartChargeRow`.
- Nova função `listClientHotmartCharges(clientSlug)` — lê
  `portal.hotmart_purchases` do aluno (campos: transaction_code, offer_code,
  service_name, amount, status, charged_at, installment_number), ordenado por
  `charged_at`.

### `components/admin/FinanceClientModal.tsx`
- Nova aba **"Mês a mês"** (passa a ser a aba default ao abrir o card).
- State `charges` + carga via `listClientHotmartCharges` no `reload()`.
- Componente `MonthlyGrid`: monta a matriz **serviço × mês**.
  - Célula: ✓ pago (verde) · ✕ vencido (vermelho) · ↩ reembolsado · – cancelado
    · vazio = sem cobrança no mês.
  - Regra: se houver pagamento no mês, ele prevalece sobre um `overdue` anterior
    (retentativa paga).
  - Pílulas no topo: Total pago, Total em aberto, nº de serviços.
  - Coluna "Em aberto" por serviço (soma dos `overdue` daquele serviço).
- Componente auxiliar `SummaryPill` + estilos `gridTh`/`gridTd`.

**Status semântico usado** (alinhado ao webhook e à UI existente):
`approved`/`complete` = pago · `overdue` = vencido · `refunded` · `canceled` ·
`chargeback`. (A UI já tinha badge "Em atraso" para `overdue`.)

---

## 3. O QUE PRECISA SER FEITO NO BANCO  ⚠️ PENDENTE

O `portal.hotmart_purchases` em produção provavelmente só tem o histórico
**recente** (o que o webhook capturou). Não há backfill do histórico antigo.
Sem isso, a grade aparece quase vazia para meses anteriores.

### Arquivo: `backfill_hotmart_purchases.sql`
(gerado em `C:\tmp\backfill_hotmart_purchases.sql` — pedir ao Márcio o arquivo,
ou regerar a partir do CSV de vendas Hotmart com o script abaixo)

- Importa **2.629 cobranças** (histórico completo dez/2023 → jun/2026) para
  `portal.hotmart_purchases`.
- **Idempotente:** `ON CONFLICT (transaction_code) DO NOTHING`.
- **NÃO altera schema. NÃO mexe em `services.access_until`** — só popula o log.
- **2.159 de 2.629 já vêm vinculadas a aluno** (`client_slug`); o resto são
  compras órfãs reais (não-diamantes), que o sistema já trata em "Compras
  Hotmart sem aluno vinculado".
- Mapeia status PT→EN (653 "Atrasado" → `overdue`).

### Passos para aplicar (Supabase SQL Editor, projeto `npqyvjhvtfahuxfmuhie`):

1. **Rodar o BLOCO 0 (pré-flight)** do SQL primeiro. Ele retorna:
   - As colunas reais de `portal.hotmart_purchases` (confirmar que batem com o
     INSERT: transaction_code, buyer_email, offer_code, service_name, amount,
     status, payment_type, installments_total, installment_number, charged_at,
     client_slug, raw_payload).
   - Contagem atual + data mais antiga/recente.
2. **Conferir** se as colunas do INSERT batem com as reais. Se alguma coluna
   tiver nome/tipo diferente, ajustar o INSERT antes de rodar.
3. Rodar o **BLOCO 1** (`BEGIN ... INSERT ... ON CONFLICT`).
4. Conferir o SELECT de verificação (total_pos_insert, com_aluno, vencidas).
5. `COMMIT;` se estiver correto; `ROLLBACK;` se não.

### ⚠️ Risco a validar
A estrutura de `hotmart_purchases` foi **inferida pelo código** (a tabela foi
criada fora do repo, sem migration de CREATE). O BLOCO 0 existe justamente para
confirmar as colunas reais ANTES do INSERT. Não dar COMMIT sem conferir.

---

## 4. O QUE FALTA (deploy + dados)

- [ ] **Deploy manual** na Hostinger (NÃO há deploy automático por push — ver
      CLAUDE.md: "Deploy é manual no Node App"). No hPanel → Node App:
      `npm ci && npm run build` + restart da aplicação.
- [ ] **Rodar o backfill** no Supabase (seção 3) para a grade ter o histórico
      completo. Sem ele, a aba funciona mas só mostra cobranças recentes.

---

## 5. ARTEFATOS DE ANÁLISE (fora do repo, em `C:\tmp\`)

Planilhas geradas na análise do histórico (úteis como referência/conferência):
- `Relatorio_Financeiro_Diamante_v2.xlsx` — situação financeira por aluno,
  inadimplência mês a mês, cobranças vencidas.
- `Matriz_Servicos_Diamante.xlsx` — matriz contratante × serviço (contratado ×
  pago × vencido), reconciliada com a tabela-verdade do projeto.
- `backfill_hotmart_purchases.sql` — o script da seção 3.

**Números de referência (histórico completo, corte 25/06/2026):**
- Total recebido (pago): R$ 1.774.400
- Total em aberto/vencido: R$ 598.000 (25,2% de inadimplência)
- Todo o "em aberto" já está vencido — nenhuma parcela futura (100% cobrável).

---

## 6. FONTES DA VERDADE (para quem continuar)

- **Contratado por aluno + valor:** `db/migrations/021_link_services_to_hotmart_offers.sql`
  (mapeia client_slug × service_key × offer_code; 12 ofertas com valores
  legacy/2025) + `portals-data.json` (legado, para os portais fora da 021).
- **Catálogo de serviços:** TRAFEGO, WEB_DESIGNER, EDICAO_VIDEO, DESIGNER,
  AUTOMACAO, SOCIAL_MEDIA, COPYWRITER, HOSPEDAGEM.
- **Fluxo Hotmart:** `app/api/hotmart-webhook/route.ts` → RPC
  `process_hotmart_purchase` (grava em hotmart_purchases + renova
  services.access_until). Status agregado da subscription é derivado de
  `access_until` via `recalc_subscription_from_services()`.
- **Projeto Supabase:** `npqyvjhvtfahuxfmuhie`, schema `portal`.

---

## 7. MELHORIAS FUTURAS (opcional, não bloqueante)

- Tabela `portal.service_billing` (1 linha por serviço × mês) com expected vs
  received, para histórico definitivo (em vez de derivar de hotmart_purchases).
  Exigiria migration + trigger no webhook + backfill. Foi avaliado e adiado em
  favor da abordagem "ler dados existentes" (mais rápida e sem risco de schema).
