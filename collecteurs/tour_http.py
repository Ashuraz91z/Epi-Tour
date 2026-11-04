"""Transport commun : curl, déjà requis par l'installateur, avec vérification TLS conservée.

Sous Windows : le curl.exe livré avec Windows 10 (1803 et plus) et 11, lancé sans fenêtre de console."""
import json
import os
import subprocess
import sys
import urllib.parse


class ConnectionError(Exception):
    pass


def curl():
    if sys.platform == 'win32':
        # Celui de System32 d'abord : un curl.exe posé dans le dossier courant ne doit pas recevoir la clé.
        system = os.path.join(os.environ.get('SystemRoot', 'C:\\Windows'), 'System32', 'curl.exe')
        return system if os.path.isfile(system) else 'curl.exe'
    return 'curl'


def request(site, key, path, payload=None):
    parsed = urllib.parse.urlsplit(site)
    if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ConnectionError('Adresse du penthouse invalide.')
    if parsed.scheme == 'http' and parsed.hostname not in ('localhost', '127.0.0.1', '::1'):
        raise ConnectionError('HTTPS est requis pour envoyer la clé.')
    if not key or any(c in key for c in '\r\n'):
        raise ConnectionError('Clé absente ou invalide. Recopie la commande depuis Relier mes agents.')
    # La clé reste sur stdin : pas de secret dans les arguments ni dans les erreurs de curl.
    def quoted(value):
        return json.dumps(value, ensure_ascii=True)
    config = 'header = ' + quoted('X-Tour-Token: ' + key) + '\n'
    # Le \n de --write-out est décodé par curl lui-même : aucun retour à la ligne brut dans la ligne de commande Windows.
    args = [curl(), '--silent', '--show-error', '--max-time', '12', '--proto', '=http,https',
            '--config', '-', '--write-out', '\\n%{http_code}', '--url', site.rstrip('/') + path]
    if payload is not None:
        config += 'header = "Content-Type: application/json"\n'
        config += 'data = ' + quoted(json.dumps(payload, ensure_ascii=True)) + '\n'
    options = {}
    if sys.platform == 'win32':
        # Sous pythonw (tâche planifiée), sans ce drapeau chaque envoi ferait clignoter une fenêtre de console.
        options['creationflags'] = getattr(subprocess, 'CREATE_NO_WINDOW', 0x08000000)
    try:
        # UTF-8 explicite : sous Windows l'encodage par défaut (cp1252) déformerait un nom d'étage accentué.
        result = subprocess.run(args, input=config, capture_output=True, encoding='utf-8', errors='replace', timeout=15, **options)
    except FileNotFoundError:
        if sys.platform == 'win32':
            raise ConnectionError('curl.exe est introuvable : il est fourni avec Windows 10 (1803 et plus) et Windows 11. '
                                  'Mets Windows à jour ou installe curl (winget install -e --id cURL.cURL).') from None
        raise ConnectionError('curl est introuvable sur cette machine.') from None
    except subprocess.TimeoutExpired:
        raise ConnectionError('Le serveur ne répond pas : vérifie le réseau puis relance la commande.') from None
    if result.returncode:
        messages = {5: 'Proxy introuvable : vérifie le proxy ou le VPN.', 6: 'Adresse du site introuvable : vérifie le DNS ou le VPN.',
                    7: 'Connexion au site impossible : vérifie le réseau ou le pare-feu.', 28: 'Délai réseau dépassé : relance la commande.',
                    35: 'Connexion TLS impossible : vérifie le proxy ou le VPN.', 60: 'Certificat HTTPS non reconnu par la machine : vérifie sa configuration de certificats.'}
        raise ConnectionError(messages.get(result.returncode, 'Connexion interrompue (curl %s).' % result.returncode))
    body, separator, status = result.stdout.rpartition('\n')
    if not separator or not status.isdigit():
        raise ConnectionError('Réponse réseau invalide ; vérifie le proxy ou le VPN.')
    status = int(status)
    if status == 401:
        raise ConnectionError('Clé refusée. Utilise la commande complète de Relier mes agents, pas le code d’entrée de la salle.')
    if status >= 400:
        raise ConnectionError('Le site renvoie HTTP %s. Réessaie dans quelques instants.' % status)
    if status == 204:
        return None
    if status != 200:
        raise ConnectionError('Le site a redirigé la requête (HTTP %s). Vérifie l’adresse configurée.' % status)
    try:
        return json.loads(body)
    except ValueError:
        raise ConnectionError('Le site ne renvoie pas du JSON. Un portail Wi-Fi ou un proxy peut intercepter la connexion.') from None
