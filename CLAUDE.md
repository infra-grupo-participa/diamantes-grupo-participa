# CLAUDE.md — diamantes-grupo-participa

Portal cliente do programa Diamantes (Grupo Participa). **Webapp Next.js** (migrado do legado estático).

## Stack

- **App:** Next.js 14 (App Router) + TypeScript. Na **raiz do repo** (sem subpasta).
- **Backend:** Supabase (Auth + Postgres `portal` + Storage + RLS). Não muda — o app só **chama** RPCs/views/tabelas.
  Projeto: `npqyvjhvtfahuxfmuhie`.
- **Auth/sessão:** `@supabase/ssr` (cookies SSR) + middleware. 3 áreas por role: cliente (`user`), `admin`, `operator`.
- **Deploy:** Hostinger **Node App** (hPanel). Startup `server.js` (lê `process.env.PORT`). Build no deploy.

## Estrutura

```
.
├── app/                      ← rotas (App Router)
│   ├── (auth)/login/         ← login (SSR Supabase + redirect por role)
│   ├── portal/               ← cliente: dashboard, perfil, projetos, novo-projeto,
│   │                            briefing-basico, briefing/[projetoId], demandas
│   ├── admin/                ← equipe, alunos, assinaturas, projetos, demandas
│   ├── operator/             ← dashboard, demandas, perfil
│   ├── api/                  ← Route Handlers (clickup, clickup-comment,
│   │                            briefing-to-clickup, clickup-webhook, hotmart-webhook)
│   ├── layout.tsx · globals.css
│   └── page.tsx              ← roteia por sessão/role
├── components/               ← ui/ · shell/ · briefing/ · demandas/ · admin/ · operator/
├── lib/
│   ├── supabase/{client,server,middleware}.ts   ← @supabase/ssr (schema portal)
│   ├── auth.ts               ← getProfile/requireRole (guards por área)
│   ├── format.ts · i18n.ts · toast.ts
│   ├── briefing-templates.ts ← motor de briefing (tipado)
│   └── api/*.ts · chat.ts    ← camadas de dados por domínio
├── middleware.ts             ← renova sessão + protege /portal,/admin,/operator
├── next.config.mjs · server.js · tsconfig.json
├── db/migrations/            ← histórico do schema Supabase (referência do backend)
└── docs/specs/migracao-node-webapp/  ← spec, design, PARITY, CONTINUE
```

## Rodar local

```bash
cp .env.example .env.local   # preencha NEXT_PUBLIC_SUPABASE_ANON_KEY (+ service-role p/ rotas server)
npm install
npm run dev                  # http://localhost:3000/login
```

## Deploy — Hostinger Node App

- **Application root:** raiz do repo · **Startup file:** `server.js` · **Node:** 20 LTS+
- **Build:** `npm ci && npm run build`
- **Env vars** (no painel, não em `.htaccess`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE`, `CLICKUP_TOKEN`, `CLICKUP_WEBHOOK_SECRET`, `HOTMART_HOTTOK`
- Após subir: reconfigurar URLs dos webhooks (ClickUp/Hotmart) para o novo domínio.

## Notas

- **Sem GitHub Actions** (removidos para não consumir plano). Deploy é manual no Node App.
- Backend Supabase é a fonte da verdade; vários RPCs/views vivem só no banco remoto (ver `docs/.../PARITY.md`).
- Schema `portal` em todas as chamadas (configurado no client/server Supabase).
