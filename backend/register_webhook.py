#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from urllib import error, request


DEFAULT_TEAM_ID = "24531451"
DEFAULT_LIST_ID = "901326399435"


def main() -> None:
    parser = argparse.ArgumentParser(description="Register the ClickUp webhook for comment notifications.")
    parser.add_argument("--endpoint", required=True, help="Public HTTPS URL for /webhooks/clickup")
    parser.add_argument("--team-id", default=os.environ.get("CLICKUP_TEAM_ID", DEFAULT_TEAM_ID))
    parser.add_argument("--list-id", default=os.environ.get("CLICKUP_LIST_ID", DEFAULT_LIST_ID))
    parser.add_argument("--events", nargs="+", default=["taskCommentPosted"])
    args = parser.parse_args()

    token = os.environ.get("CLICKUP_API_TOKEN", "").strip()
    if not token:
        raise SystemExit("Missing CLICKUP_API_TOKEN.")

    payload = {
        "endpoint": args.endpoint,
        "events": args.events,
        "list_id": args.list_id,
    }
    body = json.dumps(payload).encode("utf-8")

    req = request.Request(
        f"https://api.clickup.com/api/v2/team/{args.team_id}/webhook",
        data=body,
        headers={
            "Authorization": token,
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=10) as response:
            print(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        print(exc.read().decode("utf-8", errors="replace"))
        raise SystemExit(exc.code) from exc


if __name__ == "__main__":
    main()
