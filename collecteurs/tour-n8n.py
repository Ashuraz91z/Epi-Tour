#!/usr/bin/env python3
"""Relais n8n : lit les exécutions dans la base SQLite de n8n (lecture seule) et les envoie à la tour."""
import json
import sqlite3
import time
import urllib.request

DB = "file:/var/lib/docker/volumes/n8n_n8n_data/_data/database.sqlite?mode=ro"
TOUR = "http://192.168.0.209:8790/e?src=n8n&host=n8n"
SECRET = open("/etc/tour/secret").read().strip()
EVENT = {"new": "n8n:running", "running": "n8n:running", "waiting": "n8n:running", "success": "n8n:success"}
QUERY = """select e.id, coalesce(w.name, e.workflowId), e.status from execution_entity e
left join workflow_entity w on w.id = e.workflowId
where e.status in ('new', 'running', 'waiting') or e.stoppedAt > datetime('now', '-2 minutes')"""


def send(p):
    req = urllib.request.Request(TOUR, json.dumps(p).encode(), {"Content-Type": "application/json", "X-Tour-Token": SECRET})
    try:
        urllib.request.urlopen(req, timeout=3)
        return True
    except Exception:
        return False


seen, beat = {}, 0
while True:
    try:
        db = sqlite3.connect(DB, uri=True, timeout=2)
        rows = db.execute(QUERY).fetchall()
        total, active = db.execute("select count(*), coalesce(sum(active), 0) from workflow_entity").fetchone()
        db.close()
    except sqlite3.Error:
        rows, total, active = [], None, None
    # Signe de vie toutes les minutes : la tour sait que le relais tourne et combien de workflows existent.
    if time.time() - beat > 60 and send({"hook_event_name": "heartbeat", "info": {"workflows": total, "actifs": active}}):
        beat = time.time()
    for eid, workflow, status in rows:
        # Un échec d'envoi laisse l'état « non vu » : il repart au tour suivant.
        if seen.get(eid) != status and send({"hook_event_name": EVENT.get(status, "n8n:error"), "session_id": eid, "workflow": workflow}):
            seen[eid] = status
    seen = {k: v for k, v in seen.items() if k in {r[0] for r in rows}}
    time.sleep(10)
