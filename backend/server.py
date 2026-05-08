#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hmac
import json
import logging
import os
import signal
import smtplib
import sqlite3
import ssl
import threading
import time
from dataclasses import dataclass
from email.message import EmailMessage
from hashlib import sha256
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib import error, request


ROOT_DIR = Path(__file__).resolve().parent
CLIENTS_FILE = ROOT_DIR / "clients.json"
STATE_DIR = ROOT_DIR / "runtime"
STATE_DB = STATE_DIR / "notification_state.sqlite3"

DEFAULT_TEAM_ID = "24531451"
DEFAULT_LIST_ID = "901326399435"
CLIENT_RELATION_FIELD_ID = "b25022f9-f6a7-44be-8b86-7454fe9fa770"
CLIENT_COMMENT_PREFIX = "CLIENTE - "
READ_RECEIPT_MARKER = "#visto"


def parse_bool(raw: str | None, default: bool = False) -> bool:
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def utc_now_ms() -> int:
    return int(time.time() * 1000)


@dataclass(frozen=True)
class AppConfig:
    host: str
    port: int
    clickup_api_token: str
    clickup_webhook_secret: str | None
    mail_transport: str
    smtp_host: str | None
    smtp_port: int
    smtp_user: str | None
    smtp_password: str | None
    smtp_from: str | None
    smtp_use_tls: bool
    client_relation_field_id: str
    log_level: str

    @classmethod
    def from_env(cls) -> "AppConfig":
        token = os.environ.get("CLICKUP_API_TOKEN", "").strip()
        if not token:
            raise SystemExit("Missing CLICKUP_API_TOKEN.")

        mail_transport = os.environ.get("MAIL_TRANSPORT", "log").strip().lower() or "log"
        if mail_transport not in {"log", "smtp"}:
            raise SystemExit("MAIL_TRANSPORT must be 'log' or 'smtp'.")

        smtp_host = os.environ.get("SMTP_HOST", "").strip() or None
        smtp_user = os.environ.get("SMTP_USER", "").strip() or None
        smtp_password = os.environ.get("SMTP_PASSWORD", "").strip() or None
        smtp_from = os.environ.get("SMTP_FROM", "").strip() or None

        if mail_transport == "smtp":
            missing = [
                name
                for name, value in {
                    "SMTP_HOST": smtp_host,
                    "SMTP_FROM": smtp_from,
                }.items()
                if not value
            ]
            if missing:
                raise SystemExit(f"Missing SMTP config: {', '.join(missing)}.")

        return cls(
            host=os.environ.get("APP_HOST", "0.0.0.0").strip() or "0.0.0.0",
            port=int(os.environ.get("APP_PORT", "8787")),
            clickup_api_token=token,
            clickup_webhook_secret=os.environ.get("CLICKUP_WEBHOOK_SECRET", "").strip() or None,
            mail_transport=mail_transport,
            smtp_host=smtp_host,
            smtp_port=int(os.environ.get("SMTP_PORT", "587")),
            smtp_user=smtp_user,
            smtp_password=smtp_password,
            smtp_from=smtp_from,
            smtp_use_tls=parse_bool(os.environ.get("SMTP_USE_TLS"), default=True),
            client_relation_field_id=os.environ.get("CLICKUP_CLIENT_RELATION_FIELD_ID", CLIENT_RELATION_FIELD_ID).strip()
            or CLIENT_RELATION_FIELD_ID,
            log_level=os.environ.get("LOG_LEVEL", "INFO").strip().upper() or "INFO",
        )


class ClientDirectory:
    def __init__(self, entries: list[dict[str, Any]]):
        self.by_task_id: dict[str, dict[str, Any]] = {}
        for entry in entries:
            task_id = str(entry.get("client_task_id", "")).strip()
            if not task_id:
                continue
            self.by_task_id[task_id] = {
                "slug": str(entry.get("slug", "")).strip(),
                "emails": [str(email).strip() for email in entry.get("emails", []) if str(email).strip()],
            }

    @classmethod
    def load(cls, path: Path) -> "ClientDirectory":
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            raise SystemExit("clients.json must contain an array.")
        return cls(data)

    def get_emails(self, client_task_id: str | None) -> list[str]:
        if not client_task_id:
            return []
        entry = self.by_task_id.get(str(client_task_id))
        return list(entry.get("emails", [])) if entry else []


class NotificationStore:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS notification_events (
                    idempotency_key TEXT PRIMARY KEY,
                    event_name TEXT NOT NULL,
                    task_id TEXT,
                    comment_id TEXT,
                    status TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT,
                    created_at_ms INTEGER NOT NULL,
                    updated_at_ms INTEGER NOT NULL
                )
                """
            )

    def enqueue(
        self,
        *,
        idempotency_key: str,
        event_name: str,
        task_id: str | None,
        comment_id: str | None,
        payload_json: str,
    ) -> bool:
        now_ms = utc_now_ms()
        with self._connect() as conn:
            cursor = conn.execute(
                """
                INSERT OR IGNORE INTO notification_events (
                    idempotency_key,
                    event_name,
                    task_id,
                    comment_id,
                    status,
                    payload_json,
                    attempts,
                    last_error,
                    created_at_ms,
                    updated_at_ms
                ) VALUES (?, ?, ?, ?, 'pending', ?, 0, NULL, ?, ?)
                """,
                (idempotency_key, event_name, task_id, comment_id, payload_json, now_ms, now_ms),
            )
            return cursor.rowcount == 1

    def pending_keys(self, limit: int = 20) -> list[str]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT idempotency_key
                FROM notification_events
                WHERE status IN ('pending', 'failed')
                ORDER BY created_at_ms ASC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [str(row["idempotency_key"]) for row in rows]

    def fetch(self, idempotency_key: str) -> sqlite3.Row | None:
        with self._connect() as conn:
            return conn.execute(
                "SELECT * FROM notification_events WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()

    def mark_processing(self, idempotency_key: str) -> bool:
        now_ms = utc_now_ms()
        with self._connect() as conn:
            cursor = conn.execute(
                """
                UPDATE notification_events
                SET status = 'processing',
                    updated_at_ms = ?
                WHERE idempotency_key = ?
                  AND status IN ('pending', 'failed')
                """,
                (now_ms, idempotency_key),
            )
            return cursor.rowcount == 1

    def mark_status(
        self,
        idempotency_key: str,
        *,
        status: str,
        last_error: str | None = None,
        increment_attempts: bool = False,
    ) -> None:
        now_ms = utc_now_ms()
        with self._connect() as conn:
            if increment_attempts:
                conn.execute(
                    """
                    UPDATE notification_events
                    SET status = ?,
                        attempts = attempts + 1,
                        last_error = ?,
                        updated_at_ms = ?
                    WHERE idempotency_key = ?
                    """,
                    (status, last_error, now_ms, idempotency_key),
                )
            else:
                conn.execute(
                    """
                    UPDATE notification_events
                    SET status = ?,
                        last_error = ?,
                        updated_at_ms = ?
                    WHERE idempotency_key = ?
                    """,
                    (status, last_error, now_ms, idempotency_key),
                )

    def summary(self) -> dict[str, int]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT status, COUNT(*) AS qty FROM notification_events GROUP BY status"
            ).fetchall()
        return {str(row["status"]): int(row["qty"]) for row in rows}


class ClickUpClient:
    def __init__(self, token: str):
        self.token = token

    def get_task(self, task_id: str) -> dict[str, Any]:
        req = request.Request(
            f"https://api.clickup.com/api/v2/task/{task_id}",
            headers={"Authorization": self.token, "Content-Type": "application/json"},
            method="GET",
        )
        try:
            with request.urlopen(req, timeout=7) as response:
                return json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"ClickUp task lookup failed with {exc.code}: {body}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"ClickUp task lookup failed: {exc}") from exc


class Mailer:
    def __init__(self, config: AppConfig):
        self.config = config

    def send(self, recipients: list[str], subject: str, body: str) -> None:
        if self.config.mail_transport == "log":
            logging.info(
                "MAIL_TRANSPORT=log; email not sent.\nTo: %s\nSubject: %s\n\n%s",
                ", ".join(recipients),
                subject,
                body,
            )
            return

        message = EmailMessage()
        message["From"] = self.config.smtp_from
        message["To"] = ", ".join(recipients)
        message["Subject"] = subject
        message.set_content(body)

        context = ssl.create_default_context()
        with smtplib.SMTP(self.config.smtp_host, self.config.smtp_port, timeout=8) as smtp:
            if self.config.smtp_use_tls:
                smtp.starttls(context=context)
            if self.config.smtp_user and self.config.smtp_password:
                smtp.login(self.config.smtp_user, self.config.smtp_password)
            smtp.send_message(message)


def extract_comment_text(payload: dict[str, Any]) -> str:
    history_items = payload.get("history_items") or []
    if not isinstance(history_items, list):
        return ""

    for item in history_items:
        if not isinstance(item, dict):
            continue
        comment = item.get("comment") or {}
        pieces = comment.get("comment") or []
        if isinstance(pieces, list):
            text = "".join(
                str(piece.get("text", ""))
                for piece in pieces
                if isinstance(piece, dict) and piece.get("text") is not None
            ).strip()
            if text:
                return text
    return ""


def extract_comment_id(payload: dict[str, Any]) -> str | None:
    history_items = payload.get("history_items") or []
    if not isinstance(history_items, list) or not history_items:
        return None
    item = history_items[0]
    if not isinstance(item, dict):
        return None
    comment = item.get("comment") or {}
    comment_id = comment.get("id") or item.get("after")
    return str(comment_id) if comment_id else None


def extract_idempotency_key(payload: dict[str, Any]) -> str:
    webhook_id = str(payload.get("webhook_id") or "").strip()
    history_items = payload.get("history_items") or []
    history_id = ""
    if isinstance(history_items, list) and history_items:
        first = history_items[0]
        if isinstance(first, dict):
            history_id = str(first.get("id") or "").strip()
    if webhook_id and history_id:
        return f"{webhook_id}:{history_id}"
    digest = sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
    return f"fallback:{digest}"


def extract_author_name(payload: dict[str, Any]) -> str:
    history_items = payload.get("history_items") or []
    if isinstance(history_items, list) and history_items:
        first = history_items[0]
        if isinstance(first, dict):
            user = first.get("user") or {}
            name = str(user.get("username") or user.get("email") or "").strip()
            if name:
                return name
    return "Equipe"


def is_client_generated_comment(comment_text: str) -> bool:
    return comment_text.strip().upper().startswith(CLIENT_COMMENT_PREFIX.upper())


def is_read_receipt(comment_text: str) -> bool:
    return comment_text.strip().lower() == READ_RECEIPT_MARKER


def resolve_client(task: dict[str, Any], relation_field_id: str) -> tuple[str | None, str | None]:
    client_name = None
    client_task_id = None
    short_text_fallback = None

    for field in task.get("custom_fields", []) or []:
        if not isinstance(field, dict):
            continue
        field_id = str(field.get("id") or "")
        field_name = str(field.get("name") or "")
        field_type = str(field.get("type") or "")

        if field_id == relation_field_id and field_type == "list_relationship":
            value = field.get("value") or []
            if isinstance(value, list) and value:
                first = value[0]
                if isinstance(first, dict):
                    client_name = str(first.get("name") or "").strip() or None
                    client_task_id = str(first.get("id") or "").strip() or None
                    break

        if field_name == "Cliente" and field_type == "short_text":
            short_text_fallback = str(field.get("value") or "").strip() or None

    return client_name or short_text_fallback, client_task_id


def build_email_subject(task_name: str) -> str:
    return f"Nova mensagem da equipe sobre sua solicitacao: {task_name}"


def build_email_body(
    *,
    client_name: str,
    task_name: str,
    task_id: str,
    task_url: str,
    author_name: str,
    comment_text: str,
) -> str:
    safe_comment = comment_text.strip() or "(comentario sem texto)"
    return (
        f"Ola, {client_name}.\n\n"
        f"A equipe enviou uma nova mensagem na sua solicitacao.\n\n"
        f"Tarefa: {task_name}\n"
        f"Autor: {author_name}\n"
        f"ID da task: {task_id}\n\n"
        f"Mensagem:\n"
        f"{safe_comment}\n\n"
        f"Abrir no ClickUp:\n"
        f"{task_url}\n"
    )


class ClickUpEmailBackend:
    def __init__(self, config: AppConfig, clients: ClientDirectory, store: NotificationStore):
        self.config = config
        self.clients = clients
        self.store = store
        self.clickup = ClickUpClient(config.clickup_api_token)
        self.mailer = Mailer(config)
        self._wake_event = threading.Event()
        self._stop_event = threading.Event()
        self._worker = threading.Thread(target=self._worker_loop, name="notification-worker", daemon=True)

    def start(self) -> None:
        self._worker.start()
        self._wake_event.set()

    def stop(self) -> None:
        self._stop_event.set()
        self._wake_event.set()
        if self._worker.is_alive():
            self._worker.join(timeout=5)

    def enqueue_webhook(self, raw_body: bytes, payload: dict[str, Any]) -> tuple[str, bool]:
        key = extract_idempotency_key(payload)
        inserted = self.store.enqueue(
            idempotency_key=key,
            event_name=str(payload.get("event") or ""),
            task_id=str(payload.get("task_id") or "") or None,
            comment_id=extract_comment_id(payload),
            payload_json=raw_body.decode("utf-8"),
        )
        self._wake_event.set()
        return key, inserted

    def verify_signature(self, raw_body: bytes, signature_header: str | None) -> bool:
        secret = self.config.clickup_webhook_secret
        if not secret:
            return True
        if not signature_header:
            return False
        expected = hmac.new(secret.encode("utf-8"), raw_body, sha256).hexdigest()
        return hmac.compare_digest(expected, signature_header.strip())

    def health_snapshot(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "mail_transport": self.config.mail_transport,
            "webhook_signature_enabled": bool(self.config.clickup_webhook_secret),
            "clients_loaded": len(self.clients.by_task_id),
            "queue": self.store.summary(),
        }

    def _worker_loop(self) -> None:
        while not self._stop_event.is_set():
            self._wake_event.wait(timeout=30)
            self._wake_event.clear()
            if self._stop_event.is_set():
                break
            for key in self.store.pending_keys(limit=25):
                if self._stop_event.is_set():
                    break
                self._process_key(key)

    def _process_key(self, idempotency_key: str) -> None:
        if not self.store.mark_processing(idempotency_key):
            return

        row = self.store.fetch(idempotency_key)
        if row is None:
            return

        try:
            payload = json.loads(str(row["payload_json"]))
            event_name = str(payload.get("event") or "")
            if event_name != "taskCommentPosted":
                self.store.mark_status(idempotency_key, status="ignored", last_error="unsupported_event")
                return

            comment_text = extract_comment_text(payload)
            if is_client_generated_comment(comment_text):
                self.store.mark_status(idempotency_key, status="ignored", last_error="client_comment")
                return

            if is_read_receipt(comment_text):
                self.store.mark_status(idempotency_key, status="ignored", last_error="read_receipt")
                return

            task_id = str(payload.get("task_id") or row["task_id"] or "").strip()
            if not task_id:
                self.store.mark_status(idempotency_key, status="failed", last_error="missing_task_id", increment_attempts=True)
                return

            task = self.clickup.get_task(task_id)
            client_name, client_task_id = resolve_client(task, self.config.client_relation_field_id)
            recipients = self.clients.get_emails(client_task_id)

            if not client_task_id:
                self.store.mark_status(
                    idempotency_key,
                    status="failed",
                    last_error="missing_client_relation",
                    increment_attempts=True,
                )
                return

            if not recipients:
                self.store.mark_status(
                    idempotency_key,
                    status="ignored",
                    last_error=f"no_recipient_email:{client_task_id}",
                )
                return

            subject = build_email_subject(str(task.get("name") or "Solicitacao"))
            body = build_email_body(
                client_name=client_name or "cliente",
                task_name=str(task.get("name") or "Solicitacao"),
                task_id=task_id,
                task_url=str(task.get("url") or ""),
                author_name=extract_author_name(payload),
                comment_text=comment_text,
            )
            self.mailer.send(recipients, subject, body)
            self.store.mark_status(idempotency_key, status="sent")
        except Exception as exc:  # noqa: BLE001
            logging.exception("Failed to process webhook event %s", idempotency_key)
            self.store.mark_status(
                idempotency_key,
                status="failed",
                last_error=str(exc),
                increment_attempts=True,
            )


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "ClickUpEmailBackend/1.0"

    @property
    def app(self) -> ClickUpEmailBackend:
        return self.server.app  # type: ignore[attr-defined]

    def log_message(self, format: str, *args: Any) -> None:
        logging.info("%s - %s", self.address_string(), format % args)

    def _write_json(self, status: int, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            self._write_json(HTTPStatus.OK, self.app.health_snapshot())
            return
        self._write_json(
            HTTPStatus.OK,
            {
                "service": "clickup-email-backend",
                "health": "/healthz",
                "webhook": "/webhooks/clickup",
            },
        )

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/webhooks/clickup":
            self._write_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length)
        signature = self.headers.get("X-Signature")

        if not self.app.verify_signature(raw_body, signature):
            self._write_json(HTTPStatus.UNAUTHORIZED, {"error": "invalid_signature"})
            return

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self._write_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json"})
            return

        event_name = str(payload.get("event") or "")
        if event_name != "taskCommentPosted":
            self._write_json(HTTPStatus.OK, {"status": "ignored", "event": event_name})
            return

        idempotency_key, inserted = self.app.enqueue_webhook(raw_body, payload)
        self._write_json(
            HTTPStatus.ACCEPTED if inserted else HTTPStatus.OK,
            {
                "status": "accepted" if inserted else "duplicate",
                "idempotency_key": idempotency_key,
            },
        )


def make_server(app: ClickUpEmailBackend) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((app.config.host, app.config.port), RequestHandler)
    server.app = app  # type: ignore[attr-defined]
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description="ClickUp comment to email backend.")
    parser.parse_args()

    config = AppConfig.from_env()
    logging.basicConfig(
        level=getattr(logging, config.log_level, logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
    )

    clients = ClientDirectory.load(CLIENTS_FILE)
    store = NotificationStore(STATE_DB)
    app = ClickUpEmailBackend(config, clients, store)
    httpd = make_server(app)

    def handle_shutdown(signum: int, frame: Any) -> None:  # noqa: ARG001
        logging.info("Received signal %s, shutting down.", signum)
        httpd.shutdown()

    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    app.start()
    logging.info(
        "Server listening on http://%s:%s with %s clients loaded and mail transport '%s'.",
        config.host,
        config.port,
        len(clients.by_task_id),
        config.mail_transport,
    )

    try:
        httpd.serve_forever()
    finally:
        app.stop()
        httpd.server_close()


if __name__ == "__main__":
    main()
