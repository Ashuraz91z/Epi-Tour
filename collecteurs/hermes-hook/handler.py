"""Hook de la passerelle Hermes : envoie le message reçu et la fin de la réponse à la tour."""
import asyncio
import json
import urllib.request
import urllib.parse
import socket
from pathlib import Path

def _post(body):
    try:
        conf = Path.home() / ".config/tour"
        site = (conf / "url").read_text().strip().rstrip("/")
        secret = (conf / "secret").read_text().strip()
        host = (conf / "host").read_text().strip() if (conf / "host").exists() else socket.gethostname().split(".")[0]
        query = urllib.parse.urlencode({"src": "hermes", "host": host})
        req = urllib.request.Request(site + "/e?" + query, body,
                                     {"Content-Type": "application/json", "X-Tour-Token": secret})
        urllib.request.urlopen(req, timeout=3)
    except Exception:
        pass


async def handle(event_type, context):
    body = json.dumps({"hook_event_name": event_type, **context}, ensure_ascii=False, default=str).encode()
    await asyncio.to_thread(_post, body)
