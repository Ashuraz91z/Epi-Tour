#!/bin/sh
# Penthouse : à mettre dans le « Setup script » d'un environnement Claude Code sur le web (cloud), une seule ligne :
#   curl -fsSL https://agent.ashuraz.xyz/cloud-setup.sh | sh
# Installe dans le conteneur le hook qui montre les sessions cloud sur ton étage (machine « cloud »), pour tous les
# dépôts de cet environnement. La clé n'est pas ici : le hook la lit à chaque événement dans la variable
# d'environnement PENTHOUSE_KEY de l'environnement (le script de démarrage ne voit pas ces variables, la session si).
# Jamais bloquant : si le site est injoignable (domaine pas autorisé dans l'accès réseau), la session démarre quand même.
set -u
SITE="${PENTHOUSE_URL:-https://agent.ashuraz.xyz}"
DIR="$HOME/.config/tour"
mkdir -p "$DIR" && chmod 700 "$DIR" || exit 0
if ! curl -fsSL "$SITE/tour-cloud-hook" -o "$DIR/tour-cloud-hook.tmp"; then
  echo "Penthouse : $SITE injoignable. Ajoute son domaine dans l'accès réseau de l'environnement. Session lancée sans suivi."
  rm -f "$DIR/tour-cloud-hook.tmp"
  exit 0
fi
mv "$DIR/tour-cloud-hook.tmp" "$DIR/tour-cloud-hook" && chmod 700 "$DIR/tour-cloud-hook"
python3 - "$DIR/tour-cloud-hook" <<'PY' || { echo "Penthouse : hook non installé (réglages Claude Code illisibles)."; exit 0; }
import json, os, shlex, sys
from pathlib import Path
hook = sys.argv[1]
path = Path.home() / ".claude" / "settings.json"
path.parent.mkdir(parents=True, exist_ok=True)
cfg = json.loads(path.read_text()) if path.exists() and path.read_text().strip() else {}
if not isinstance(cfg, dict) or not isinstance(cfg.get("hooks", {}), dict):
    raise SystemExit(1)
command = "python3 " + shlex.quote(hook)
for event in ("SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "SubagentStart",
              "Notification", "Stop", "SessionEnd"):
    groups = cfg.setdefault("hooks", {}).setdefault(event, [])
    if not isinstance(groups, list):
        raise SystemExit(1)
    # Une seule fois par événement, même si le script de démarrage tourne à chaque session.
    if not any(isinstance(g, dict) and any(isinstance(h, dict) and hook in str(h.get("command", "")) for h in g.get("hooks", [])) for g in groups):
        groups.append({"hooks": [{"type": "command", "command": command, "timeout": 5}]})
path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False))
PY
echo "Penthouse : sessions cloud suivies sur ton étage (clé lue dans PENTHOUSE_KEY)."
