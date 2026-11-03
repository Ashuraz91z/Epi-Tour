#!/usr/bin/env python3
"""Installe les hooks dans les outils présents, avec validation préalable et sauvegardes."""
import json
import os
from pathlib import Path
import shlex
import shutil
import sys
import tempfile
import time

HOOK = str(Path.home() / '.config/tour/tour-hook')
TARGETS = {
    '~/.claude/settings.json': ('claude', ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'SubagentStart', 'Notification', 'Stop', 'SessionEnd']),
    '~/.codex/hooks.json': ('codex', ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop']),
}


def main():
    pending = []
    for location, (src, events) in TARGETS.items():
        path = Path(location).expanduser()
        if not path.parent.is_dir():
            continue
        cfg = json.loads(path.read_text()) if path.exists() else {}
        if not isinstance(cfg, dict) or not isinstance(cfg.get('hooks', {}), dict):
            raise ValueError('Configuration hooks invalide : ' + str(path))
        cmd = shlex.quote(sys.executable) + ' ' + shlex.quote(HOOK) + ' ' + src
        for event in events:
            groups = cfg.setdefault('hooks', {}).setdefault(event, [])
            if not isinstance(groups, list) or any(not isinstance(g, dict) or not isinstance(g.get('hooks', []), list) or any(not isinstance(h, dict) for h in g.get('hooks', [])) for g in groups):
                raise ValueError('Format de hook invalide : ' + str(path))
            # Le chemin est stable même si Python change ; ne pas doubler un hook déjà présent.
            if not any(isinstance(h.get('command'), str) and HOOK in h['command'] for g in groups for h in g.get('hooks', [])):
                groups.append({'hooks': [{'type': 'command', 'command': cmd, 'timeout': 5}]})
        pending.append((path, cfg))
    if not pending:
        raise ValueError('Aucun outil détecté. Lance Claude Code ou Codex une fois, puis réessaie.')
    if '--check' in sys.argv:
        return
    for path, cfg in pending:
        if path.exists():
            shutil.copy2(path, str(path) + '.bak-tour-' + str(time.time_ns()))
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.tour-')
        try:
            with os.fdopen(fd, 'w') as file:
                json.dump(cfg, file, indent=2, ensure_ascii=False)
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        print('Hook installé : ' + str(path))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
