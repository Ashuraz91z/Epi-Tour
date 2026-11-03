#!/usr/bin/env python3
"""Planifie le lecteur de journaux ; ne modifie pas la configuration de Claude ou Codex."""
import os
from pathlib import Path
import plistlib
import shlex
import subprocess
import sys

def main():
    conf = Path.home() / '.config/tour'
    script = str(conf / 'tour-sync')
    label = 'xyz.ashuraz.penthouse.sync'
    if sys.platform == 'darwin':
        target = Path.home() / 'Library/LaunchAgents' / (label + '.plist')
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('wb') as file:
            plistlib.dump({'Label': label, 'ProgramArguments': [sys.executable, script],
                          'RunAtLoad': True, 'StartInterval': 15,
                          'StandardOutPath': str(conf / 'sync.log'), 'StandardErrorPath': str(conf / 'sync.log'),
                          'Umask': 0o077}, file)
        os.chmod(target, 0o600)
        domain = 'gui/' + str(os.getuid())
        subprocess.run(['launchctl', 'bootout', domain + '/' + label], capture_output=True)
        subprocess.run(['launchctl', 'bootstrap', domain, str(target)], check=True, capture_output=True)
        print('Suivi automatique activé toutes les 15 secondes, y compris après reconnexion au Mac.')
    else:
        previous = subprocess.run(['crontab', '-l'], capture_output=True, text=True)
        if previous.returncode not in (0, 1):
            raise SystemExit('Impossible de lire le planning cron. Configuration conservée.')
        marker = '# penthouse-log-sync'
        lines = [line for line in previous.stdout.splitlines() if not line.endswith(marker)]
        # cron traite % même dans des guillemets ; les protéger dans les chemins.
        command = (shlex.quote(sys.executable) + ' ' + shlex.quote(script)).replace('%', r'\%')
        log = shlex.quote(str(conf / 'sync.log')).replace('%', r'\%')
        lines.append('* * * * * umask 077; ' + command + ' >> ' + log + ' 2>&1 ' + marker)
        subprocess.run(['crontab', '-'], input='\n'.join(lines) + '\n', text=True, check=True, capture_output=True)
        print('Suivi automatique activé chaque minute via cron.')

if __name__ == '__main__':
    try:
        main()
    except (OSError, subprocess.CalledProcessError):
        print('Première synchronisation effectuée, mais planification impossible. Vérifie launchctl (Mac) ou cron (Linux).', file=sys.stderr)
        sys.exit(1)
