#!/bin/sh
# Relie les outils déjà présents, vérifie la clé avant de modifier la configuration.
set -eu
KEY="${1:-}"
[ -n "$KEY" ] || { echo "Il manque la clé de ton appartement."; exit 1; }
SITE="${PENTHOUSE_URL:-https://agent.ashuraz.xyz}"
DIR="$HOME/.config/tour"
command -v python3 >/dev/null || { echo "Installe Python 3 puis relance cette commande."; exit 1; }
command -v curl >/dev/null || { echo "curl est nécessaire."; exit 1; }
if [ -f "$DIR/secret" ] && { [ "$(cat "$DIR/secret")" != "$KEY" ] || [ "$(cat "$DIR/url" 2>/dev/null)" != "$SITE" ]; }; then
  [ "${2:-}" = "--replace" ] || {
    echo "Cette machine est déjà reliée à une autre configuration. Rien n'a été modifié."
    echo "Conserve ton relais actuel, ou ajoute --replace à la commande pour le remplacer avec sauvegarde."
    exit 1
  }
fi
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT HUP INT TERM
for FILE in tour-sync install-sync.py tour-check tour_http.py; do
  curl -fsSL "$SITE/$FILE" -o "$STAGE/$FILE"
done
PENTHOUSE_KEY="$KEY" PENTHOUSE_SITE="$SITE" python3 "$STAGE/tour-check" --verify
if [ -d "$DIR" ]; then
  BACKUP="$DIR.backup-$(date +%Y%m%d%H%M%S)-$$"
  (umask 077; cp -R "$DIR" "$BACKUP")
  echo "Configuration précédente sauvegardée."
fi
mkdir -p "$DIR"
chmod 700 "$DIR"
cp "$STAGE/tour-sync" "$STAGE/install-sync.py" "$STAGE/tour-check" "$STAGE/tour_http.py" "$DIR/"
chmod 700 "$DIR/tour-sync" "$DIR/tour-check"
printf '%s\n' "$SITE" > "$DIR/url"
(umask 077; printf '%s\n' "$KEY" > "$DIR/secret")
chmod 600 "$DIR/secret"
[ -f "$DIR/host" ] || hostname -s > "$DIR/host"
python3 "$DIR/tour-sync"
python3 "$DIR/tour-check"
python3 "$DIR/install-sync.py"
# Sur Mac : l'app Penthouse (lance tes outils à chaque ouverture de session) s'installe avec, dans ~/Applications.
# Facultative : PENTHOUSE_SANS_APP=1 pour s'en passer ; le suivi fonctionne sans elle.
if [ "$(uname)" = "Darwin" ] && [ "${PENTHOUSE_SANS_APP:-}" != "1" ]; then
  mkdir -p "$HOME/Applications"
  if curl -fsSL "$SITE/Penthouse.zip" -o "$STAGE/Penthouse.zip" && ditto -x -k "$STAGE/Penthouse.zip" "$HOME/Applications"; then
    echo "App Penthouse installée dans ~/Applications : elle s'ouvre pour choisir les outils à lancer à chaque ouverture de session."
    open "$HOME/Applications/Penthouse.app" || true
  else
    echo "App Penthouse non installée (facultative) : le suivi de tes agents fonctionne quand même."
  fi
fi
echo "C’est connecté. Les sessions locales récentes et les quotas disponibles sont envoyés au site automatiquement."
echo 'Pour vérifier plus tard : python3 "$HOME/.config/tour/tour-check"'
