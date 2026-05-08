from __future__ import annotations

import json
import mimetypes
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

from bot import STORE_PROFILE, create_session, process_message


ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"
SESSIONS: dict[str, dict] = {}


def load_env() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


class ConstruRioHandler(BaseHTTPRequestHandler):
    server_version = "ConstruRioChatbot/0.1"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/profile":
            self.send_json(200, STORE_PROFILE)
            return

        if parsed.path == "/webhooks/whatsapp":
            self.handle_whatsapp_verify(parsed.query)
            return

        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/chat":
            body = self.read_json_body()
            session_id = body.get("sessionId") or str(uuid4())
            session = SESSIONS.setdefault(session_id, create_session())
            result = process_message(body.get("message", ""), session)
            self.send_json(200, {"sessionId": session_id, **result})
            return

        if parsed.path == "/webhooks/whatsapp":
            self.handle_whatsapp_message()
            return

        self.send_json(404, {"error": "Rota nao encontrada."})

    def handle_whatsapp_verify(self, query: str) -> None:
        params = parse_qs(query)
        mode = first(params, "hub.mode")
        token = first(params, "hub.verify_token")
        challenge = first(params, "hub.challenge")

        if mode == "subscribe" and token and token == os.getenv("WHATSAPP_VERIFY_TOKEN"):
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write((challenge or "").encode("utf-8"))
            return

        self.send_json(403, {"error": "Token de verificacao invalido."})

    def handle_whatsapp_message(self) -> None:
        body = self.read_json_body()
        messages = extract_whatsapp_messages(body)

        for item in messages:
            session_id = f"whatsapp:{item['from']}"
            session = SESSIONS.setdefault(session_id, create_session())
            result = process_message(item["text"], session)
            send_result = send_whatsapp_text(item["from"], result["reply"])

            if result["needsHuman"]:
                print(result["summary"])
            if send_result.get("skipped"):
                print("Envio WhatsApp ignorado:", send_result["reason"])

        self.send_json(200, {"ok": True, "received": len(messages)})

    def serve_static(self, raw_path: str) -> None:
        relative_path = "index.html" if raw_path == "/" else raw_path.lstrip("/")
        file_path = (PUBLIC_DIR / relative_path).resolve()

        if PUBLIC_DIR.resolve() not in file_path.parents and file_path != PUBLIC_DIR.resolve():
            self.send_json(403, {"error": "Caminho invalido."})
            return

        if not file_path.exists() or not file_path.is_file():
            self.send_json(404, {"error": "Arquivo nao encontrado."})
            return

        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.end_headers()
        self.wfile.write(file_path.read_bytes())

    def read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}

        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw or "{}")

    def send_json(self, status_code: int, payload: dict) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt: str, *args) -> None:
        print(f"{self.address_string()} - {fmt % args}")


def extract_whatsapp_messages(body: dict) -> list[dict[str, str]]:
    messages = []
    for entry in body.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            for message in value.get("messages", []):
                if message.get("type") == "text" and message.get("text", {}).get("body"):
                    messages.append(
                        {
                            "from": message.get("from", ""),
                            "text": message["text"]["body"],
                        }
                    )
    return messages


def send_whatsapp_text(to: str, text: str) -> dict:
    token = os.getenv("WHATSAPP_ACCESS_TOKEN")
    phone_number_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID")
    version = os.getenv("WHATSAPP_GRAPH_VERSION", "v20.0")

    if not token or not phone_number_id:
        return {
            "skipped": True,
            "reason": "WHATSAPP_ACCESS_TOKEN ou WHATSAPP_PHONE_NUMBER_ID nao configurado.",
        }

    payload = json.dumps(
        {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "text",
            "text": {"preview_url": True, "body": text},
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        f"https://graph.facebook.com/{version}/{phone_number_id}/messages",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            response_body = response.read().decode("utf-8")
            return {"status": response.status, "body": parse_json(response_body)}
    except urllib.error.URLError as error:
        return {"error": str(error)}


def first(params: dict[str, list[str]], key: str) -> str:
    values = params.get(key, [])
    return values[0] if values else ""


def parse_json(value: str):
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def main() -> None:
    load_env()
    port = int(os.getenv("PORT", "3000"))
    server = ThreadingHTTPServer(("127.0.0.1", port), ConstruRioHandler)
    print(f"ConstruRio chatbot rodando em http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
