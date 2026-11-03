#!/usr/bin/env python3
"""Pont MCP stdio pour les états déclarés par Grok Bot ; ne lit aucune conversation."""
import hashlib
import json
from pathlib import Path
import sys
import urllib.parse
from tour_http import request, ConnectionError

STATES = ['working', 'idle', 'finished', 'approval', 'error']
TOOL = {
    'name': 'penthouse_status',
    'description': 'Signale ton état réel au penthouse au début, lors d’une attente/autorisation/erreur et à la fin. Aucun secret ni contenu de conversation.',
    'inputSchema': {'type': 'object', 'properties': {
        'bot': {'type': 'string', 'minLength': 1, 'maxLength': 32, 'description': 'Nom stable du Bot'},
        'session': {'type': 'string', 'minLength': 1, 'maxLength': 64, 'description': 'Identifiant stable de cette tâche ; même identifiant pour début et fin'},
        'state': {'type': 'string', 'enum': STATES},
        'project': {'type': 'string', 'maxLength': 64, 'description': 'Nom court facultatif du projet, sans secret'},
    }, 'required': ['bot', 'session', 'state'], 'additionalProperties': False},
}


def report(args):
    if not isinstance(args, dict) or set(args) - {'bot', 'session', 'state', 'project'}:
        raise ValueError('Arguments inconnus.')
    for key, limit in [('bot', 32), ('session', 64)]:
        if not isinstance(args.get(key), str) or not args[key].strip() or len(args[key]) > limit:
            raise ValueError('Nom de Bot ou identifiant de tâche invalide.')
    if args.get('state') not in STATES:
        raise ValueError('État inconnu.')
    project = args.get('project', '')
    if not isinstance(project, str) or len(project) > 64:
        raise ValueError('Nom de projet invalide.')
    config = json.loads(Path(__file__).with_name('grok-connection.json').read_text())
    if not isinstance(config, dict) or not isinstance(config.get('site'), str) or not isinstance(config.get('key'), str):
        raise ValueError('Configuration invalide.')
    # Un même Bot et une même tâche gardent un seul robot, même après redémarrage du pont.
    sid = hashlib.sha256((args['bot'] + '\0' + args['session']).encode()).hexdigest()
    payload = {'hook_event_name': 'grok:' + args['state'], 'session_id': sid, 'profile': args['bot']}
    if project:
        payload['cwd'] = project
    query = urllib.parse.urlencode({'src': 'grok', 'host': 'grok-bot'})
    request(config['site'], config['key'], '/e?' + query, payload)


def handle(message):
    if not isinstance(message, dict) or message.get('jsonrpc') != '2.0' or not isinstance(message.get('method'), str):
        return {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32600, 'message': 'Requête invalide'}}
    if 'id' not in message:
        return None
    response = {'jsonrpc': '2.0', 'id': message['id']}
    params = message.get('params', {})
    if not isinstance(params, dict):
        return {**response, 'error': {'code': -32602, 'message': 'Paramètres invalides'}}
    method = message['method']
    if method == 'initialize':
        version = params.get('protocolVersion')
        if version not in ['2024-11-05', '2025-03-26', '2025-06-18']:
            version = '2025-06-18'
        result = {'protocolVersion': version, 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'penthouse-grok', 'version': '1.0.0'},
                  'instructions': 'Utilise penthouse_status pour déclarer le début et la fin de tes tâches ; ceci ne surveille pas automatiquement tes conversations.'}
    elif method == 'ping':
        result = {}
    elif method == 'tools/list':
        result = {'tools': [TOOL]}
    elif method == 'tools/call' and params.get('name') == TOOL['name']:
        try:
            report(params.get('arguments'))
            result = {'content': [{'type': 'text', 'text': 'État reçu par le penthouse.'}]}
        except (OSError, ValueError, KeyError, TypeError, ConnectionError):
            result = {'isError': True, 'content': [{'type': 'text', 'text': 'État non transmis. Vérifie grok-connection.json, la clé et le réseau. Aucun secret ne doit être envoyé dans le chat.'}]}
    else:
        return {**response, 'error': {'code': -32601, 'message': 'Méthode ou outil inconnu'}}
    return {**response, 'result': result}


def main():
    for line in sys.stdin:
        try:
            message = json.loads(line)
            response = handle(message)
        except ValueError:
            response = {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': 'JSON invalide'}}
        if response is not None:
            print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
