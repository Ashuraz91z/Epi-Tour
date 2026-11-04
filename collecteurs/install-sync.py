#!/usr/bin/env python3
"""Planifie le lecteur de journaux ; ne modifie pas la configuration de Claude ou Codex.

Mac : launchd toutes les 15 s. Linux : cron chaque minute. Windows : tâche planifiée « Penthouse - suivi » chaque minute."""
from datetime import datetime
import os
from pathlib import Path
import plistlib
import shlex
import subprocess
import sys
from xml.sax.saxutils import escape

TASK = 'Penthouse - suivi'
# Ce que « schtasks /SC MINUTE » ne règle pas : le suivi continue sur batterie, rattrape un passage manqué (veille),
# ne tourne jamais deux fois en parallèle et s'arrête au bout de 10 minutes s'il reste bloqué.
# Ordre des balises : celui des tâches exportées par le Planificateur de tâches.
TASK_XML = """<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Penthouse : envoie chaque minute les métadonnées des sessions Claude Code et Codex de ce PC (jamais les conversations).</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <Repetition>
        <Interval>PT1M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>{start}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{command}</Command>
      <Arguments>{arguments}</Arguments>
      <WorkingDirectory>{directory}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"""


def schtasks(*args):
    # Entrée fermée : schtasks ne doit jamais attendre une saisie (mot de passe) pendant l'installation.
    return subprocess.run(['schtasks'] + list(args), stdin=subprocess.DEVNULL, capture_output=True)


def oem(data):
    """Messages de schtasks : page de code OEM de la console (cp850 en français)."""
    try:
        return data.decode('oem', 'replace').strip()
    except LookupError:
        return data.decode('utf-8', 'replace').strip()


def schedule_windows(conf, script):
    python = Path(sys.executable)
    # pythonw : le même Python, sans fenêtre de console à chaque passage.
    runner = python.with_name('pythonw.exe') if python.with_name('pythonw.exe').is_file() else python
    definition = conf / 'tache-suivi.xml'
    definition.write_text(TASK_XML.format(start=datetime.now().replace(microsecond=0).isoformat(),
                                          command=escape('"%s"' % runner), arguments=escape('"%s"' % script),
                                          directory=escape(str(conf))), encoding='utf-16')
    try:
        created = schtasks('/Create', '/TN', TASK, '/XML', str(definition), '/F')
    finally:
        definition.unlink()
    if not created.returncode:
        print('Suivi automatique activé chaque minute (tâche planifiée « %s »), même sur batterie.' % TASK)
        return
    # Repli sur la forme simple ; Windows peut alors suspendre le suivi quand le PC portable est sur batterie.
    simple = schtasks('/Create', '/SC', 'MINUTE', '/MO', '1', '/TN', TASK, '/TR', '"%s" "%s"' % (runner, script), '/F')
    if simple.returncode:
        print(oem(simple.stderr) or oem(created.stderr), file=sys.stderr)
        raise subprocess.CalledProcessError(simple.returncode, 'schtasks')
    print('Suivi automatique activé chaque minute (tâche planifiée « %s »), sauf quand le PC est sur batterie.' % TASK)


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
    elif sys.platform == 'win32':
        schedule_windows(conf, script)
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
        print('Première synchronisation effectuée, mais planification impossible. Vérifie launchctl (Mac), cron (Linux) '
              'ou le Planificateur de tâches (Windows).', file=sys.stderr)
        sys.exit(1)
