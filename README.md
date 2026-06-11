# Diamantes — Portal (Next.js)

Portal do programa Diamantes (Grupo Participa). **Next.js 14 (App Router) + TypeScript** na raiz do repo.
Backend: Supabase (schema `portal`, RLS, RPCs) — o app só consome.
Detalhes em [`CLAUDE.md`](CLAUDE.md) e [`docs/specs/migracao-node-webapp/`](docs/specs/migracao-node-webapp/).

## Rodar local

```bash
cp .env.example .env.local   # preencha NEXT_PUBLIC_SUPABASE_ANON_KEY (e service-role p/ rotas server)
npm install
npm run dev                  # http://localhost:3000/login
```

`/login` autentica no Supabase e redireciona por role: `admin`→`/admin`, cliente→`/portal`, operador→`/operator`.

## Estrutura

```
app/        rotas (login, portal, admin, operator, api Route Handlers)
components/  ui · shell · briefing · demandas · admin · operator
lib/        supabase/ssr · auth · format · i18n · toast · briefing-templates · api/*
middleware.ts  sessão + guards de área
server.js   startup do Node App (lê process.env.PORT)
db/         migrations (referência do backend Supabase)
docs/       specs da migração
```

## Deploy — Hostinger Node App (hPanel)

1. **Setup Node App:** Node 20 LTS+, **Application root = raiz do repo**, **startup file = `server.js`**.
2. **Build no deploy:** `npm ci && npm run build` (não buildar em runtime).
3. **Env vars** (no painel, não em `.htaccess`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE`, `CLICKUP_TOKEN`, `CLICKUP_WEBHOOK_SECRET`, `HOTMART_HOTTOK`.
4. Subdomínio (ex. `app.diamantes.grupoparticipa.app.br`) apontando pro Node App.
5. Reconfigurar as URLs dos webhooks (ClickUp/Hotmart) para o novo domínio.
