# Diamantes — Webapp (Next.js)

Migração do portal estático para **Next.js (App Router) + TypeScript**.
Plano: [`../docs/specs/migracao-node-webapp/`](../docs/specs/migracao-node-webapp/).
Backend permanece o mesmo Supabase (schema `portal`, RLS, RPCs).

## Rodar local

```bash
cd web
cp .env.example .env.local   # preencha NEXT_PUBLIC_SUPABASE_ANON_KEY (e service-role p/ rotas server)
npm install
npm run dev                  # http://localhost:3000
```

- `/login` → autentica no Supabase e redireciona por role (admin→`/admin`, cliente→`/portal`).
- `/portal` e `/admin` são stubs nesta fase (fase 0); as telas reais vêm nas próximas fases.

## Estrutura (fase 0)

```
app/
  layout.tsx · globals.css        ← shell + tokens de marca (#F29725)
  page.tsx                        ← roteia por sessão/role
  (auth)/login/                   ← login (page + form client)
  portal/ · admin/                ← stubs (em migração)
lib/supabase/{client,server,middleware}.ts   ← @supabase/ssr
components/logout-button.tsx
middleware.ts                     ← renova sessão + protege /portal,/admin
next.config.mjs                   ← output:'standalone' (Node App Hostinger)
server.js                         ← startup file do Node App (lê PORT)
```

## Deploy — Hostinger Node App (hPanel)

1. **Setup Node App**: Node 20 LTS+, diretório = `web/`, startup file = `server.js`.
2. **Build no deploy**: `npm ci && npm run build` (não buildar em runtime).
3. **Env vars** (no painel do app, não em `.htaccess`): `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE`, `CLICKUP_TOKEN`, `HOTMART_HOTTOK`.
4. Subdomínio (ex. `app.diamantes.grupoparticipa.app.br`) apontando pro Node App.

Detalhes e restrições: ver `design.md §6`.
