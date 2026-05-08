from __future__ import annotations

import re
import unicodedata
from typing import Any


STORE_PROFILE = {
    "name": "ConstruRio",
    "address": "Av. Dom Helder Camara, 2504",
    "mapsLink": "https://share.google/8tmijyIuaurotoGTR",
    "hours": {
        "weekdays": "segunda a sexta, 08:00 as 18:00",
        "saturday": "sabado, 08:00 as 14:00",
        "sunday": "domingo fechado",
    },
    "holidayPolicy": (
        "Em feriados o funcionamento depende da data. "
        "Sempre confirme com um atendente antes de ir a loja."
    ),
    "payments": [
        "Pix com 5% de desconto",
        "Dinheiro com 5% de desconto",
        "Cartao de credito",
        "Cartao de debito",
    ],
    "delivery": {
        "enabled": True,
        "regions": [
            "Maria da Graca",
            "Higienopolis",
            "Del Castilho",
            "Cachambi",
            "Benfica",
            "Triagem",
            "Bonsucesso",
            "Itarare",
            "Ramos",
        ],
        "note": (
            "Outras regioes podem ser atendidas, "
            "sujeitas a mudanca na taxa de entrega."
        ),
    },
    "categories": (
        "materiais de construcao e produtos para obras em geral, "
        "incluindo itens basicos, acabamento, hidraulica, eletrica, "
        "ferramentas e pintura."
    ),
    "humanTriggerMessage": "quero falar com atendente",
}

QUICK_REPLIES = [
    "Endereco da loja",
    "Horario de funcionamento",
    "Entrega",
    "Formas de pagamento",
    "Quero falar com atendente",
]

PRODUCT_KEYWORDS = [
    "areia",
    "argamassa",
    "bloco",
    "brita",
    "cabo",
    "cal",
    "cano",
    "cimento",
    "conexao",
    "fio",
    "ferramenta",
    "impermeabilizante",
    "interruptor",
    "janela",
    "madeira",
    "piso",
    "porta",
    "porcelanato",
    "rejunte",
    "telha",
    "tijolo",
    "tinta",
    "tomada",
    "torneira",
    "tubo",
    "vaso",
    "vergalhao",
]

QUANTITY_RE = re.compile(
    r"\b\d+(?:[,.]\d+)?\s*"
    r"(?:sacos?|unidades?|metros?|m2|m²|litros?|latas?|caixas?|"
    r"pecas?|peças?|barras?|folhas?|baldes?|rolos?)\b",
    re.IGNORECASE,
)


def create_session() -> dict[str, Any]:
    return {
        "quote": None,
        "pendingHoliday": False,
        "lastIntent": None,
    }


def process_message(raw_message: str, session: dict[str, Any] | None = None) -> dict[str, Any]:
    if session is None:
        session = create_session()

    message = str(raw_message or "").strip()
    normalized = normalize_text(message)

    if not message:
        return make_reply(
            "Pode mandar sua duvida. Eu ajudo com endereco, horario, entrega, "
            "pagamento ou encaminho voce para um atendente.",
            intent="empty",
        )

    if is_explicit_handoff(normalized):
        quote = session.get("quote")
        if quote:
            summary = build_quote_summary(
                {
                    **quote,
                    "messages": [*quote.get("messages", []), message],
                }
            )
        else:
            summary = build_simple_summary(
                "Cliente pediu para falar com atendente.",
                message,
            )

        session["quote"] = None
        session["pendingHoliday"] = False
        session["lastIntent"] = "handoff"
        return make_handoff_reply(
            "Claro. Vou chamar um atendente da ConstruRio para continuar o atendimento.",
            summary,
        )

    if session.get("quote"):
        session["lastIntent"] = "quote"
        return handle_quote_request(message, session)

    if session.get("pendingHoliday"):
        session["pendingHoliday"] = False
        session["lastIntent"] = "holiday_handoff"
        return make_handoff_reply(
            "Vou chamar um atendente para confirmar o funcionamento nesse feriado.",
            build_holiday_summary(message),
        )

    if is_quote_or_stock_request(normalized):
        session["lastIntent"] = "quote"
        return handle_quote_request(message, session)

    if has_any(normalized, ["feriado", "feriados", "carnaval", "natal", "ano novo"]):
        session["pendingHoliday"] = True
        session["lastIntent"] = "holiday"
        return make_reply(
            f"{STORE_PROFILE['holidayPolicy']} Qual feriado ou data voce quer consultar?",
            intent="holiday",
            quick_replies=["Hoje e feriado?", "Amanha abre?", "Quero falar com atendente"],
        )

    if has_any(
        normalized,
        ["endereco", "onde fica", "localizacao", "local", "mapa", "maps", "rota"],
    ):
        session["lastIntent"] = "location"
        return make_reply(
            f"A {STORE_PROFILE['name']} fica na {STORE_PROFILE['address']}. "
            f"Link do mapa: {STORE_PROFILE['mapsLink']}",
            intent="location",
        )

    if has_any(
        normalized,
        ["horario", "abre", "abrem", "aberto", "aberta", "fecha", "funciona", "funcionamento"],
    ):
        session["lastIntent"] = "hours"
        hours = STORE_PROFILE["hours"]
        return make_reply(
            f"Nosso horario e: {hours['weekdays']}; {hours['saturday']}; {hours['sunday']}.",
            intent="hours",
        )

    if has_any(normalized, ["entrega", "entregam", "frete", "taxa", "regiao", "bairro"]):
        session["lastIntent"] = "delivery"
        delivery = STORE_PROFILE["delivery"]
        return make_reply(
            f"Sim, fazemos entrega. Atendemos {format_list(delivery['regions'])}. "
            f"{delivery['note']}",
            intent="delivery",
            quick_replies=[
                "Quanto fica a entrega?",
                "Quero fazer orcamento",
                "Quero falar com atendente",
            ],
        )

    if has_any(
        normalized,
        ["pagamento", "pagar", "pix", "dinheiro", "cartao", "credito", "debito", "desconto"],
    ):
        session["lastIntent"] = "payment"
        return make_reply(
            f"Aceitamos {format_list(STORE_PROFILE['payments'])}.",
            intent="payment",
        )

    if has_any(
        normalized,
        ["vende", "vendem", "trabalha", "produto", "produtos", "material", "obra", "construcao"],
    ):
        session["lastIntent"] = "categories"
        return make_reply(
            f"Trabalhamos com {STORE_PROFILE['categories']} Para preco, estoque ou orcamento, "
            "me diga o produto e a quantidade que eu encaminho para um atendente.",
            intent="categories",
            quick_replies=["Quero fazer orcamento", "Entrega", "Quero falar com atendente"],
        )

    if has_any(normalized, ["oi", "ola", "bom dia", "boa tarde", "boa noite", "e ai"]):
        session["lastIntent"] = "greeting"
        return make_reply(
            f"Ola! Sou o atendimento virtual da {STORE_PROFILE['name']}. "
            "Posso ajudar com endereco, horario, entrega, formas de pagamento "
            "ou chamar um atendente para orcamento.",
            intent="greeting",
        )

    session["lastIntent"] = "fallback"
    return make_reply(
        "Posso ajudar com endereco, horario, feriados, entrega e formas de pagamento. "
        "Se for preco, estoque ou orcamento, me diga o produto, quantidade e se e "
        "entrega ou retirada que eu chamo um atendente.",
        intent="fallback",
        quick_replies=[
            "Endereco da loja",
            "Horario",
            "Entrega",
            "Quero fazer orcamento",
            "Quero falar com atendente",
        ],
    )


def handle_quote_request(message: str, session: dict[str, Any]) -> dict[str, Any]:
    if not session.get("quote"):
        session["quote"] = {
            "reason": "preco, estoque ou orcamento",
            "messages": [],
            "product": "",
            "quantity": "",
            "fulfillment": "",
        }

    quote = session["quote"]
    quote["messages"].append(message)
    details = extract_quote_details(message)

    if details["product"]:
        quote["product"] = details["product"]
    if details["quantity"]:
        quote["quantity"] = details["quantity"]
    if details["fulfillment"]:
        quote["fulfillment"] = details["fulfillment"]

    missing = []
    if not quote["product"]:
        missing.append("produto")
    if not quote["quantity"]:
        missing.append("quantidade")
    if not quote["fulfillment"]:
        missing.append("entrega ou retirada")

    if missing:
        return make_reply(
            build_quote_question(missing, quote),
            intent="quote_collecting",
            quote=quote,
            quick_replies=["E para entrega", "E para retirada", "Quero falar com atendente"],
        )

    summary = build_quote_summary(quote)
    session["quote"] = None
    return make_handoff_reply(
        "Perfeito. Vou encaminhar essas informacoes para um atendente confirmar preco e disponibilidade.",
        summary,
        intent="quote_handoff",
    )


def build_quote_question(missing: list[str], quote: dict[str, Any]) -> str:
    known = []
    if quote.get("product"):
        known.append(f"produto: {quote['product']}")
    if quote.get("quantity"):
        known.append(f"quantidade: {quote['quantity']}")
    if quote.get("fulfillment"):
        known.append(f"tipo: {quote['fulfillment']}")

    known_text = f"Ja anotei {', '.join(known)}. " if known else ""

    if "produto" in missing:
        return f"{known_text}Qual produto voce quer consultar?"
    if "quantidade" in missing:
        return f"{known_text}Qual quantidade voce precisa?"
    return f"{known_text}E para entrega ou retirada na loja?"


def extract_quote_details(message: str) -> dict[str, str]:
    quantity_match = QUANTITY_RE.search(message)
    normalized = normalize_text(message)

    if has_any(normalized, ["entrega", "entregar", "frete", "receber"]):
        fulfillment = "entrega"
    elif has_any(normalized, ["retirada", "retirar", "buscar", "pegar na loja"]):
        fulfillment = "retirada"
    else:
        fulfillment = ""

    return {
        "product": clean_product_text(message),
        "quantity": quantity_match.group(0).strip() if quantity_match else "",
        "fulfillment": fulfillment,
    }


def clean_product_text(message: str) -> str:
    without_quantity = QUANTITY_RE.sub(" ", message)
    cleaned = re.sub(
        r"\b(ola|oi|bom dia|boa tarde|boa noite|voces|voce|tem|teria|quero|"
        r"queria|preciso|precisava|consultar|saber|preco|preço|valor|orcamento|"
        r"orçamento|cotacao|cotação|estoque|disponivel|disponível|quanto|custa|"
        r"fica|por favor|pfv|para|pra|produto|produtos|entrega|entregar|"
        r"retirada|retirar|frete|qual|quais|da|do|de|o|a|um|uma|uns|umas|me)\b",
        " ",
        without_quantity,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"[?!.:,;]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    if len(cleaned) < 3:
        return ""
    if normalize_text(cleaned) in ["qual", "quais", "quanto", "valores"]:
        return ""
    return cleaned


def is_explicit_handoff(normalized: str) -> bool:
    return has_any(
        normalized,
        [
            STORE_PROFILE["humanTriggerMessage"],
            "falar com atendente",
            "chamar atendente",
            "atendente humano",
            "falar com humano",
            "quero humano",
            "vendedor",
            "pessoa",
        ],
    )


def is_quote_or_stock_request(normalized: str) -> bool:
    has_price_signal = has_any(
        normalized,
        [
            "preco",
            "valor",
            "orcamento",
            "cotacao",
            "quanto custa",
            "quanto fica",
            "quanto sai",
            "disponivel",
            "estoque",
        ],
    )
    asks_if_has_product = has_any(normalized, ["tem ", "voces tem", "voce tem", "teria"]) and any(
        keyword in normalized for keyword in PRODUCT_KEYWORDS
    )
    return has_price_signal or asks_if_has_product


def make_reply(
    text: str,
    *,
    intent: str = "general",
    quote: dict[str, Any] | None = None,
    quick_replies: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "reply": text,
        "intent": intent,
        "needsHuman": False,
        "summary": "",
        "quote": quote,
        "quickReplies": quick_replies or QUICK_REPLIES,
    }


def make_handoff_reply(text: str, summary: str, *, intent: str = "handoff") -> dict[str, Any]:
    return {
        "reply": f'{text} Mensagem padrao: "{STORE_PROFILE["humanTriggerMessage"]}".',
        "intent": intent,
        "needsHuman": True,
        "summary": summary,
        "quote": None,
        "quickReplies": ["Endereco da loja", "Horario de funcionamento", "Entrega"],
    }


def build_simple_summary(reason: str, latest_message: str) -> str:
    return "\n".join(
        [
            "Resumo para atendente",
            f"Loja: {STORE_PROFILE['name']}",
            f"Motivo: {reason}",
            f"Ultima mensagem do cliente: {latest_message}",
        ]
    )


def build_holiday_summary(date_message: str) -> str:
    return "\n".join(
        [
            "Resumo para atendente",
            f"Loja: {STORE_PROFILE['name']}",
            "Motivo: confirmar funcionamento em feriado",
            f"Data/feriado informado pelo cliente: {date_message}",
        ]
    )


def build_quote_summary(quote: dict[str, Any]) -> str:
    return "\n".join(
        [
            "Resumo para atendente",
            f"Loja: {STORE_PROFILE['name']}",
            "Motivo: confirmar preco, disponibilidade ou orcamento",
            f"Produto: {quote.get('product') or 'nao informado'}",
            f"Quantidade: {quote.get('quantity') or 'nao informada'}",
            f"Tipo: {quote.get('fulfillment') or 'nao informado'}",
            f"Mensagens do cliente: {' | '.join(quote.get('messages', []))}",
        ]
    )


def normalize_text(value: str) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(character for character in text if unicodedata.category(character) != "Mn")
    return text.lower().strip()


def has_any(value: str, terms: list[str]) -> bool:
    return any(normalize_text(term) in value for term in terms)


def format_list(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return f"{', '.join(items[:-1])} e {items[-1]}"
