# Sincronização com Google Planilhas

## O que esse fluxo faz

Ao clicar no botão de exportação no admin:

- o painel monta os dados atualizados do ambiente
- envia para `api/export.php`
- o backend repassa isso para um Apps Script
- o Apps Script apaga os dados antigos das abas
- recria a leitura com dados novos

## Estrutura da planilha

O Apps Script cria e atualiza estas abas:

- `Resumo`
- `Diamantes x Serviços`
- `Equipe por Área`

Na aba `Diamantes x Serviços`, cada cliente fica em um bloco próprio com:

- nome do diamante
- slug
- serviços ativos e cancelados
- nota média
- total de avaliações
- tabela com `Serviço`, `Funcionário` e `Status`

Na aba `Equipe por Área`, entram:

- quantidade de funcionários por área
- nomes de cada funcionário da área
- tabela de desempenho individual

## Arquivo do Apps Script

Copie o conteúdo de:

- [google-apps-script/diamantes-sync.gs](/Users/iromar/Downloads/Serviço%20Especializado%20-%20Grupo%20Participa/google-apps-script/diamantes-sync.gs)

para um projeto novo no Google Apps Script.

## Propriedades do Apps Script

Em `Project Settings > Script Properties`, crie:

- `GP_SPREADSHEET_ID`
- `GP_SYNC_SECRET`

### `GP_SPREADSHEET_ID`

É o ID da planilha que vai receber os dados.

Exemplo:

`https://docs.google.com/spreadsheets/d/SEU_ID_AQUI/edit`

### `GP_SYNC_SECRET`

Crie uma chave privada qualquer e use a mesma no servidor da Hostinger.

## Deploy do Apps Script

Publique como `Web app` com:

- Execute as: `Me`
- Who has access: `Anyone`

Depois copie a URL do deploy.

## Variáveis na Hostinger

Configure estas variáveis no ambiente PHP:

- `GP_SHEETS_SYNC_URL`
- `GP_SHEETS_SYNC_SECRET`

### `GP_SHEETS_SYNC_URL`

É a URL do Web App do Apps Script.

### `GP_SHEETS_SYNC_SECRET`

Tem que ser igual ao `GP_SYNC_SECRET` configurado no Apps Script.

## Endpoint do sistema

O botão do admin envia para:

- [api/export.php](/Users/iromar/Downloads/Serviço%20Especializado%20-%20Grupo%20Participa/api/export.php)

Esse endpoint:

- exige sessão de admin
- recebe os dados do painel
- repassa para o Apps Script
- devolve a URL da planilha

## Observação

Sem configurar `GP_SHEETS_SYNC_URL` e `GP_SHEETS_SYNC_SECRET`, o botão não consegue sincronizar.
