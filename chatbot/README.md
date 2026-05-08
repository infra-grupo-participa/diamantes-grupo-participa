# ConstruRio Chatbot

MVP de atendente virtual para a ConstruRio. Ele responde duvidas comuns, coleta informacoes para preco/orcamento e prepara o encaminhamento para um atendente humano.

## Rodar localmente

```bash
python3 server.py
```

Depois abra:

```text
http://localhost:3000
```

## Testes

```bash
python3 -m unittest discover -s test
```

## O que o bot responde sozinho

- Endereco e link do Google Maps.
- Horario de funcionamento.
- Politica de feriados.
- Entrega e regioes atendidas.
- Formas de pagamento.
- Categorias gerais de produtos.

## Quando chama humano

O bot encaminha quando o cliente pede atendente ou quando entra em preco, estoque, disponibilidade ou orcamento. Antes disso, ele tenta coletar:

- produto;
- quantidade;
- entrega ou retirada.

## WhatsApp Business

O servidor ja tem endpoints para webhook:

```text
GET  /webhooks/whatsapp
POST /webhooks/whatsapp
```

Crie um arquivo `.env` a partir de `.env.example` quando for conectar na API do WhatsApp:

```bash
cp .env.example .env
```

Preencha:

```text
WHATSAPP_VERIFY_TOKEN
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_GRAPH_VERSION
```

Enquanto as credenciais nao estiverem configuradas, o webhook processa as mensagens recebidas, mas nao envia resposta real pelo WhatsApp.

## Onde editar as informacoes da loja

As informacoes da ConstruRio ficam em:

```text
bot.py
```

Procure por `STORE_PROFILE` para alterar endereco, horarios, regioes de entrega e regras.
