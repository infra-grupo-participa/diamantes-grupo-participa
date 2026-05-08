# Diamantes — Portal Grupo Participa

Portal de clientes do programa Diamantes do Grupo Participa.
Hospedado em https://diamantes.grupoparticipa.app.br

## Estrutura

- `index.html` — tela de login do portal
- `admin/` — painel administrativo
- `<slug-cliente>/` — portal individual de cada cliente (27 portais)
- `api/` — backend PHP (auth, users, ClickUp proxy, insights, export)
- `backend/` — worker Python que ouve webhooks do ClickUp e envia email
- `chatbot/` — bot auxiliar (ver `chatbot/README.md`)
- `google-apps-script/` — referência do Apps Script de sync de planilha

## Configuração que precisa existir em produção (NÃO versionado)

Esses arquivos estão no `.gitignore` e precisam ser criados no servidor:

| Arquivo                                    | Conteúdo                            |
|--------------------------------------------|-------------------------------------|
| `api/data/clickup-api-key.txt`             | Chave pessoal `pk_...` do ClickUp   |
| `api/storage/app-state.json`               | Estado do app (criado no 1° boot)   |
| `backend/clients.json`                     | Mapeamento slug→emails de webhook   |
| `chatbot/.env`                             | Vars do bot (ver `.env.example`)    |

Modelos de cada um estão em `*.example` ao lado.

## Rodando local

Pré-requisitos:
- PHP 8.3+ com `mbstring`, `curl`, `openssl`, `fileinfo`, `intl`
- (opcional, para o worker) Python 3.10+

```bash
# servidor de desenvolvimento
php -S 127.0.0.1:8765
```

No Windows com extensões em DLL separadas, é mais fácil apontar para um `php.ini`
local que carregue as extensões e configure `curl.cainfo`. Exemplo:

```bash
php -c "C:/php-ini-grupo-participa/php.ini" -S 127.0.0.1:8765
```

Login admin de seed: `admin` / `12345678` (troque imediatamente).

## Deploy na Hostinger

Veja `HOSTINGER-DEPLOY.md`.

## Sync da planilha

Veja `GOOGLE-SHEETS-SYNC.md`.
