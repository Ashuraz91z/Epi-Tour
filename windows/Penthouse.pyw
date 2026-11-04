"""Ouvre Penthouse.ps1 sans fenêtre de console, même quand Windows Terminal est le terminal par défaut.

Lancé par pythonw.exe depuis les raccourcis « Penthouse » (menu Démarrer, dossier Démarrage) ; les arguments
(-Login) sont transmis tels quels. Avec CREATE_NO_WINDOW, PowerShell et les commandes qu'il lance (schtasks,
python) partagent une console invisible : rien ne clignote à l'ouverture de session.
"""
import os
import subprocess
import sys

here = os.path.dirname(os.path.abspath(__file__))
shell = os.path.join(os.environ.get('SystemRoot', 'C:\\Windows'), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
subprocess.Popen([shell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', os.path.join(here, 'Penthouse.ps1')] + sys.argv[1:],
                 cwd=os.path.expanduser('~'), creationflags=0x08000000, close_fds=True)
