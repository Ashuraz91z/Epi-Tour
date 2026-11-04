#!/usr/bin/env python3
"""Envoie l'état d'une session Cursor au penthouse (sans contenu de conversation)."""
import argparse
import json
import os
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from tour_http import request, ConnectionError  # noqa: E402

EVENTS = {
    "working": "cursor:working",
    "idle": "cursor:idle",
    "finished": "cursor:finished",
    "approval": "cursor:approval",
    "error": "cursor:error",
}


def main():
    parser = argparse.ArgumentParser(description="Signale une session Cursor au penthouse.")
    parser.add_argument("state", choices=EVENTS.keys(), help="État de la session")
    parser.add_argument("--session", required=True, help="Identifiant stable de la session")
    parser.add_argument("--project", default="", help="Nom court du projet")
    parser.add_argument("--prompt", default="", help="Résumé court (optionnel, sans secrets)")
    parser.add_argument("--host", default=os.uname().nodename[:40], help="Nom de machine")
    args = parser.parse_args()
    payload = {
        "hook_event_name": EVENTS[args.state],
        "session_id": args.session[:64],
        "cwd": args.project[:120] or None,
        "prompt": args.prompt[:240] or None,
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    secret = Path.home() / ".config/tour/secret"
    if not secret.is_file():
        print("Clé absente : relie d'abord ta machine via install.sh", file=sys.stderr)
        return 2
    # install.sh écrit l'adresse dans ~/.config/tour/url ; config.json reste lu pour les anciennes installations.
    conf = Path.home() / ".config/tour"
    site = (conf / "url").read_text().strip() if (conf / "url").is_file() else ""
    if not site and (conf / "config.json").is_file():
        site = json.loads((conf / "config.json").read_text()).get("site", "")
    if not site:
        print("Adresse du penthouse absente : relance la commande de Relier mes agents.", file=sys.stderr)
        return 2
    key = secret.read_text().strip()
    query = "/e?" + urllib.parse.urlencode({"src": "cursor", "host": args.host})
    try:
        request(site, key, query, payload)
    except ConnectionError as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
