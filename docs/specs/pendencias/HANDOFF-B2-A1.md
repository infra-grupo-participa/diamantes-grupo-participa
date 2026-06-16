# Handoff — B2 (CRUD admin + gatilho) e A1 (Onboarding Hotmart)

> Estes dois itens tocam **autenticação** e **o webhook de pagamento ao vivo**, e dependem
> de uma **ordem de deploy** que não pode ser auto-aplicada (o deploy do app é manual na
> Hostinger, mas as migrations vão ao banco na hora). Por isso foram **preparados** e
> **documentados** aqui, e **não** aplicados ao vivo — auto-aplicar quebraria login/pagamento
> numa janela sem teste. Confirmado em produção: 30 usuários ativos, auth funcionando.

---

## B2 — Endurecer `handle_new_auth_user` + criação server-side

### O furo (crítico)
O gatilho `portal.handle_new_auth_user()` confia no `role` enviado pelo **navegador**
(`raw_user_meta_data->>'role'`): um `signUp` público com `role:'admin'` nasce **admin/approved**.
Qualquer pessoa com a anon key poderia se autopromover a administrador.

### Artefato pronto
- `db/migrations/069_harden_handle_new_auth_user.sql` — gatilho endurecido: todo novo
  usuário nasce **`user`/`pending`**; promoção a admin/operator/approved é explícita no
  backend (service role). **NÃO aplicada** (de propósito).

### O que falta no app (antes de aplicar a migration)
Centralizar criação de identidade em rota **server-side** com a **service role**:
1. Nova rota `app/api/admin/users/route.ts` usando `supabase.auth.admin.createUser(...)`
   (não `signUp` no navegador). Após criar a conta, **UPDATE explícito** em `portal.users`
   com `role`/`status`/`client_slug` corretos (o gatilho só cria `user/pending`).
2. Refatorar `createClientAccess`/criação de admin em `lib/api/admin-alunos.ts` para chamar
   essa rota (parar de mandar `role` pelo navegador e de "salvar/restaurar" a sessão do admin).
3. Completar CRUD de cliente (editar/desativar/resetar senha/remover login) com um RPC
   transacional `delete_client` espelhando `delete_employee` (remove o login órfão junto).

### ⚠️ Ordem de deploy (a inversão quebra a criação de usuários em silêncio)
1. **Deploy do app novo** na Hostinger (rotas server-side já gravando role/status).
2. **Só então** aplicar `069_harden_handle_new_auth_user.sql` (via MCP `apply_migration` ou psql).
3. Testar: criar 1 admin e 1 cliente pelo painel; confirmar login e que um `signUp` cru
   não consegue mais nascer admin.

---

## A1 — Onboarding unificado (Hotmart cria conta + e-mail de definição de senha)

### Hoje
Três caminhos desconexos: reset self-service (SMTP do Auth), admin cria manual (senha em
texto na tela + hack de sessão no navegador) e compra Hotmart **não cria conta** (fica órfã
se o e-mail não bate — ver migration `034`).

### Implementação recomendada (server-side, idempotente)
1. Helper `provisionClientAccount({ email, name, slug? })` (server, service role):
   - `auth.admin.createUser` se não existir; garante `clients` + `portal.users`
     (role `user`, status `approved`, `client_slug`) de forma **idempotente**.
   - Gera link de definição de senha com `auth.admin.generateLink({ type: 'recovery' })`
     e envia pelo **Resend** (via `send-email` tipo `custom` ou um tipo novo `definir_senha`),
     resolvendo de quebra a pendência do SMTP do Auth.
2. No webhook `app/api/hotmart-webhook/route.ts`: quando a compra é de e-mail **desconhecido**
   **e** a oferta casa em `hotmart_offers` (contrato Diamantes — decisão de produto já tomada),
   chamar o helper em **best-effort** (não travar a resposta à Hotmart → evita timeout/retry).
   Para e-mail conhecido (alias), **atualizar** o vínculo, não inserir duplicata.
3. Caminho manual do admin passa a chamar o mesmo helper (botão "reenviar link" porque o
   link expira em ~1h). Parar de exibir senha na tela.

### Por que não auto-apliquei
Mexe no **webhook de pagamento ao vivo** e na **criação de auth**; precisa do app deployado
+ teste com uma compra real de sandbox antes de confiar. Depende também de B2 (gatilho
endurecido) para o modelo "admin cria usuário" ser seguro.

### Decisões de produto já fixadas (do documento)
- Só provisiona conta para ofertas que são **contrato Diamantes** (`hotmart_offers`).
- Reset de senha migra para **Resend** nesta mesma entrega (sai do SMTP do Auth).
