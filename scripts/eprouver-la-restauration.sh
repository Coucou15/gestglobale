#!/usr/bin/env bash
#
# Critere de reception du cahier des charges :
#
#   « Restauration complete depuis la sauvegarde de la veille en moins
#     d'une heure. »
#
# On ne le verifie pas en lisant un script : on detruit la base et on la
# rebatit. La restauration est jugee bonne quand les chiffres sont
# identiques ET que la chaine d'empreintes du journal d'audit est encore
# intacte — c'est elle qui prouve qu'aucune ligne n'a ete perdue ni
# retouchee en chemin.
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="$RACINE/apps/api"
PORT="${PORT:-3000}"
export API_BASE="${API_BASE:-http://localhost:$PORT/api/v1}"
export SAUVEGARDE_CLE="${SAUVEGARDE_CLE:-phrase-de-demonstration-a-changer}"
export SAUVEGARDE_DOSSIER="${SAUVEGARDE_DOSSIER:-$(mktemp -d -t gestglobale-sauv-XXXXXX)}"
export SAUVEGARDE_HORS_SITE="${SAUVEGARDE_HORS_SITE:-$SAUVEGARDE_DOSSIER/hors-site}"

JOURNAL="$(mktemp -t gestglobale-restauration-XXXXXX.log)"
PID_SERVEUR=""

couleur() { printf '\n\033[1m%s\033[0m\n' "$1"; }
arreter() {
  if [[ -n "$PID_SERVEUR" ]] && kill -0 "$PID_SERVEUR" 2>/dev/null; then
    kill "$PID_SERVEUR" 2>/dev/null || true
    wait "$PID_SERVEUR" 2>/dev/null || true
  fi
  PID_SERVEUR=""
}
trap arreter EXIT

demarrer_le_serveur() {
  ( cd "$API" && node dist/main.js >>"$JOURNAL" 2>&1 & echo $! > /tmp/gestglobale-restauration.pid )
  PID_SERVEUR="$(cat /tmp/gestglobale-restauration.pid)"
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null -w '%{http_code}' "$API_BASE/auth/moi" | grep -q 401; then return 0; fi
    sleep 0.5
  done
  echo "Le serveur n'a pas demarre. Journal :" >&2
  tail -20 "$JOURNAL" >&2
  exit 1
}

# Au volume reel, la mesure veut dire quelque chose : une restauration
# de huit articles ne prouve rien sur une base de 30 000.
#   AVEC_VOLUME=1 bash scripts/eprouver-la-restauration.sh
VOLUME="${AVEC_VOLUME:-0}"

couleur '1/6  Une base pleine, comme chez le client'
pgrep -f 'node dist/main.js' | xargs -r kill 2>/dev/null || true
sleep 1
( cd "$RACINE/packages/shared" && pnpm build >/dev/null )
( cd "$API" && npx prisma generate >/dev/null && npx nest build >/dev/null )
( cd "$API" && npx prisma migrate reset --force --skip-seed --skip-generate >/dev/null )
( cd "$API" && npx ts-node -T prisma/seed.ts >/dev/null )
demarrer_le_serveur
( cd "$API" && node test/recette-lot1.mjs >/dev/null )
echo "  la recette a rempli la base : ventes, stocks, paie, audit"

if [[ "$VOLUME" == "1" ]]; then
  arreter
  ( cd "$API" && npx ts-node -T prisma/seed-volume.ts >/dev/null )
  demarrer_le_serveur
  if ( cd "$RACINE/apps/pos" && node test/charge.mjs >/dev/null 2>&1 ); then
    echo "  et le volume reel : 30 000 articles, 7 000 tiers, une journee de 430 tickets"
  else
    echo "  et le volume reel : 30 000 articles et 7 000 tiers."
    echo "  (la journee de ventes n'a pas pu etre rejouee ; la mesure porte donc sur"
    echo "   le catalogue et les tiers, ce qui reste l'essentiel du volume)"
  fi
fi

couleur '2/6  Les chiffres avant la sauvegarde'
AVANT="$(cd "$API" && node outils/temoin.mjs)"
echo "$AVANT" | sed 's/^/  /'

couleur '3/6  Sauvegarde chiffree'
( cd "$API" && node outils/sauvegarde.mjs )
FICHIER="$(ls -t "$SAUVEGARDE_DOSSIER"/*.sauv | head -1)"

# Une sauvegarde qu'on peut lire sans la clef n'en est pas une.
if head -c 2000 "$FICHIER" | tail -c +64 | grep -qa "PGDMP\|CREATE TABLE\|gestglobale"; then
  echo "ECHEC : la sauvegarde laisse lire son contenu en clair" >&2
  exit 1
fi
echo "  le fichier ne laisse rien lire en clair"

couleur '4/6  La base est detruite'
arreter
( cd "$API" && npx prisma migrate reset --force --skip-seed --skip-generate >/dev/null )
VIDE="$(cd "$API" && node outils/temoin.mjs 2>/dev/null || echo 'base vide')"
echo "  $VIDE"

couleur '5/6  Restauration depuis la sauvegarde'
DEBUT="$(date +%s)"
( cd "$API" && node outils/restaurer.mjs "$FICHIER" )
DUREE=$(( $(date +%s) - DEBUT ))
echo "  restauree en ${DUREE} s"

couleur '6/6  Les chiffres apres la restauration'
demarrer_le_serveur
APRES="$(cd "$API" && node outils/temoin.mjs)"
echo "$APRES" | sed 's/^/  /'

echo
if [[ "$AVANT" == "$APRES" ]]; then
  printf '\033[1mLa base restauree est identique a l’originale.\033[0m\n'
else
  echo 'ECHEC : les chiffres different apres restauration.' >&2
  diff <(echo "$AVANT") <(echo "$APRES") >&2 || true
  exit 1
fi

# Une mauvaise clef ne doit pas rendre une base a moitie juste.
couleur 'Controle : une clef fausse ne restaure rien'
if SAUVEGARDE_CLE='mauvaise-phrase-secrete' \
   node "$API/outils/restaurer.mjs" "$FICHIER" >/dev/null 2>&1; then
  echo 'ECHEC : une clef fausse a tout de meme restaure quelque chose' >&2
  exit 1
fi
echo '  refusee, comme il se doit'

couleur 'Controle : la retention efface les vieilles sauvegardes'
( cd "$API" && node test/retention-sauvegardes.mjs | sed 's/^/  /' )

if [[ $DUREE -lt 3600 ]]; then
  printf '\n\033[1mCritere tenu : restauration complete en %s s, soit %s %% de l’heure exigee.\033[0m\n' \
    "$DUREE" "$(( DUREE * 100 / 3600 ))"
else
  echo "ECHEC : la restauration a pris ${DUREE} s, au-dela de l'heure exigee" >&2
  exit 1
fi
