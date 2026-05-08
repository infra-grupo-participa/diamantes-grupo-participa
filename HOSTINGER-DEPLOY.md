# Deploy na Hostinger

## Estrutura que precisa subir

Suba a pasta inteira do projeto para o diretório do domínio/subdomínio:

- `diamantes.grupoparticipa.app.br/`

Não suba só os `index.html`. O sistema agora depende destes blocos:

- `api/`
- `admin/`
- todos os diretórios dos clientes
- `portal-auth.js`
- `portal-insights.js`
- `portal-contracts.js`
- `auth-guard.js`
- `group.webp`
- `index.html`

O fluxo de planilha também depende de:

- `api/export.php`
- `google-apps-script/diamantes-sync.gs` (referência para configurar o Apps Script)

## Requisitos da hospedagem

Esse pacote foi preparado para hospedagem PHP compartilhada.

Confirme que o ambiente da Hostinger tem:

- PHP ativo
- `cURL` ativo
- sessão PHP ativa
- permissão de escrita em `api/storage/`

## Permissões

A pasta abaixo precisa permitir escrita do PHP:

- `api/storage/`

Se a Hostinger não criar isso automaticamente, ajuste a permissão da pasta para o padrão de escrita do ambiente.

## Primeiro acesso

No primeiro acesso, o sistema cria o storage automaticamente em:

- `api/storage/app-state.json`

Esse arquivo vai guardar:

- usuários
- aprovações
- serviços ativos/cancelados
- avaliações

## Login inicial

O admin inicial continua:

- usuário: `admin`
- senha: `12345678`

## ClickUp

As chamadas do ClickUp agora passam pelo backend em:

- `api/clickup.php`

A chave está centralizada no backend e não fica mais exposta nos portais.

Se quiser trocar a chave depois, altere em:

- `api/bootstrap.php`

Procure por:

- `GP_CLICKUP_API_KEY`
- `CLICKUP_API_KEY`

Se a hospedagem permitir variável de ambiente, prefira configurar a chave por ambiente.

## Google Planilhas

Se quiser usar o botão de sincronização da planilha no admin, configure também:

- `GP_SHEETS_SYNC_URL`
- `GP_SHEETS_SYNC_SECRET`

O passo a passo completo está em:

- [GOOGLE-SHEETS-SYNC.md](/Users/iromar/Downloads/Serviço%20Especializado%20-%20Grupo%20Participa/GOOGLE-SHEETS-SYNC.md)

## Observação local

Como login/admin/insights agora usam API PHP, abrir os arquivos por `file://` não representa mais o ambiente real de produção.

Para testar corretamente:

1. suba na Hostinger
2. ou rode em um servidor local com PHP
